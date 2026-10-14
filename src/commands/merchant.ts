import { Logger } from 'koishi'
import { PluginDeps } from '../types'
import type { MerchantSubscription } from '../user'
import { compressPngImage, sendImageWithFallback } from '../send-image'
import { sendScheduledImageWithFallback } from '../subscription-send'
import { collectAllDayProductNames, normalizeMerchant, merchantTimestampMs, type MerchantNormalizeOptions } from '../merchant-service'
import type { MerchantPriceLog } from '../merchant-price-log'
import { describeMerchantItems, isAllAlias, resolveMerchantSelection } from '../merchant-catalog'
import { MerchantClock } from '../merchant-clock'
import { canManageSubscription, isDirectSession } from '../permissions'
import { createRunner } from '../subscription-runner'
import { AsyncLocalStorage } from 'node:async_hooks'
import { delay } from '../async-control'
import { buildIconFit, readImageMetrics, type ImageMetrics } from '../icon-metrics'

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
  price: number | null
  limit: number | null
  item_category: string
  allDay: boolean
  goods_id: string
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

// 商人卡片按原生尺寸渲染：1080 设计稿缩到 1/4 排版，再整体 zoom 放大；
// 视口宽 960 + deviceScaleFactor 4 → 3840 物理像素输出。
const MERCHANT_CARD_SOURCE_WIDTH = 1080
const MERCHANT_CARD_LAYOUT_SCALE = 0.25
const MERCHANT_CARD_OUTPUT_WIDTH = 3840
const MERCHANT_CARD_DEVICE_SCALE_FACTOR = 4
const MERCHANT_CARD_RENDER_SCALE = MERCHANT_CARD_LAYOUT_SCALE
const MERCHANT_CARD_RENDER_WIDTH = Math.ceil(MERCHANT_CARD_OUTPUT_WIDTH / MERCHANT_CARD_DEVICE_SCALE_FACTOR)
const MERCHANT_CARD_OUTPUT_SCALE = MERCHANT_CARD_RENDER_WIDTH / MERCHANT_CARD_SOURCE_WIDTH
const MERCHANT_CARD_RENDER_BASE_WIDTH = MERCHANT_CARD_SOURCE_WIDTH * MERCHANT_CARD_LAYOUT_SCALE
const MERCHANT_CARD_RENDER_ZOOM = MERCHANT_CARD_RENDER_WIDTH / MERCHANT_CARD_RENDER_BASE_WIDTH
const MERCHANT_CARD_STROKE_11 = 11 * MERCHANT_CARD_RENDER_SCALE
const MERCHANT_CARD_STROKE_10 = 10 * MERCHANT_CARD_RENDER_SCALE
const MERCHANT_CARD_OFFSET_3 = 3 * MERCHANT_CARD_RENDER_SCALE
// 今日卡片商品名只有 8.5px，沿用 11 倍描边半径会把字糊成一坨，单独用小半径
const MERCHANT_TODAY_NAME_STROKE = 3 * MERCHANT_CARD_RENDER_SCALE

// 单件商品卡里 .goods-img-wrap 的尺寸（模板基准 px），图标等面积归一的框；
// 「不透明内容」统一缩放到的面积约等于 55×55 方图，再大细长商品会溢出图标框。
const MERCHANT_ICON_BOX_WIDTH = 74
const MERCHANT_ICON_BOX_HEIGHT = 61.5
const MERCHANT_ICON_TARGET_AREA = 3000
// 单个图标取图超时；取不到就按原样渲染，不影响出卡片
const MERCHANT_ICON_FETCH_TIMEOUT_MS = 8000
const MERCHANT_CARD_ICON_BOX = {
  width: MERCHANT_ICON_BOX_WIDTH,
  height: MERCHANT_ICON_BOX_HEIGHT,
  targetArea: MERCHANT_ICON_TARGET_AREA,
}

// 今日卡片一轮一行：每行左侧轮次标签，右侧最多并排 5 件商品。
// 列宽固定（不随该轮商品数变化），否则同一张卡片里图标大小又会参差；
// 一轮超过 5 件时整行一起收窄、图标框跟着缩，保证不溢出行宽。
const MERCHANT_TODAY_START_Y = 592
const MERCHANT_TODAY_ROW_HEIGHT = 368
const MERCHANT_TODAY_ROW_GAP = 32
// 底部信息框压在最后一行下沿 21px（沿用旧版 bottomFrameTop = lastTop + 287 算法），
// 写成正间距会在末尾留出一大片空白。
const MERCHANT_TODAY_FRAME_OVERLAP = 21
const MERCHANT_TODAY_ROW_WIDTH = 260.75
const MERCHANT_TODAY_TAB_WIDTH = 38
const MERCHANT_TODAY_MAX_COLUMNS = 5
const MERCHANT_TODAY_CELL_WIDTH = (MERCHANT_TODAY_ROW_WIDTH - MERCHANT_TODAY_TAB_WIDTH) / MERCHANT_TODAY_MAX_COLUMNS
// 今日卡片的商品图标框（模板 .item-icon-wrap）；等面积归一基准，行收窄时按面积比缩小
const MERCHANT_TODAY_ICON_SIZE = 40
const MERCHANT_TODAY_ICON_TARGET_AREA = 1150

// 图标尺寸按「去掉签名参数的地址」缓存，避免每次出卡片重复取图；失败缓存 null 不再重试。
const iconMetricsCache = new Map<string, ImageMetrics | null>()

const defaultClock = new MerchantClock('Asia/Shanghai')
// Scoped to each synchronous view build; plugin instances never overwrite another clock.
const clockScope = new AsyncLocalStorage<MerchantClock>()
const currentClock = () => clockScope.getStore() || defaultClock

function getChinaParts(input: number | Date = Date.now()) {
  const ms = input instanceof Date ? input.getTime() : input
  const parts = currentClock().parts(ms)
  const [year, month, day] = parts.date.split('-').map(Number)
  return {
    year: year || 0,
    month: month || 0,
    day: day || 0,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

function padNumber(value: number) {
  return String(value).padStart(2, '0')
}

function getChinaDateText(input: number | Date = Date.now()) {
  const parts = getChinaParts(input)
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`
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

  const { start: startOfDay, end: endOfDay } = currentClock().dayBounds(now instanceof Date ? now.getTime() : now)
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

// @全体 的写法。
const MENTION_ALL_ALIASES = new Set(['@全体', '全体', '@所有人', 'at全体', 'at所有人'])

type MerchantSubscriptionArgs = {
  // null 表示本次未指定，沿用订阅里已有的设置。
  mentionAll: boolean | null
  match_all: boolean
  // 用户原始输入词条（去掉 @全体 / 1/0 前缀后），供商品目录解析。
  tokens: string[]
  items: string[]
  source: string
}

function parseMerchantSubscriptionArgs(args: string | undefined, defaultItems: string[]): MerchantSubscriptionArgs {
  const parts = (args || '').split(/\s+/).filter(Boolean)
  let mentionAll: boolean | null = null

  if (parts[0] === '1' || parts[0] === '0') {
    mentionAll = parts.shift() === '1'
  }
  // 支持「订阅远行商人 @全体 1 3」写法。
  for (let i = parts.length - 1; i >= 0; i--) {
    if (MENTION_ALL_ALIASES.has(parts[i].toLowerCase())) {
      mentionAll = true
      parts.splice(i, 1)
    }
  }

  const matchAll = parts.length === 1 && isAllAlias(parts[0])
  if (matchAll) parts.shift()

  const items = matchAll ? [] : (parts.length ? parts : defaultItems)
  const source = matchAll ? '全部商品' : (parts.length ? TEXT.customSource : TEXT.defaultSource)
  return { mentionAll, match_all: matchAll, tokens: parts, items, source }
}

function getSubscriptionTarget(session: any) {
  const platform = session.platform || session.bot?.platform || ''
  const privateChat = isDirectSession(session)
  const channelId = session.channelId || session.guildId || session.userId || ''
  const key = privateChat ? `private_${session.userId}` : (session.guildId || channelId)
  return { key, platform, channelId, privateChat }
}

function isBotAdmin(session: any, adminUserIds: string[]) {
  return adminUserIds.includes(session?.userId || '')
}

// 订阅管理权限：群主/管理员与 Bot 管理员按独立开关生效。
function canManageGroupSubscription(deps: PluginDeps, session: any) {
  return canManageSubscription(deps.config, session)
}

function sameStringArray(left: string[], right: string[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeMerchantProducts(res: any, now = new Date(), options?: MerchantNormalizeOptions): MerchantProductForRender[] {
  const nowMs = now.getTime()
  const { items } = normalizeMerchant(res, nowMs, options)
  return items.map((item) => {
    const source = { start_time: item.startsAt, end_time: item.endsAt }
    return {
      name: item.name,
      image: item.icon,
      time_label: formatProductWindow(source),
      category: classifyMerchantItem(source),
      round_id: getRoundForItem(source, now),
      is_active: item.active,
      start_time: item.startsAt,
      end_time: item.endsAt,
      price: item.price,
      limit: item.limit,
      item_category: item.category,
      allDay: item.allDay,
      goods_id: item.id,
    }
  })
}

// 实时接口只给当前轮次的价格，轮次一过就拿不到了；
// 每次拿到实时数据先按 goods_id + 轮次落盘，供当天后续轮次补价。
function recordLiveMerchantPrices(deps: Partial<PluginDeps>, res: any, now = new Date()) {
  const priceLog = deps.merchantPriceLog
  if (!priceLog || !res || res._source !== 'live' || !Array.isArray(res.goods)) return

  const nowMs = now.getTime()
  const currentRound = getCurrentMerchantRound(now).current ?? 0
  const mapping = new Map<string, any>()
  for (const meta of Array.isArray(res.goods_mapping) ? res.goods_mapping : []) {
    if (meta && meta.goods_id !== undefined && meta.goods_id !== null) mapping.set(String(meta.goods_id), meta)
  }
  for (const meta of Array.isArray(res._goods_mapping) ? res._goods_mapping : []) {
    if (meta && meta.goods_id !== undefined && meta.goods_id !== null && !mapping.has(String(meta.goods_id))) mapping.set(String(meta.goods_id), meta)
  }

  const priceOf = (value: any, key: 'real' | 'origin'): number => {
    if (value && typeof value === 'object') {
      const target = value[key] ?? (key === 'real' ? value.origin : value.real)
      const num = target && typeof target === 'object' ? Number(target.amount) : Number(target)
      return Number.isFinite(num) && num > 0 ? num : 0
    }
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : 0
  }

  // 轮次判定：带 next_refresh_time 的随轮次刷新，缺省视为全天（round 0）。
  const roundOf = (raw: any): number => {
    const refreshAt = merchantTimestampMs(raw?.next_refresh_time)
    if (!refreshAt) return 0
    return currentRound
  }

  const grouped = new Map<number, any[]>()
  for (const raw of res.goods) {
    if (!raw || typeof raw !== 'object') continue
    const goodsId = raw.goods_id ?? raw.id
    const meta = mapping.get(String(goodsId)) || {}
    const round = roundOf(raw)
    const list = grouped.get(round) || []
    list.push({
      goods_id: goodsId,
      goods_name: meta.goods_name || raw.goods_name || raw.name,
      item_id: meta.item_id,
      item_num: meta.item_num,
      buy_limit_num: raw.limit_buy_num,
      price: priceOf(raw.price, 'real'),
      origin_price: priceOf(raw.price, 'origin'),
    })
    grouped.set(round, list)
  }

  for (const [round, list] of grouped) {
    priceLog.record(list, { now, round })
  }
}

// 今日远行商人：历史轮次商品在实时接口拿不到价格（旧接口 random_goods 恒为 0），
// 用当天记录下来的实时价格补上。
function backfillTodayPrices(priceLog: MerchantPriceLog | undefined, products: MerchantProductForRender[], now = new Date()) {
  if (!priceLog) return products
  for (const product of products) {
    if (product.price && product.price > 0) continue
    const round = product.round_id ?? getRoundForItem({ start_time: product.start_time, end_time: product.end_time }, now) ?? 0
    const found = priceLog.lookup(product.goods_id, product.name, round)
    if (!found) continue
    product.price = found.price
    if (product.limit === null || product.limit === undefined) product.limit = found.buy_limit_num || null
  }
  return products
}

export function buildMerchantRenderParams(pageHeight: number) {
  return {
    pageHeight,
    renderWidth: MERCHANT_CARD_RENDER_WIDTH,
    renderHeight: Math.ceil(pageHeight * MERCHANT_CARD_OUTPUT_SCALE),
    renderBaseWidth: MERCHANT_CARD_RENDER_BASE_WIDTH,
    renderBaseHeight: pageHeight * MERCHANT_CARD_LAYOUT_SCALE,
    renderScale: MERCHANT_CARD_RENDER_SCALE,
    renderZoom: MERCHANT_CARD_RENDER_ZOOM,
    renderDeviceScaleFactor: MERCHANT_CARD_DEVICE_SCALE_FACTOR,
    renderStroke11: MERCHANT_CARD_STROKE_11,
    renderStroke10: MERCHANT_CARD_STROKE_10,
    renderStrokeName: MERCHANT_TODAY_NAME_STROKE,
    renderOffset3: MERCHANT_CARD_OFFSET_3,
  }
}

/** 把图标换算成模板用的 transform；没有测量结果就原样渲染。 */
function buildMerchantIconStyle(
  iconUrl: string,
  iconMetrics: Map<string, ImageMetrics> | undefined,
  box = MERCHANT_CARD_ICON_BOX,
) {
  const fallback = { iconScale: 1, iconOffsetX: 0, iconOffsetY: 0 }
  const url = String(iconUrl || '').trim()
  if (!url || !iconMetrics) return fallback

  const fit = buildIconFit(iconMetrics.get(url), box)
  return fit
    ? { iconScale: fit.scale, iconOffsetX: fit.offsetX, iconOffsetY: fit.offsetY }
    : fallback
}

async function measureMerchantIcon(deps: PluginDeps, url: string): Promise<ImageMetrics | null> {
  const cacheKey = String(url || '').trim().split('?')[0]
  if (!cacheKey) return null
  if (iconMetricsCache.has(cacheKey)) return iconMetricsCache.get(cacheKey) ?? null

  let metrics: ImageMetrics | null = null
  try {
    if (!deps.ctx?.http) throw new Error('http service unavailable')
    const response: any = await (deps.ctx.http as any)('GET', url, {
      responseType: 'arraybuffer',
      timeout: MERCHANT_ICON_FETCH_TIMEOUT_MS,
    })
    const status = Number(response?.status) || 0
    if (status >= 400) throw new Error(`HTTP ${status}`)
    const body = response?.data
    metrics = readImageMetrics(Buffer.isBuffer(body) ? body : Buffer.from(body || []))
  } catch (error: any) {
    logger.warn(`读取商品图标失败（${cacheKey}）：${error?.message || error}`)
  }

  iconMetricsCache.set(cacheKey, metrics)
  return metrics
}

/** 批量量图标，返回 Map<icon_url, metrics>；个别失败只是缺那一条。 */
async function collectMerchantIconMetrics(deps: PluginDeps, urls: Iterable<string>): Promise<Map<string, ImageMetrics>> {
  const unique = [...new Set([...urls].map(url => String(url || '').trim()).filter(Boolean))]
  const metrics = new Map<string, ImageMetrics>()
  await Promise.all(unique.map(async (url) => {
    const measured = await measureMerchantIcon(deps, url)
    if (measured) metrics.set(url, measured)
  }))
  return metrics
}

/** 收集商人响应里出现过的图标地址（去重）；图标只挂在旧接口的 get_props / get_extra_props / get_pets 上。 */
function collectMerchantIconUrls(res: any): string[] {
  let root = res || {}
  if (root.result && typeof root.result === 'object') root = root.result
  const merchantActivities = Array.isArray(root.merchantActivities)
    ? root.merchantActivities
    : Array.isArray(root.merchant_activities) ? root.merchant_activities : []

  const urls = new Set<string>()
  for (const activity of merchantActivities) {
    for (const key of ['get_props', 'get_extra_props', 'get_pets']) {
      for (const item of Array.isArray(activity?.[key]) ? activity[key] : []) {
        const url = String(item?.icon_url || '').trim()
        if (url) urls.add(url)
      }
    }
  }
  return [...urls]
}

function buildMerchantGoodsAll(
  products: MerchantProductForRender[],
  options: { includeEnded: boolean },
): MerchantCardItem[] {
  const catOrder: Record<MerchantCategoryKey, number> = { round: 0, normal: 1, weekend: 2 }

  const goodsAll: MerchantCardItem[] = products.map((product) => {
    const limit = product.limit
    const limitText = limit === undefined || limit === null ? '--' : String(limit)
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
      price: product.price ?? 0,
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

  return goodsAll
}

export function buildMerchantCardItems(
  products: MerchantProductForRender[],
  options: { includeEnded: boolean, iconMetrics?: Map<string, ImageMetrics> },
) {
  const startY = 592
  const cardHeight = 308
  const gap = 43

  const goodsAll = buildMerchantGoodsAll(products, options)
  const goods = goodsAll.map((item, index) => ({
    ...item,
    ...buildMerchantIconStyle(item.iconUrl, options.iconMetrics),
    num: String(index + 1).padStart(2, '0'),
    top: startY + index * (cardHeight + gap),
  }))
  const lastCardTop = goods.length > 0 ? goods[goods.length - 1].top : startY
  const bottomFrameTop = lastCardTop + 287
  const pageHeight = bottomFrameTop + 160

  return { goods, bottomFrameTop, ...buildMerchantRenderParams(pageHeight) }
}

/**
 * 今日卡片按轮次分行：热销（roundId 0，全天/跨天在架）置顶，第 1~4 轮升序。
 * 每件商品落在哪一轮由商品数据的 roundId 事先算好。
 */
export function buildTodayRows(
  goods: MerchantCardItem[],
  currentRoundId: number | null,
  iconMetrics?: Map<string, ImageMetrics>,
) {
  const grouped = new Map<number, MerchantCardItem[]>()
  for (const item of goods) {
    const roundId = Number(item.roundId) || 0
    if (!grouped.has(roundId)) grouped.set(roundId, [])
    grouped.get(roundId)!.push(item)
  }

  const roundIds = [...grouped.keys()].sort((a, b) => {
    if (a === 0) return -1
    if (b === 0) return 1
    return a - b
  })

  const available = MERCHANT_TODAY_ROW_WIDTH - MERCHANT_TODAY_TAB_WIDTH

  return roundIds.map((roundId, index) => {
    const win = ROUND_WINDOWS.find(item => item.id === roundId)
    const list = grouped.get(roundId)!
    const cellWidth = Math.min(MERCHANT_TODAY_CELL_WIDTH, available / Math.max(list.length, 1))
    const iconSize = Math.min(MERCHANT_TODAY_ICON_SIZE, cellWidth - 4)
    const iconBox = {
      width: iconSize,
      height: iconSize,
      targetArea: MERCHANT_TODAY_ICON_TARGET_AREA * ((iconSize / MERCHANT_TODAY_ICON_SIZE) ** 2),
    }

    return {
      roundId,
      label: win ? `第${roundId}轮` : '热销',
      timeLabel: win ? `${padNumber(win.startHour)}-${padNumber(win.endHour)}` : '全天',
      isCurrent: Boolean(currentRoundId) && roundId === currentRoundId,
      top: MERCHANT_TODAY_START_Y + (index * (MERCHANT_TODAY_ROW_HEIGHT + MERCHANT_TODAY_ROW_GAP)),
      cellWidth,
      iconSize,
      items: list.map(item => ({ ...item, ...buildMerchantIconStyle(item.iconUrl, iconMetrics, iconBox) })),
    }
  })
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

// 商品缺图标时按 item_id/item_kind 拼 Wiki 物品图，仍缺失时用本地 logo 兜底。
function merchantViewOptions(deps: Partial<PluginDeps>): MerchantNormalizeOptions {
  const secondsOfDay = (ms: number) => {
    const parts = getChinaParts(ms)
    return parts.hour * 3600 + parts.minute * 60 + parts.second
  }
  return {
    secondsOfDay,
    assetBaseUrl: deps.client?.wikiAssetBaseUrl,
    fallbackIcon: deps.renderer?.resourceUrl?.('img/logo.cVSpb3sL.png') || '',
  }
}

function buildMerchantRenderPayload(res: any, now = new Date(), options?: MerchantNormalizeOptions, iconMetrics?: Map<string, ImageMetrics>) {
  const allProducts = normalizeMerchantProducts(res, now, options)
  const roundInfo = getCurrentMerchantRound(now)
  const products = getCurrentMerchantProducts(allProducts, roundInfo)
  const currentWindow = ROUND_WINDOWS.find(win => win.id === roundInfo.current)
  const timeRange = currentWindow
    ? `${padNumber(currentWindow.startHour)}:00-${padNumber(currentWindow.endHour)}:00`
    : '--:--~--:--'
  const data = {
    dateStr: getMerchantDateStr(now),
    timeRange,
    ...buildMerchantCardItems(products, { includeEnded: false, iconMetrics }),
  }
  const fallback = buildMerchantFallbackText(TEXT.merchant, products, roundInfo)

  return { products, roundInfo, data, fallback }
}

function buildLegacyMerchantRenderPayload(res: any, now = new Date(), options?: MerchantNormalizeOptions) {
  const allProducts = normalizeMerchantProducts(res, now, options)
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

function buildTodayMerchantRenderPayload(res: any, now = new Date(), options?: MerchantNormalizeOptions, priceLog?: MerchantPriceLog, iconMetrics?: Map<string, ImageMetrics>) {
  const products = backfillTodayPrices(priceLog, normalizeMerchantProducts(res, now, options)
    .filter(product => {
      const source = {
        start_time: product.start_time,
        end_time: product.end_time,
      }
      return isMerchantItemToday(source, now)
    }), now)
  const roundInfo = getCurrentMerchantRound(now)
  const goodsAll = buildMerchantGoodsAll(products, { includeEnded: true })
  const rows = buildTodayRows(goodsAll, roundInfo.current, iconMetrics)

  // 扁平 goods 仍按行序编号，方便日志与订阅侧复用
  const goods: (MerchantCardItem & { num: string })[] = []
  for (const row of rows) {
    for (const item of row.items) {
      goods.push({ ...item, num: String(goods.length + 1).padStart(2, '0') })
    }
  }

  const lastRowTop = rows.length > 0 ? rows[rows.length - 1].top : MERCHANT_TODAY_START_Y
  const bottomFrameTop = (lastRowTop + MERCHANT_TODAY_ROW_HEIGHT) - MERCHANT_TODAY_FRAME_OVERLAP
  const pageHeight = bottomFrameTop + 160

  const data = {
    dateStr: getMerchantDateStr(now),
    goods,
    rows,
    startTop: MERCHANT_TODAY_START_Y,
    bottomFrameTop,
    ...buildMerchantRenderParams(pageHeight),
  }
  const fallback = buildMerchantFallbackText(`今日远行商人 (${getChinaDateText(now)})`, products)

  return { products, data, fallback }
}

function buildLegacyTodayMerchantRenderPayload(res: any, now = new Date(), options?: MerchantNormalizeOptions, priceLog?: MerchantPriceLog) {
  const allProducts = backfillTodayPrices(priceLog, normalizeMerchantProducts(res, now, options)
    .filter(product => {
      const source = {
        start_time: product.start_time,
        end_time: product.end_time,
      }
      return isMerchantItemToday(source, now)
    }), now)
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

async function buildConfiguredMerchantRenderPayload(deps: PluginDeps, res: any, now = new Date()) {
  const options = merchantViewOptions(deps)
  return clockScope.run(new MerchantClock(deps.config.merchantTimezone || 'Asia/Shanghai'), async () => {
    if (useLegacyMerchantUi(deps)) {
      return {
        ...buildLegacyMerchantRenderPayload(res, now, options),
        templateName: 'yuanxing-shangren' as const,
      }
    }
    const iconMetrics = await collectMerchantIconMetrics(deps, collectMerchantIconUrls(res))
    return {
      ...buildMerchantRenderPayload(res, now, options, iconMetrics),
      templateName: 'yuanxing-shangren/merchant' as const,
    }
  })
}

async function buildConfiguredTodayMerchantRenderPayload(deps: PluginDeps, res: any, now = new Date()) {
  const options = merchantViewOptions(deps)
  return clockScope.run(new MerchantClock(deps.config.merchantTimezone || 'Asia/Shanghai'), async () => {
    if (useLegacyMerchantUi(deps)) {
      return {
        ...buildLegacyTodayMerchantRenderPayload(res, now, options, deps.merchantPriceLog),
        templateName: 'yuanxing-shangren' as const,
      }
    }
    const iconMetrics = await collectMerchantIconMetrics(deps, collectMerchantIconUrls(res))
    return {
      ...buildTodayMerchantRenderPayload(res, now, options, deps.merchantPriceLog, iconMetrics),
      templateName: 'yuanxing-shangren/today' as const,
    }
  })
}

// 读取订阅当日已推送的全天商品名集合（跨天自动失效）。
function getAlldayPushedNames(sub: MerchantSubscription, todayKey: string): Set<string> {
  const state = sub.allday_pushed
  if (!state || state.date !== todayKey) return new Set()
  return new Set((state.names || []).map(String))
}

// 把本次推送命中的全天商品记入当日已推送状态。
function recordAlldayPushed(sub: MerchantSubscription, todayKey: string, names: string[]): MerchantSubscription['allday_pushed'] {
  const existing = sub.allday_pushed?.date === todayKey ? [...(sub.allday_pushed.names || [])] : []
  for (const name of names) {
    if (!existing.includes(name)) existing.push(name)
  }
  return existing.length ? { date: todayKey, names: existing } : undefined
}

async function checkMerchantSubscriptions(deps: PluginDeps, signal?: AbortSignal) {
  const { ctx, client, merchantSubMgr, renderer, config } = deps
  const subs = merchantSubMgr.getAll()
  if (!Object.keys(subs).length) return { subscriptions: 0, matched: 0, pushed: 0, kind: 'no-subscriptions' as const }

  if (signal?.aborted) return { subscriptions: 0, matched: 0, pushed: 0, kind: 'cancelled' as const }
  const res = await client.getMerchantInfo(ctx, true, { signal })
  if (signal?.aborted) return { subscriptions: 0, matched: 0, pushed: 0, kind: 'cancelled' as const }
  // 接口失败视为空结果等待稍后重试，不再发送空商品图片。
  if (!res) {
    logger.warn(`远行商人订阅查询失败：${client.getLastErrorBrief?.() || '接口无返回'}，等待重试`)
    return { subscriptions: Object.keys(subs).length, matched: 0, pushed: 0, kind: 'error' as const }
  }
  recordLiveMerchantPrices(deps, res)

  const { products, roundInfo, data, fallback, templateName } = await buildConfiguredMerchantRenderPayload(deps, res)
  if (!products.length) return { subscriptions: Object.keys(subs).length, matched: 0, pushed: 0, kind: 'empty' as const }
  const productNames = products.map((p: any) => p.name || '').filter(Boolean)
  // 开启后全天商品每个订阅每天只推送一次；仅作用于按商品名订阅的推送，
  // “全部商品”订阅仍是每轮推送整张商人图。
  const alldayNames = config.merchantAllDayOnceEnabled ? collectAllDayProductNames(products) : new Set<string>()
  const todayKey = new MerchantClock(config.merchantTimezone || 'Asia/Shanghai').date()
  const rendered = await renderer.renderHtml(ctx, templateName, data, { signal })
  const renderedImage = rendered ? compressPngImage(rendered, config) : null
  let matchedCount = 0
  let pushedCount = 0

  for (const [key, sub] of Object.entries(subs)) {
    if (signal?.aborted) break
    if (JSON.stringify(merchantSubMgr.getAll()[key]) !== JSON.stringify(sub)) continue
    const matchAll = !!sub.match_all
    let matched = matchAll
      ? productNames
      : sub.items.filter((item: string) => productNames.some(n => n.includes(item)))
    if (!matchAll && !matched.length) continue
    if (matchAll && !products.length) continue
    // 当天已推送过的全天商品不再计入本轮命中，全部被剔除则本轮不推送。
    // 订阅词条按子串匹配商品名，只有词条命中的商品全部为全天时才按全天去重。
    const onlyAlldayItem = (item: string) => {
      if (!alldayNames.size) return false
      const hits = productNames.filter(n => n.includes(item))
      return hits.length > 0 && hits.every(n => alldayNames.has(n))
    }
    let pushItems = matched
    if (!matchAll && alldayNames.size) {
      const pushedToday = getAlldayPushedNames(sub, todayKey)
      if (pushedToday.size) pushItems = matched.filter(item => !(onlyAlldayItem(item) && pushedToday.has(item)))
    }
    if (!matchAll && !pushItems.length) continue
    matchedCount++
    if (matchAll) {
      if (sub.last_push_round === roundInfo.round_id) continue
    } else {
      if (sub.last_push_round === roundInfo.round_id && sameStringArray(matched, sub.last_matched_items || [])) continue
    }

    const msg = matchAll
      ? `\ud83d\udd14 \u8fdc\u884c\u5546\u4eba\u5237\u65b0\u63d0\u9192\n\u5f53\u524d\u5546\u54c1\uff1a${productNames.join('\u3001')}`
      : `\ud83d\udd14 \u8fdc\u884c\u5546\u4eba\u5237\u65b0\u63d0\u9192\n\u5f53\u524d\u5546\u54c1\uff1a${productNames.join('\u3001')}\n\u5339\u914d\u8ba2\u9605\uff1a${pushItems.join('\u3001')}`
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
      selfId: sub.self_id || '',
    }, renderedImage, fallbackText, !!sub.mention_all, signal)
    if (!sent || signal?.aborted || JSON.stringify(merchantSubMgr.getAll()[key]) !== JSON.stringify(sub)) continue

    pushedCount++
    merchantSubMgr.upsert(key, {
      ...sub,
      last_push_round: roundInfo.round_id,
      last_matched_items: matched,
      allday_pushed: matchAll || !alldayNames.size
        ? sub.allday_pushed
        : recordAlldayPushed(sub, todayKey, pushItems.filter(onlyAlldayItem)),
    })
  }

  return { subscriptions: Object.keys(subs).length, matched: matchedCount, pushed: pushedCount, kind: 'success' as const }
}

export function register(deps: PluginDeps) {
  const merchantRunner = createRunner(deps.ctx)
  const merchantClock = new MerchantClock(deps.config.merchantTimezone || 'Asia/Shanghai')
  const { ctx, config, client, merchantSubMgr } = deps

  ctx.command(TEXT.merchant, '\u67e5\u770b\u8fdc\u884c\u5546\u4eba\u5546\u54c1')
    .alias('yxsr')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const res = await client.getMerchantInfo(ctx, true)
      if (!res) return `\u83b7\u53d6\u8fdc\u884c\u5546\u4eba\u6570\u636e\u5931\u8d25\uff1a${client.getLastErrorBrief()}`
      recordLiveMerchantPrices(deps, res)

      const { data, fallback, templateName } = await buildConfiguredMerchantRenderPayload(deps, res)
      const png = await deps.renderer.renderHtml(ctx, templateName, data)
      await sendImageWithFallback(session, png, fallback, 'merchant:yuanxing-shangren', deps.config)
    })

  ctx.command(TEXT.todayMerchant, '查看今日远行商人全部商品')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const res = await client.getMerchantInfo(ctx, true)
      if (!res) return `获取今日远行商人数据失败：${client.getLastErrorBrief()}`
      recordLiveMerchantPrices(deps, res)

      const { data, fallback, templateName } = await buildConfiguredTodayMerchantRenderPayload(deps, res)
      const png = await deps.renderer.renderHtml(ctx, templateName, data)
      await sendImageWithFallback(session, png, fallback, 'merchant:yuanxing-shangren:today', deps.config)
    })

  // 查看商品目录与订阅序号。
  ctx.command('商人商品', '查看远行商人商品列表与订阅序号')
    .alias('洛克.商人商品')
    .alias('洛克商人商品')
    .userFields(['authority'])
    .action(async () => {
      const catalog = await deps.merchantCatalog.getCatalog()
      if (!catalog.length) return '暂时取不到远行商人商品列表，请稍后再试。'

      const lines = [
        `远行商人商品列表（共 ${catalog.length} 件）`,
        `订阅写法：${TEXT.subscribe} 1 3 5，也可以用商品名`,
        '',
      ]
      for (const item of catalog) lines.push(`${item.index}. ${item.name}`)
      return lines.join('\n')
    })

  ctx.command(`${TEXT.subscribe} [args:text]`, '\u8ba2\u9605\u8fdc\u884c\u5546\u4eba\u5546\u54c1\u63d0\u9192')
    .userFields(['authority'])
    .action(async ({ session }, args) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !canManageGroupSubscription(deps, session)) return '此指令仅限群管理员或机器人管理员使用。'
      if (target.privateChat && !config.merchantPrivateSubscriptionEnabled) return '个人私聊订阅功能已被禁用，请联系机器人管理员。'
      const parsed = parseMerchantSubscriptionArgs(args, config.merchantSubscriptionItems)
      const existing = merchantSubMgr.get(target.key)
      // 序号 / 商品名 / 全部 都经商品目录解析，序号命中后换成规范名落盘。
      const catalog = await deps.merchantCatalog.getCatalog()
      const resolved = resolveMerchantSelection(parsed.tokens, catalog)
      const matchAll = parsed.match_all || resolved.all
      const hasInput = parsed.match_all || parsed.tokens.length > 0
      if (hasInput && !matchAll && !resolved.names.length) {
        return [
          `没有识别到可订阅的商品：${resolved.unknownIndexes.join('、') || parsed.tokens.join('、')}`,
          `先用 商人商品 查看商品序号，再按序号或名称订阅。`,
        ].join('\n')
      }
      // 不带商品参数重复订阅时，沿用上次配置（全部模式或商品列表），
      // 而不是悄悄重置成配置默认商品。
      let sourceHint: string
      let items: string[]
      if (matchAll) {
        items = []
        sourceHint = '全部商品（每轮推送）'
      } else if (resolved.names.length) {
        items = resolved.names
        sourceHint = '本次指定'
      } else if (existing && (existing.match_all || (existing.items || []).length > 0)) {
        items = existing.items || []
        sourceHint = '沿用上次配置'
      } else {
        items = config.merchantSubscriptionItems
        sourceHint = '默认商品配置'
      }
      const matchAllFinal = matchAll || (resolved.names.length === 0 && !hasInput && existing?.match_all === true)
      // 未显式指定 1/0 或 @全体 时沿用上次设置。
      const mentionAll = target.privateChat
        ? false
        : (parsed.mentionAll === null ? (existing?.mention_all ?? false) : parsed.mentionAll)
      merchantSubMgr.upsert(target.key, {
        group_id: session.guildId || '',
        user_id: target.privateChat ? session.userId : '',
        type: target.privateChat ? '个人订阅' : '群订阅',
        channel_id: target.channelId,
        platform: target.platform,
        self_id: session.selfId || session.bot?.selfId || '',
        items,
        match_all: matchAllFinal,
        mention_all: mentionAll,
        last_push_round: existing?.last_push_round ?? null,
        last_matched_items: existing?.last_matched_items ?? [],
        allday_pushed: existing?.allday_pushed,
        updated_by: session.userId!,
      })

      const lines = [
        `\u2705 \u5df2\u8ba2\u9605\u8fdc\u884c\u5546\u4eba\u5546\u54c1\uff08${target.privateChat ? '个人订阅' : '本群订阅'}）：${matchAllFinal ? '全部商品（每轮推送整张商人图）' : `监听 ${items.length} 件商品`}`,
      ]
      if (!matchAllFinal) lines.push(`监听商品：${describeMerchantItems(items, catalog)}`)
      lines.push(`商品来源：${sourceHint}。`)
      lines.push(mentionAll ? '命中后会尝试 @全体。' : '命中后不会 @全体。')
      if (resolved.unknownIndexes.length) lines.push(`未找到的序号：${resolved.unknownIndexes.join('、')}（已忽略）。`)
      if (resolved.unrecognizedNames.length) lines.push(`商品目录里没有：${resolved.unrecognizedNames.join('、')}（已按原名订阅）。`)
      lines.push('')
      lines.push('可用格式：')
      lines.push(`${TEXT.subscribe} 1 3 国王球  按序号或名称订阅`)
      lines.push(`${TEXT.subscribe} 全部  订阅全部商品，每轮推送整张商人图`)
      lines.push(`${TEXT.subscribe} @全体 1 3  命中后尝试 @全体`)
      lines.push(`商人商品  查看商品序号`)
      return lines.join('\n')
    })

  ctx.command(TEXT.viewSubscribe, '\u67e5\u770b\u5f53\u524d\u4f1a\u8bdd\u7684\u8fdc\u884c\u5546\u4eba\u8ba2\u9605')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !canManageGroupSubscription(deps, session)) return '此指令仅限群管理员或机器人管理员使用。'
      const sub = merchantSubMgr.get(target.key)
      const scopeName = target.privateChat ? '你' : '当前群组'
      if (!sub) return `${scopeName}未订阅远行商人。\n用法：${TEXT.subscribe} [1/0] [商品名1] [商品名2] ...\n或：${TEXT.subscribe} 全部（每轮直接推送整张商人图）`
      const catalog = await deps.merchantCatalog.getCatalog()
      const itemsText = sub.match_all ? '全部商品（每轮推送）' : describeMerchantItems(sub.items || [], catalog) || (sub.items || []).join('、')
      return `${scopeName}订阅商品：${itemsText}\n提醒方式：${target.privateChat ? '私聊提醒' : (sub.mention_all ? '@全体' : '普通提醒')}`
    })

  ctx.command(TEXT.unsubscribe, '\u53d6\u6d88\u8fdc\u884c\u5546\u4eba\u8ba2\u9605')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const target = getSubscriptionTarget(session)
      if (!target.privateChat && !canManageGroupSubscription(deps, session)) return '此指令仅限群管理员或机器人管理员使用。'
      merchantSubMgr.delete(target.key)
      return '\u2705 \u5df2\u53d6\u6d88\u8fdc\u884c\u5546\u4eba\u8ba2\u9605\u3002'
    })

  ctx.command('洛克').subcommand('.调试远行商人订阅', '立即执行一次远行商人订阅检查')
    .alias('洛克调试远行商人订阅')
    .userFields(['authority'])
    .action(async ({ session }) => {
      if (!isBotAdmin(session, config.adminUserIds)) return '此指令仅限管理员使用。'
      const result = await merchantRunner(signal => checkMerchantSubscriptions(deps, signal))
      if (!result) return '订阅检查正在运行或插件已停止。'
      return `远行商人订阅检查完成：订阅 ${result.subscriptions} 条，命中 ${result.matched} 条，推送 ${result.pushed} 条。`
    })

  const roundKey = () => {
    const p = merchantClock.parts()
    return p.date + ':' + Math.floor(p.hour / 4)
  }
  const runMerchantCheck = () => merchantRunner(async signal => {
    const round = roundKey()
    for (let retry = 0; retry <= 3; retry++) {
      if (signal.aborted || (retry > 0 && roundKey() !== round)) return
      if (!Object.keys(merchantSubMgr.getAll()).length) return
      const result = await checkMerchantSubscriptions(deps, signal)
      // 接口失败与空结果一样等待稍后重试，避免直接放弃本轮推送。
      if ((result.kind !== 'empty' && result.kind !== 'error') || retry === 3) return
      await delay(240000 + Math.floor(Math.random() * 60001) - 30000, signal)
    }
  }).catch(err => { if (!merchantRunner.aborted()) logger.warn('远行商人订阅检查失败: ' + err) })

  if (config.merchantSubscriptionEnabled) {
    if (config.merchantCheckMode === 'times' && config.merchantCheckTimes.length > 0) {
      const times = config.merchantCheckTimes.filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      let lastWallKey = ''
      const schedule = (after = Date.now()) => {
        if (merchantRunner.aborted()) return
        const target = merchantClock.nextTimeFor(times, after)
        if (target === null) return
        const wallKey = merchantClock.date(target) + ':' + merchantClock.timeText(target)
        if (wallKey === lastWallKey) { schedule(target); return }
        const jitter = Math.floor(Math.random() * 60001) - 30000
        ctx.setTimeout(() => {
          lastWallKey = wallKey
          void runMerchantCheck()
          schedule(target!)
        }, Math.max(0, target + jitter - Date.now()))
      }
      schedule()
    } else {
      ctx.setInterval(() => {
        ctx.setTimeout(() => { void runMerchantCheck() }, Math.floor(Math.random() * 30001))
      }, Math.max(30000, config.merchantCheckInterval || 300000))
    }
  }
}
