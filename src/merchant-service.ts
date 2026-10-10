import { isObject } from './client'

export interface MerchantItem {
  id: string
  parentId?: string
  name: string
  icon: string
  price: number | null
  limit: number | null
  startsAt: number | null // 毫秒
  endsAt: number | null   // 毫秒
  active: boolean
  category: string
  source: 'live' | 'legacy'
  allDay: boolean        // 上游 v4.2.0：全天在售商品（跨多个 4 小时轮次）
  itemId?: string        // 上游 v4.2.1：goods_mapping 物品 ID，缺图标时拼 Wiki 物品图
  itemKind?: string
}

export interface NormalizedMerchant {
  source: 'live' | 'legacy'
  items: MerchantItem[]
}

export const numberOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 价格可能直接是数字，也可能是 { real, origin } 或 { amount }（上游 v4.1.0）。
export function livePrice(value: any): number | null {
  const selected = value && typeof value === 'object'
    ? value.real ?? value.origin : value
  return numberOrNull(selected && typeof selected === 'object'
    ? selected.amount : selected)
}

// 秒/毫秒时间戳统一为毫秒；0/空值视为无时间。
export function merchantTimestampMs(value: any): number | null {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.abs(timestamp) < 100_000_000_000 ? timestamp * 1000 : timestamp
}

export interface MerchantNormalizeOptions {
  // 上游 v4.2.0：仅知结束时间的全天判定需按商人时区取“当日秒数”。
  secondsOfDay?: (ms: number) => number
  // 上游 v4.2.1：接口缺图标时按 item_id/item_kind 拼 Wiki 公共物品图，以及本地兜底图。
  assetBaseUrl?: string
  fallbackIcon?: string
}

const MERCHANT_ROUND_SPAN_MS = 4 * 3600_000

// 上游 v4.2.0：按接口真实字段判定商品是否全天在售，而非 4 小时轮次商品。
// - 实时接口带 next_refresh_time 的商品随轮次刷新，属于 4 小时商品；
// - 旧接口 round 字段：0 表示全天在售，1/2/3/4 表示对应 4 小时轮次；
// - 已知起止时间时，有效时长超过单轮 4 小时即视为全天商品；
// - 仅知结束时间时（实时接口全天商品只有 disable_time），结束时刻落在
//   当日 24:00 边界（23:59:58 之后或次日 00:00:01 之内）视为全天商品。
export function isAllDayMerchantProduct(
  refreshAt: number | null,
  startsAt: number | null,
  endsAt: number | null,
  roundValue: unknown,
  secondsOfDay?: (ms: number) => number,
): boolean {
  if (refreshAt !== null) return false
  if (roundValue !== null && roundValue !== undefined && roundValue !== '') {
    const round = Number(roundValue)
    if (Number.isFinite(round)) return round === 0
  }
  if (startsAt !== null && endsAt !== null) return endsAt - startsAt > MERCHANT_ROUND_SPAN_MS
  if (endsAt !== null && secondsOfDay) {
    const second = secondsOfDay(endsAt)
    return second >= 23 * 3600 + 59 * 60 + 58 || second <= 1
  }
  return false
}

// 上游 v4.2.1：实时接口不返回商品图片地址时，按 goods_mapping 的 item_id/item_kind
// 使用 Wiki 公共物品图，避免商品图片 404。
export function wikiItemAssetUrl(baseUrl: string | undefined, itemId: unknown, itemKind: unknown): string {
  const idText = String(itemId ?? '').trim()
  const kindText = String(itemKind ?? '').trim() || 'bag'
  if (!baseUrl || !idText || !/^\d+$/.test(idText)) return ''
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/resources/wiki/assets/items/${kindText}/${idText}.png`
}

function resolveMerchantIcon(direct: string, itemId: unknown, itemKind: unknown, options: MerchantNormalizeOptions): string {
  const url = String(direct || '').trim()
  if (url) return url
  const wikiUrl = wikiItemAssetUrl(options.assetBaseUrl, itemId, itemKind)
  return wikiUrl || String(options.fallbackIcon || '')
}

// 上游 v4.2.0：同一商品可能同时出现在多个分组，只有全部出现均为全天时才按全天去重。
export function collectAllDayProductNames(items: Array<{ name?: string, allDay?: boolean }>): Set<string> {
  const flags = new Map<string, boolean[]>()
  for (const item of items) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const seen = flags.get(name) || []
    seen.push(Boolean(item.allDay))
    flags.set(name, seen)
  }
  const names = new Set<string>()
  for (const [name, seen] of flags) {
    if (seen.length && seen.every(Boolean)) names.add(name)
  }
  return names
}

function mappingById(payload: any): Map<string, any> {
  const mapping = payload?._goods_mapping ?? payload?.goods_mapping
  const list = Array.isArray(mapping) ? mapping : []
  const map = new Map<string, any>()
  for (const item of list) {
    if (isObject(item) && item.goods_id !== undefined && item.goods_id !== null) {
      map.set(String(item.goods_id), item)
    }
  }
  return map
}

function liveGoodsName(meta: any, item: any, goodsId: any): string {
  const name = String(meta?.goods_name || meta?.name || item?.name || item?.goods_name || '').trim()
  if (name) return name
  return goodsId !== undefined && goodsId !== null && goodsId !== '' ? `商品 ${goodsId}` : '未知商品'
}

// 实时商人 goods 结构：按 mapping 补齐名称/图标，递归 sub_goods，按“商品 ID + 时间窗口 + 父商品”去重。
export function normalizeLiveMerchant(payload: any, nowMs = Date.now(), options: MerchantNormalizeOptions = {}): MerchantItem[] {
  const map = mappingById(payload)
  const items: MerchantItem[] = []
  const seen = new Set<string>()

  const add = (raw: any, parentId?: string) => {
    if (!isObject(raw)) return
    const goodsId = raw.goods_id ?? raw.id
    const meta = map.get(String(goodsId)) || {}
    const startsAt = merchantTimestampMs(raw.start_time ?? payload?.start_time)
    const endsAt = merchantTimestampMs(raw.disable_time ?? raw.end_time)
    const refreshAt = merchantTimestampMs(raw.next_refresh_time)
    const key = `${String(goodsId)}|${startsAt ?? ''}|${endsAt ?? ''}|${parentId ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    const itemId = meta.item_id ?? raw.item_id
    const itemKind = meta.item_kind ?? raw.item_kind ?? 'bag'
    items.push({
      id: String(goodsId ?? ''),
      parentId,
      name: liveGoodsName(meta, raw, goodsId),
      icon: resolveMerchantIcon(raw.icon_url || raw.iconUrl || meta.icon_url || meta.icon, itemId, itemKind, options),
      price: livePrice(raw.price) ?? numberOrNull(meta.price),
      limit: numberOrNull(raw.limit_buy_num ?? raw.buy_limit_num ?? meta.buy_limit_num),
      startsAt,
      endsAt,
      active: (startsAt === null || nowMs >= startsAt) && (endsAt === null || nowMs < endsAt),
      category: parentId ? '子商品' : '商品',
      source: 'live',
      allDay: isAllDayMerchantProduct(refreshAt, startsAt, endsAt, undefined, options.secondsOfDay),
      itemId: itemId !== undefined && itemId !== null ? String(itemId) : undefined,
      itemKind: String(itemKind || 'bag'),
    })
    const children = Array.isArray(raw.sub_goods) ? raw.sub_goods : []
    for (const child of children) add(child, String(goodsId ?? ''))
  }

  const goods = Array.isArray(payload?.goods) ? payload.goods : []
  for (const raw of goods) add(raw)
  return items
}

// 旧接口：merchantActivities 下 products/get_props/get_extra_props/get_pets 合并，random_goods 补价格/限购。
export function normalizeLegacyMerchant(payload: any, nowMs = Date.now(), options: MerchantNormalizeOptions = {}): MerchantItem[] {
  const activities = payload?.merchantActivities || payload?.merchant_activities || []
  const activity = activities[0] || {}
  const randomGoods = Array.isArray(payload?.random_goods) ? payload.random_goods : []
  const metaByName = new Map<string, any>()
  for (const item of randomGoods) {
    const name = String(item?.goods_name || item?.name || '').trim()
    if (name) metaByName.set(name, item)
  }

  const buckets: Array<[string, any[]]> = [
    ['道具', activity.get_props || []],
    ['额外道具', activity.get_extra_props || []],
    ['精灵', activity.get_pets || []],
    ['商品', activity.products || []],
    ['商品', activity.product_list || []],
  ]

  const items: MerchantItem[] = []
  const seen = new Set<string>()
  for (const [category, list] of buckets) {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!isObject(raw)) continue
      const name = String(raw.name || raw.goods_name || '未知商品').trim() || '未知商品'
      const startsAt = merchantTimestampMs(raw.start_time) ?? merchantTimestampMs(activity.start_time)
      const endsAt = merchantTimestampMs(raw.end_time) ?? merchantTimestampMs(activity.end_time)
      const key = `${raw.id ?? ''}|${name}|${startsAt ?? 0}|${endsAt ?? 'inf'}`
      if (seen.has(key)) continue
      seen.add(key)
      const meta = metaByName.get(name) || {}
      const itemId = raw.item_id ?? meta.item_id
      const itemKind = raw.item_kind ?? meta.item_kind ?? 'bag'
      items.push({
        id: String(raw.id ?? ''),
        name,
        icon: resolveMerchantIcon(raw.icon_url || raw.iconUrl || meta.icon_url || meta.icon, itemId, itemKind, options),
        price: numberOrNull(raw.price) ?? numberOrNull(meta.price),
        limit: numberOrNull(raw.buy_limit_num ?? raw.limit_buy_num) ?? numberOrNull(meta.buy_limit_num),
        startsAt,
        endsAt,
        active: (startsAt === null || nowMs >= startsAt) && (endsAt === null || nowMs < endsAt),
        category,
        source: 'legacy',
        allDay: isAllDayMerchantProduct(
          merchantTimestampMs(raw.next_refresh_time),
          startsAt,
          endsAt,
          raw.round,
          options.secondsOfDay,
        ),
        itemId: itemId !== undefined && itemId !== null ? String(itemId) : undefined,
        itemKind: String(itemKind || 'bag'),
      })
    }
  }
  return items
}

export function isLiveMerchantPayload(payload: any): boolean {
  return isObject(payload) && Array.isArray(payload.goods)
}

export function normalizeMerchant(payload: any, nowMs = Date.now(), options: MerchantNormalizeOptions = {}): NormalizedMerchant {
  if (isLiveMerchantPayload(payload)) {
    return { source: 'live', items: normalizeLiveMerchant(payload, nowMs, options) }
  }
  return { source: 'legacy', items: normalizeLegacyMerchant(payload, nowMs, options) }
}
