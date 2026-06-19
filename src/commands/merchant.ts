import { Logger } from 'koishi'
import { PluginDeps } from '../types'
import { compressPngImage, sendImageWithFallback } from '../send-image'
import { sendScheduledImageWithFallback } from '../subscription-send'

const logger = new Logger('rocom-merchant')

const TEXT = {
  merchant: '\u8fdc\u884c\u5546\u4eba',
  todayMerchant: '今日远行商人',
  subscribe: '\u8ba2\u9605\u8fdc\u884c\u5546\u4eba',
  unsubscribe: '\u53d6\u6d88\u8ba2\u9605\u8fdc\u884c\u5546\u4eba',
  viewSubscribe: '\u67e5\u770b\u8fdc\u884c\u5546\u4eba\u8ba2\u9605',
  unknown: '\u672a\u77e5',
  notOpen: '\u672a\u5f00\u653e',
  defaultSource: '\u9ed8\u8ba4',
  customSource: '\u81ea\u5b9a\u4e49',
}

type MerchantRoundInfo = {
  current: number | null
  total: number
  countdown: string
  is_open: boolean
  round_id: string
}

type MerchantCategoryKey = 'normal' | 'round' | 'weekend'

const CATEGORY_ORDER: MerchantCategoryKey[] = ['normal', 'round', 'weekend']
const CATEGORY_LABELS: Record<MerchantCategoryKey, string> = {
  normal: '热销商品',
  round: '常规商品',
  weekend: '周末限定',
}

const ROUND_WINDOWS = [
  { id: 1, label: '08:00-12:00', startHour: 8, endHour: 12 },
  { id: 2, label: '12:00-16:00', startHour: 12, endHour: 16 },
  { id: 3, label: '16:00-20:00', startHour: 16, endHour: 20 },
  { id: 4, label: '20:00-24:00', startHour: 20, endHour: 24 },
]

type MerchantProductForRender = {
  name: string
  image: string
  time_label: string
  category: MerchantCategoryKey
  round_id: number | null
  is_active: boolean
  start_time: number | null
  end_time: number | null
}

type MerchantCardItem = {
  goods_name: string
  iconUrl: string
  price: string | number
  num: string
  category: MerchantCategoryKey
  roundId: number
  isHot: boolean
  isEnded: boolean
  remainingStr: string
  top: number
}

type LegacyMerchantRoundGroup = {
  round_id: number
  label: string
  is_current: boolean
  products: MerchantProductForRender[]
}

const CHINA_TIMEZONE = 'Asia/Shanghai'
const chinaPartsFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function getChinaParts(input: number | Date = Date.now()) {
  const parts: Record<string, string> = {}
  const date = input instanceof Date ? input : new Date(input)
  for (const item of chinaPartsFormatter.formatToParts(date)) {
    if (item.type !== 'literal') parts[item.type] = item.value
  }
  return {
    year: Number(parts.year || '0'),
    month: Number(parts.month || '0'),
    day: Number(parts.day || '0'),
    hour: Number(parts.hour || '0'),
    minute: Number(parts.minute || '0'),
    second: Number(parts.second || '0'),
  }
}

function padNumber(value: number) {
  return String(value).padStart(2, '0')
}

function getChinaDateText(input: number | Date = Date.now()) {
  const parts = getChinaParts(input)
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`
}

function getChinaDayStartMs(input: number | Date = Date.now()) {
  const parts = getChinaParts(input)
  return new Date(`${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}T00:00:00+08:00`).getTime()
}

function classifyMerchantItem(item: any): MerchantCategoryKey {
  const start = normalizeTimestamp(item?.start_time)
  const end = normalizeTimestamp(item?.end_time)
  if (!start || !end) return 'normal'

  const durationDays = (end - start) / (1000 * 60 * 60 * 24)
  if (durationDays >= 2) return 'weekend'

  const startParts = getChinaParts(start)
  const endParts = getChinaParts(end)
  const startHour = startParts.hour + startParts.minute / 60
  const endHour = endParts.hour + endParts.minute / 60
  if (startHour <= 8 && endHour >= 23.5) return 'normal'

  return 'round'
}

function normalizeTimestamp(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return null
  return timestamp < 100000000000 ? timestamp * 1000 : timestamp
}

function formatProductWindow(product: any): string {
  const start = normalizeTimestamp(product?.start_time)
  const end = normalizeTimestamp(product?.end_time)
  if (!start && !end) return ''

  const formatDate = (timestamp: number) => {
    const parts = getChinaParts(timestamp)
    return `${padNumber(parts.month)}-${padNumber(parts.day)}`
  }

  const formatTime = (timestamp: number) => {
    const parts = getChinaParts(timestamp)
    return `${padNumber(parts.hour)}:${padNumber(parts.minute)}`
  }

  if (start && end) {
    const datePart = formatDate(start)
    return `${datePart} ${formatTime(start)} – ${formatTime(end)}`
  }
  if (start) return `${formatDate(start)} ${formatTime(start)}+`
  return `${formatDate(end!)} ${formatTime(end!)}-`
}

function getMerchantActivity(res: any): any {
  const activities = res?.merchantActivities || res?.merchant_activities || []
  return activities[0] || {}
}

function getMerchantProducts(res: any): any[] {
  const activity = getMerchantActivity(res)
  const groups: any[][] = []
  if (Array.isArray(activity?.products)) groups.push(activity.products)
  if (Array.isArray(activity?.product_list)) groups.push(activity.product_list)
  if (Array.isArray(activity?.get_props)) groups.push(activity.get_props)
  if (Array.isArray(activity?.get_extra_props)) groups.push(activity.get_extra_props)
  if (Array.isArray(activity?.get_pets)) groups.push(activity.get_pets)

  const merged: any[] = []
  const seen = new Set<string>()
  for (const list of groups) {
    for (const item of list) {
      const start = normalizeTimestamp(item?.start_time) ?? 0
      const end = normalizeTimestamp(item?.end_time) ?? Infinity
      const key = `${item?.id ?? ''}|${item?.name ?? ''}|${start}|${end === Infinity ? 'inf' : end}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function isMerchantItemActive(item: any, now: number | Date = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now
  const start = normalizeTimestamp(item?.start_time)
  const end = normalizeTimestamp(item?.end_time)
  return (start === null || nowMs >= start) && (end === null || nowMs < end)
}

function isMerchantItemToday(item: any, now: number | Date = Date.now()) {
  const start = normalizeTimestamp(item?.start_time)
  const end = normalizeTimestamp(item?.end_time)
  if (start === null || end === null) return true

  const startOfDay = getChinaDayStartMs(now)
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000
  return start < endOfDay && end > startOfDay
}

function getRoundForItem(item: any, now: number | Date = Date.now()) {
  const start = normalizeTimestamp(item?.start_time)
  if (start === null) return null

  const startParts = getChinaParts(start)
  const nowParts = getChinaParts(now)
  if (startParts.year !== nowParts.year || startParts.month !== nowParts.month || startParts.day !== nowParts.day) {
    return null
  }

  const startHour = startParts.hour + startParts.minute / 60
  const round = ROUND_WINDOWS.find(win => startHour >= win.startHour && startHour < win.endHour)
  return round?.id ?? null
}

function getCurrentMerchantRound(now: Date = new Date()): MerchantRoundInfo {
  const parts = getChinaParts(now)
  const secondsOfDay = parts.hour * 3600 + parts.minute * 60 + parts.second
  const marketStartSeconds = 8 * 3600
  const marketEndSeconds = 24 * 3600
  const datePart = getChinaDateText(now)

  if (secondsOfDay < marketStartSeconds || secondsOfDay >= marketEndSeconds) {
    return {
      current: null,
      total: ROUND_WINDOWS.length,
      countdown: TEXT.notOpen,
      is_open: false,
      round_id: `${datePart}-closed`,
    }
  }

  const currentWindow = ROUND_WINDOWS.find(win => parts.hour >= win.startHour && parts.hour < win.endHour)
  const currentRound = currentWindow?.id ?? null
  const roundEndSeconds = (currentWindow?.endHour ?? 24) * 3600
  const diff = Math.max(0, (roundEndSeconds - secondsOfDay) * 1000)
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)

  return {
    current: currentRound,
    total: ROUND_WINDOWS.length,
    countdown: `${hours}\u5c0f\u65f6${mins}\u5206\u949f`,
    is_open: currentRound !== null,
    round_id: `${datePart}-${currentRound || 'closed'}`,
  }
}

function parseMerchantSubscriptionArgs(args: string | undefined, defaultItems: string[]) {
  const parts = (args || '').split(/\s+/).filter(Boolean)
  let mentionAll = false

  if (parts[0] === '1' || parts[0] === '0') {
    mentionAll = parts.shift() === '1'
  }

  const matchAll = parts.length === 1 && parts[0] === '全部'
  if (matchAll) parts.shift()

  const items = matchAll ? [] : (parts.length ? parts : defaultItems)
  const source = matchAll ? '全部商品' : (parts.length ? TEXT.customSource : TEXT.defaultSource)
  return {
    mention_all: mentionAll,
    match_all: matchAll,
    items,
    source,
  }
}

function getSubscriptionTarget(session: any) {
  const platform = session.platform || session.bot?.platform || ''
  const privateChat = !session.guildId
  const channelId = session.channelId || session.guildId || session.userId || ''
  const key = privateChat ? `private_${session.userId}` : session.guildId
  return { key, platform, channelId, privateChat }
}

function isBotAdmin(session: any, adminUserIds: string[]) {
  return adminUserIds.includes(session?.userId || '')
}

function sameStringArray(left: string[], right: string[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getRandomGoodsMaps(res: any) {
  const priceMap = new Map<string, string | number>()
  const limitMap = new Map<string, string | number>()
  const randomGoods = Array.isArray(res?.random_goods)
    ? res.random_goods
    : Array.isArray(res?.randomGoods)
      ? res.randomGoods
      : []

  for (const item of randomGoods) {
    const name = String(item?.goods_name || item?.name || '').trim()
    if (!name) continue
    if (item?.price !== undefined && item?.price !== null && item.price !== '') priceMap.set(name, item.price)
    if (item?.buy_limit_num !== undefined && item?.buy_limit_num !== null && item.buy_limit_num !== '') {
      limitMap.set(name, item.buy_limit_num)
    }
  }

  return { priceMap, limitMap }
}

function normalizeMerchantProducts(res: any, now = new Date()): MerchantProductForRender[] {
  return getMerchantProducts(res).map((item: any) => {
    const name = String(item?.name || item?.goods_name || TEXT.unknown).trim() || TEXT.unknown
    return {
      name,
      image: String(item?.icon_url || item?.iconUrl || ''),
      time_label: formatProductWindow(item),
      category: classifyMerchantItem(item),
      round_id: getRoundForItem(item, now),
      is_active: isMerchantItemActive(item, now),
      start_time: normalizeTimestamp(item?.start_time),
      end_time: normalizeTimestamp(item?.end_time),
    }
  })
}

function buildMerchantCardItems(
  products: MerchantProductForRender[],
  res: any,
  options: { includeEnded: boolean },
) {
  const { priceMap, limitMap } = getRandomGoodsMaps(res)
  const catOrder: Record<MerchantCategoryKey, number> = { round: 0, normal: 1, weekend: 2 }
  const startY = 592
  const cardHeight = 308
  const gap = 43

  const goodsAll: MerchantCardItem[] = products.map((product) => {
    const limit = limitMap.get(product.name)
    const limitText = limit === undefined || limit === null || limit === '' ? '--' : String(limit)
    const isHot = product.category !== 'round'
    const isEnded = options.includeEnded ? !product.is_active : false
    const roundPrefix = product.round_id ? `第${product.round_id}轮·` : ''
    const remainingStr = product.category === 'normal'
      ? `本日限购${limitText}个`
      : product.category === 'weekend'
        ? `活动期间限购${limitText}个`
        : `${isEnded ? roundPrefix : ''}本轮限购${limitText}个`

    return {
      goods_name: product.name,
      iconUrl: product.image,
      price: priceMap.get(product.name) ?? 0,
      num: '',
      category: product.category,
      roundId: product.round_id || 0,
      isHot,
      isEnded,
      remainingStr,
      top: 0,
    }
  })

  goodsAll.sort((a, b) => {
    if (options.includeEnded && a.isEnded !== b.isEnded) return a.isEnded ? 1 : -1
    if (a.category !== b.category) return catOrder[a.category] - catOrder[b.category]
    return Number(b.price || 0) - Number(a.price || 0)
  })

  const goods = goodsAll.map((item, index) => ({
    ...item,
    num: String(index + 1).padStart(2, '0'),
    top: startY + index * (cardHeight + gap),
  }))
  const lastCardTop = goods.length > 0 ? goods[goods.length - 1].top : startY
  const bottomFrameTop = lastCardTop + 287
  const pageHeight = bottomFrameTop + 160

  return { goods, bottomFrameTop, pageHeight }
}

function getCurrentMerchantProducts(products: MerchantProductForRender[], roundInfo: MerchantRoundInfo) {
  return products.filter((product) => {
    if (!product.is_active) return false
    if (product.category === 'round') return !!roundInfo.current && product.round_id === roundInfo.current
    return true
  })
}

function buildMerchantFallbackText(title: string, products: MerchantProductForRender[], roundInfo?: MerchantRoundInfo) {
  const fallbackLines: string[] = [title]
  if (roundInfo) {
    fallbackLines.push(`轮次：第 ${roundInfo.current || TEXT.notOpen} / ${roundInfo.total} 轮`)
    fallbackLines.push(`剩余：${roundInfo.countdown}`)
  }
  fallbackLines.push('')

  if (!products.length) {
    fallbackLines.push(roundInfo ? '当前轮次暂无商品。' : '今日暂无已公布的远行商人商品。')
    return fallbackLines.join('\n').trimEnd()
  }

  for (const key of CATEGORY_ORDER) {
    const group = products.filter(product => product.category === key)
    if (!group.length) continue
    fallbackLines.push(`【${CATEGORY_LABELS[key]}】`)
    group.forEach((product, index) => {
      const tail = product.time_label ? ` (${product.time_label})` : ''
      fallbackLines.push(`  ${index + 1}. ${product.name}${tail}`)
    })
    fallbackLines.push('')
  }

  return fallbackLines.join('\n').trimEnd()
}

function getMerchantActivityTitle(res: any) {
  const activity = getMerchantActivity(res)
  return String(activity?.name || TEXT.merchant).trim() || TEXT.merchant
}

function getMerchantActivitySubtitle(res: any) {
  const activity = getMerchantActivity(res)
  return String(activity?.start_date || '每日 08:00 / 12:00 / 16:00 / 20:00 刷新').trim()
}

function getLegacyRoundGroups(now: Date, roundInfo: MerchantRoundInfo): LegacyMerchantRoundGroup[] {
  return ROUND_WINDOWS.map(win => ({
    round_id: win.id,
    label: `${padNumber(win.startHour)}:00 - ${padNumber(win.endHour)}:00`,
    is_current: roundInfo.current === win.id,
    products: [],
  }))
}

function buildLegacyCategoryGroups(products: MerchantProductForRender[], roundGroups: LegacyMerchantRoundGroup[]) {
  return CATEGORY_ORDER
    .map((key) => {
      const groups = roundGroups
        .map(group => ({
          round_id: group.round_id,
          label: group.label,
          is_current: group.is_current,
          products: group.products.filter(product => product.category === key),
        }))
        .filter(group => group.products.length > 0)

      return {
        key,
        label: CATEGORY_LABELS[key],
        roundGroups: groups,
        product_count: groups.reduce((sum, group) => sum + group.products.length, 0),
      }
    })
    .filter(category => category.product_count > 0)
}

function getMerchantDateStr(now = new Date()) {
  const parts = getChinaParts(now)
  return `${parts.month}.${parts.day}`
}

function buildMerchantRenderPayload(res: any, now = new Date()) {
  const allProducts = normalizeMerchantProducts(res, now)
  const roundInfo = getCurrentMerchantRound(now)
  const products = getCurrentMerchantProducts(allProducts, roundInfo)
  const currentWindow = ROUND_WINDOWS.find(win => win.id === roundInfo.current)
  const timeRange = currentWindow
    ? `${padNumber(currentWindow.startHour)}:00-${padNumber(currentWindow.endHour)}:00`
    : '--:--~--:--'
  const data = {
    dateStr: getMerchantDateStr(now),
    timeRange,
    ...buildMerchantCardItems(products, res, { includeEnded: false }),
  }
  const fallback = buildMerchantFallbackText(TEXT.merchant, products, roundInfo)

  return { products, roundInfo, data, fallback }
}

function buildLegacyMerchantRenderPayload(res: any, now = new Date()) {
  const allProducts = normalizeMerchantProducts(res, now)
  const roundInfo = getCurrentMerchantRound(now)
  const products = getCurrentMerchantProducts(allProducts, roundInfo)
  const roundGroups = getLegacyRoundGroups(now, roundInfo)
  const currentGroup = roundGroups.find(group => group.round_id === roundInfo.current) || roundGroups[0]
  currentGroup.products.push(...products)
  const categories = buildLegacyCategoryGroups(products, roundGroups)
  const data = {
    background: '',
    title: getMerchantActivityTitle(res),
    subtitle: getMerchantActivitySubtitle(res),
    categories,
    roundGroups,
    total_products: products.length,
  }
  const fallback = buildMerchantFallbackText(TEXT.merchant, products, roundInfo)

  return { products, roundInfo, data, fallback }
}

function buildTodayMerchantRenderPayload(res: any, now = new Date()) {
  const products = normalizeMerchantProducts(res, now)
    .filter(product => {
      const source = {
        start_time: product.start_time,
        end_time: product.end_time,
      }
      return isMerchantItemToday(source, now)
    })
  const data = {
    dateStr: getMerchantDateStr(now),
    ...buildMerchantCardItems(products, res, { includeEnded: true }),
  }
  const fallback = buildMerchantFallbackText(`今日远行商人 (${getChinaDateText(now)})`, products)

  return { products, data, fallback }
}

function buildLegacyTodayMerchantRenderPayload(res: any, now = new Date()) {
  const allProducts = normalizeMerchantProducts(res, now)
    .filter(product => {
      const source = {
        start_time: product.start_time,
        end_time: product.end_time,
      }
      return isMerchantItemToday(source, now)
    })
  const roundInfo = getCurrentMerchantRound(now)
  const roundGroups = getLegacyRoundGroups(now, roundInfo)

  for (const product of allProducts) {
    const roundId = product.category === 'round' ? product.round_id : null
    const group = roundId
      ? roundGroups.find(item => item.round_id === roundId)
      : roundGroups[0]
    if (group) group.products.push(product)
  }

  const categories = buildLegacyCategoryGroups(allProducts, roundGroups)
  const data = {
    background: '',
    title: TEXT.todayMerchant,
    subtitle: `${getChinaDateText(now)} · 每日 08:00 / 12:00 / 16:00 / 20:00 刷新`,
    categories,
    roundGroups,
    total_products: allProducts.length,
  }
  const fallback = buildMerchantFallbackText(`今日远行商人 (${getChinaDateText(now)})`, allProducts)

  return { products: allProducts, data, fallback }
}

function useLegacyMerchantUi(deps: PluginDeps) {
  return deps.config.merchantUiStyle === 'old'
}

function buildConfiguredMerchantRenderPayload(deps: PluginDeps, res: any, now = new Date()) {
  const payload = useLegacyMerchantUi(deps)
    ? buildLegacyMerchantRenderPayload(res, now)
    : buildMerchantRenderPayload(res, now)
  return {
    ...payload,
    templateName: useLegacyMerchantUi(deps) ? 'yuanxing-shangren' : 'yuanxing-shangren/merchant',
  }
}

function buildConfiguredTodayMerchantRenderPayload(deps: PluginDeps, res: any, now = new Date()) {
  const payload = useLegacyMerchantUi(deps)
    ? buildLegacyTodayMerchantRenderPayload(res, now)
    : buildTodayMerchantRenderPayload(res, now)
  return {
    ...payload,
    templateName: useLegacyMerchantUi(deps) ? 'yuanxing-shangren' : 'yuanxing-shangren/today',
  }
}

async function checkMerchantSubscriptions(deps: PluginDeps) {
  const { ctx, client, merchantSubMgr, renderer, config } = deps
  const res = await client.getMerchantInfo(ctx, true)
  if (!res) return { subscriptions: 0, matched: 0, pushed: 0 }

  const { products, roundInfo, data, fallback, templateName } = buildConfiguredMerchantRenderPayload(deps, res)
  const productNames = products.map((p: any) => p.name || '').filter(Boolean)
  const rendered = await renderer.renderHtml(ctx, templateName, data)
  const renderedImage = rendered ? compressPngImage(rendered, config) : null
  const subs = merchantSubMgr.getAll()
  let matchedCount = 0
  let pushedCount = 0

  for (const [key, sub] of Object.entries(subs)) {
    const matchAll = !!sub.match_all
    const matched = matchAll
      ? productNames
      : sub.items.filter((item: string) => productNames.some(n => n.includes(item)))
    if (!matchAll && !matched.length) continue
    if (matchAll && !products.length) continue
    matchedCount++
    if (matchAll) {
      if (sub.last_push_round === roundInfo.round_id) continue
    } else {
      if (sub.last_push_round === roundInfo.round_id && sameStringArray(matched, sub.last_matched_items || [])) continue
    }

    const msg = matchAll
      ? `\ud83d\udd14 \u8fdc\u884c\u5546\u4eba\u5237\u65b0\u63d0\u9192\n\u5f53\u524d\u5546\u54c1\uff1a${productNames.join('\u3001')}`
      : `\ud83d\udd14 \u8fdc\u884c\u5546\u4eba\u5237\u65b0\u63d0\u9192\n\u5f53\u524d\u5546\u54c1\uff1a${productNames.join('\u3001')}\n\u5339\u914d\u8ba2\u9605\uff1a${matched.join('\u3001')}`
    const platform = sub.platform || ctx.bots[0]?.platform
    const channelId = sub.channel_id || sub.group_id || sub.user_id || key
    if (!platform || !channelId) {
      logger.warn(`\u63a8\u9001\u5931\u8d25 ${key}: \u65e0\u6cd5\u786e\u5b9a\u5e73\u53f0\u6216\u9891\u9053`)
      continue
    }

    const fallbackText = `${msg}\n${fallback}`
    const sent = await sendScheduledImageWithFallback(ctx, {
      platform,
      channelId,
      guildId: sub.group_id || '',
      userId: sub.user_id || '',
    }, renderedImage, fallbackText, !!sub.mention_all)
    if (!sent) continue

    pushedCount++
    merchantSubMgr.upsert(key, {
      ...sub,
      last_push_round: roundInfo.round_id,
      last_matched_items: matched,
    })
  }

  return { subscriptions: Object.keys(subs).length, matched: matchedCount, pushed: pushedCount }
}

export function register(deps: PluginDeps) {
  const { ctx, config, client, merchantSubMgr } = deps

  ctx.command(TEXT.merchant, '\u67e5\u770b\u8fdc\u884c\u5546\u4eba\u5546\u54c1')
    .action(async ({ session }) => {
      const res = await client.getMerchantInfo(ctx, true)
      if (!res) return `\u83b7\u53d6\u8fdc\u884c\u5546\u4eba\u6570\u636e\u5931\u8d25\uff1a${client.getLastErrorBrief()}`

      const { data, fallback, templateName } = buildConfiguredMerchantRenderPayload(deps, res)
      const png = await deps.renderer.renderHtml(ctx, templateName, data)
      await sendImageWithFallback(session, png, fallback, 'merchant:yuanxing-shangren', deps.config)
    })

  ctx.command(TEXT.todayMerchant, '查看今日远行商人全部商品')
    .action(async ({ session }) => {
      const res = await client.getMerchantInfo(ctx, true)
      if (!res) return `获取今日远行商人数据失败：${client.getLastErrorBrief()}`

      const { data, fallback, templateName } = buildConfiguredTodayMerchantRenderPayload(deps, res)
      const png = await deps.renderer.renderHtml(ctx, templateName, data)
      await sendImageWithFallback(session, png, fallback, 'merchant:yuanxing-shangren:today', deps.config)
    })

  ctx.command(`${TEXT.subscribe} [args:text]`, '\u8ba2\u9605\u8fdc\u884c\u5546\u4eba\u5546\u54c1\u63d0\u9192')
    .action(async ({ session }, args) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !isBotAdmin(session, config.adminUserIds)) return '此指令仅限管理员使用。'
      if (target.privateChat && !config.merchantPrivateSubscriptionEnabled) return '个人私聊订阅功能已被禁用，请联系机器人管理员。'
      const parsed = parseMerchantSubscriptionArgs(args, config.merchantSubscriptionItems)
      const existing = merchantSubMgr.get(target.key)
      merchantSubMgr.upsert(target.key, {
        group_id: session.guildId || '',
        user_id: target.privateChat ? session.userId : '',
        type: target.privateChat ? '个人订阅' : '群订阅',
        channel_id: target.channelId,
        platform: target.platform,
        items: parsed.items,
        match_all: parsed.match_all,
        mention_all: target.privateChat ? false : parsed.mention_all,
        last_push_round: existing?.last_push_round ?? null,
        last_matched_items: existing?.last_matched_items ?? [],
        updated_by: session.userId!,
      })

      return `\u2705 \u5df2\u8ba2\u9605\u8fdc\u884c\u5546\u4eba\u5546\u54c1\uff1a${parsed.match_all ? '\u5168\u90e8\u5546\u54c1\uff08\u6bcf\u8f6e\u63a8\u9001\uff09' : parsed.items.join('\u3001')}\uff08${parsed.source}\uff09\uff1b${target.privateChat ? '个人订阅' : (parsed.mention_all ? '\u547d\u4e2d\u540e\u4f1a @\u5168\u4f53' : '\u547d\u4e2d\u540e\u4e0d @\u5168\u4f53')}`
    })

  ctx.command(TEXT.viewSubscribe, '\u67e5\u770b\u5f53\u524d\u4f1a\u8bdd\u7684\u8fdc\u884c\u5546\u4eba\u8ba2\u9605')
    .action(async ({ session }) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !isBotAdmin(session, config.adminUserIds)) return '此指令仅限管理员使用。'
      const sub = merchantSubMgr.get(target.key)
      const scopeName = target.privateChat ? '你' : '当前群组'
      if (!sub) return `${scopeName}未订阅远行商人。\n用法：${TEXT.subscribe} [1/0] [商品名1] [商品名2] ...\n或：${TEXT.subscribe} 全部（每轮直接推送整张商人图）`
      const itemsText = sub.match_all ? '全部商品（每轮推送）' : sub.items.join('、')
      return `${scopeName}订阅商品：${itemsText}\n提醒方式：${target.privateChat ? '私聊提醒' : (sub.mention_all ? '@全体' : '普通提醒')}`
    })

  ctx.command(TEXT.unsubscribe, '\u53d6\u6d88\u8fdc\u884c\u5546\u4eba\u8ba2\u9605')
    .action(async ({ session }) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !isBotAdmin(session, config.adminUserIds)) return '此指令仅限管理员使用。'
      merchantSubMgr.delete(target.key)
      return '\u2705 \u5df2\u53d6\u6d88\u8fdc\u884c\u5546\u4eba\u8ba2\u9605\u3002'
    })

  ctx.command('洛克').subcommand('.调试远行商人订阅', '立即执行一次远行商人订阅检查')
    .alias('洛克调试远行商人订阅')
    .action(async ({ session }) => {
      if (!isBotAdmin(session, config.adminUserIds)) return '此指令仅限管理员使用。'
      const result = await checkMerchantSubscriptions(deps)
      return `远行商人订阅检查完成：订阅 ${result.subscriptions} 条，命中 ${result.matched} 条，推送 ${result.pushed} 条。`
    })

  if (config.merchantSubscriptionEnabled) {
    if (config.merchantCheckMode === 'times' && config.merchantCheckTimes.length > 0) {
      let lastMerchantCheckKey = ''
      ctx.setInterval(async () => {
        const now = new Date()
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        if (!config.merchantCheckTimes.includes(timeStr)) return
        const checkKey = `${now.toDateString()}-${timeStr}`
        if (checkKey === lastMerchantCheckKey) return
        lastMerchantCheckKey = checkKey
        await checkMerchantSubscriptions(deps)
      }, 60000)
    } else {
      ctx.setInterval(async () => {
        await checkMerchantSubscriptions(deps)
      }, config.merchantCheckInterval)
    }
  }
}
