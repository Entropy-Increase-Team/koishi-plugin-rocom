import { Logger } from 'koishi'
import { PluginDeps } from '../types'
import { compressPngImage, sendImageWithFallback } from '../send-image'
import { sendScheduledImageWithFallback } from '../subscription-send'

const logger = new Logger('rocom-merchant')

const TEXT = {
  merchant: '\u8fdc\u884c\u5546\u4eba',
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

const CHINA_TIMEZONE = 'Asia/Shanghai'
const chinaPartsFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function getChinaParts(timestampMs: number) {
  const parts: Record<string, string> = {}
  for (const item of chinaPartsFormatter.formatToParts(new Date(timestampMs))) {
    if (item.type !== 'literal') parts[item.type] = item.value
  }
  return {
    hour: Number(parts.hour || '0'),
    minute: Number(parts.minute || '0'),
  }
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
    const date = new Date(timestamp)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${month}-${day}`
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${hour}:${minute}`
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

function getActiveProducts(res: any): any[] {
  const activity = getMerchantActivity(res)
  const groups: any[][] = []
  if (Array.isArray(activity?.products)) groups.push(activity.products)
  if (Array.isArray(activity?.product_list)) groups.push(activity.product_list)
  if (Array.isArray(activity?.get_props)) groups.push(activity.get_props)
  if (Array.isArray(activity?.get_extra_props)) groups.push(activity.get_extra_props)
  if (Array.isArray(activity?.get_pets)) groups.push(activity.get_pets)

  const merged: any[] = []
  const seen = new Set<string>()
  const now = Date.now()
  for (const list of groups) {
    for (const item of list) {
      const start = normalizeTimestamp(item?.start_time) ?? 0
      const end = normalizeTimestamp(item?.end_time) ?? Infinity
      if (now < start || now >= end) continue
      const key = `${item?.id ?? ''}|${item?.name ?? ''}|${start}|${end === Infinity ? 'inf' : end}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function getCurrentMerchantRound(): MerchantRoundInfo {
  const now = new Date()
  const hour = now.getHours()
  const rounds = [8, 12, 16, 20]
  let currentRound: number | null = null
  let nextRound: number | null = null

  for (let i = 0; i < rounds.length; i++) {
    if (hour >= rounds[i] && (i === rounds.length - 1 || hour < rounds[i + 1])) {
      currentRound = i + 1
      nextRound = i < rounds.length - 1 ? rounds[i + 1] : rounds[0]
      break
    }
  }
  if (currentRound === null) nextRound = rounds[0]

  const nextTime = new Date(now)
  if (nextRound! <= hour) nextTime.setDate(nextTime.getDate() + 1)
  nextTime.setHours(nextRound!, 0, 0, 0)

  const diff = nextTime.getTime() - now.getTime()
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  return {
    current: currentRound,
    total: rounds.length,
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

function buildMerchantRenderPayload(res: any) {
  const products = getActiveProducts(res)
  const roundInfo = getCurrentMerchantRound()
  const activity = getMerchantActivity(res)

  const renderedProducts = products.map((p: any) => ({
    name: p.name || TEXT.unknown,
    image: p.icon_url || '',
    time_label: formatProductWindow(p),
    category: classifyMerchantItem(p),
  }))

  const categoryMap: Record<MerchantCategoryKey, typeof renderedProducts> = {
    normal: [],
    round: [],
    weekend: [],
  }
  for (const product of renderedProducts) {
    categoryMap[product.category].push(product)
  }
  const categories = CATEGORY_ORDER
    .filter(key => categoryMap[key].length > 0)
    .map(key => ({
      key,
      label: CATEGORY_LABELS[key],
      products: categoryMap[key],
    }))

  const data = {
    background: '',
    title: activity.name || TEXT.merchant,
    subtitle: activity.start_date || '\u6bcf\u65e5 08:00 / 12:00 / 16:00 / 20:00 \u5237\u65b0',
    titleIcon: true,
    product_count: renderedProducts.length,
    round_info: roundInfo,
    categories,
    products: renderedProducts,
  }

  const fallbackLines: string[] = []
  if (renderedProducts.length) {
    fallbackLines.push(`\u8fdc\u884c\u5546\u4eba\u5f53\u524d\u5546\u54c1\uff08\u5171 ${renderedProducts.length} \u4ef6\uff09`)
    fallbackLines.push(`\u8f6e\u6b21\uff1a${roundInfo.current || TEXT.notOpen}\uff0c\u5269\u4f59\uff1a${roundInfo.countdown}`)
    fallbackLines.push('')
    for (const cat of categories) {
      fallbackLines.push(`\u3010${cat.label}\u3011`)
      cat.products.forEach((product, index) => {
        const tail = product.time_label ? ` (${product.time_label})` : ''
        fallbackLines.push(`  ${index + 1}. ${product.name}${tail}`)
      })
      fallbackLines.push('')
    }
  } else {
    fallbackLines.push('\u5f53\u524d\u8fdc\u884c\u5546\u4eba\u6682\u65e0\u5546\u54c1\u3002')
  }
  const fallback = fallbackLines.join('\n').trimEnd()

  return { products: renderedProducts, roundInfo, data, fallback }
}

async function checkMerchantSubscriptions(deps: PluginDeps) {
  const { ctx, client, merchantSubMgr, renderer, config } = deps
  const res = await client.getMerchantInfo(ctx, true)
  if (!res) return { subscriptions: 0, matched: 0, pushed: 0 }

  const { products, roundInfo, data, fallback } = buildMerchantRenderPayload(res)
  const productNames = products.map((p: any) => p.name || '').filter(Boolean)
  const rendered = await renderer.renderHtml(ctx, 'yuanxing-shangren', data)
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

      const { data, fallback } = buildMerchantRenderPayload(res)
      const png = await deps.renderer.renderHtml(ctx, 'yuanxing-shangren', data)
      await sendImageWithFallback(session, png, fallback, 'merchant:yuanxing-shangren', deps.config)
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
