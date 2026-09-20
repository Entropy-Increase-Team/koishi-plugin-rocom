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

function liveGoodsIcon(meta: any, item: any): string {
  return String(item?.icon_url || item?.iconUrl || meta?.icon_url || meta?.icon || '').trim()
}

// 实时商人 goods 结构：按 mapping 补齐名称/图标，递归 sub_goods，按“商品 ID + 时间窗口 + 父商品”去重。
export function normalizeLiveMerchant(payload: any, nowMs = Date.now()): MerchantItem[] {
  const map = mappingById(payload)
  const items: MerchantItem[] = []
  const seen = new Set<string>()

  const add = (raw: any, parentId?: string) => {
    if (!isObject(raw)) return
    const goodsId = raw.goods_id ?? raw.id
    const meta = map.get(String(goodsId)) || {}
    const startsAt = merchantTimestampMs(raw.start_time ?? payload?.start_time)
    const endsAt = merchantTimestampMs(raw.disable_time ?? raw.end_time)
    const key = `${String(goodsId)}|${startsAt ?? ''}|${endsAt ?? ''}|${parentId ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({
      id: String(goodsId ?? ''),
      parentId,
      name: liveGoodsName(meta, raw, goodsId),
      icon: liveGoodsIcon(meta, raw),
      price: livePrice(raw.price) ?? numberOrNull(meta.price),
      limit: numberOrNull(raw.limit_buy_num ?? raw.buy_limit_num ?? meta.buy_limit_num),
      startsAt,
      endsAt,
      active: (startsAt === null || nowMs >= startsAt) && (endsAt === null || nowMs < endsAt),
      category: parentId ? '子商品' : '商品',
      source: 'live',
    })
    const children = Array.isArray(raw.sub_goods) ? raw.sub_goods : []
    for (const child of children) add(child, String(goodsId ?? ''))
  }

  const goods = Array.isArray(payload?.goods) ? payload.goods : []
  for (const raw of goods) add(raw)
  return items
}

// 旧接口：merchantActivities 下 products/get_props/get_extra_props/get_pets 合并，random_goods 补价格/限购。
export function normalizeLegacyMerchant(payload: any, nowMs = Date.now()): MerchantItem[] {
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
      items.push({
        id: String(raw.id ?? ''),
        name,
        icon: String(raw.icon_url || raw.iconUrl || meta.icon_url || meta.icon || '').trim(),
        price: numberOrNull(raw.price) ?? numberOrNull(meta.price),
        limit: numberOrNull(raw.buy_limit_num ?? raw.limit_buy_num) ?? numberOrNull(meta.buy_limit_num),
        startsAt,
        endsAt,
        active: (startsAt === null || nowMs >= startsAt) && (endsAt === null || nowMs < endsAt),
        category,
        source: 'legacy',
      })
    }
  }
  return items
}

export function isLiveMerchantPayload(payload: any): boolean {
  return isObject(payload) && Array.isArray(payload.goods)
}

export function normalizeMerchant(payload: any, nowMs = Date.now()): NormalizedMerchant {
  if (isLiveMerchantPayload(payload)) {
    return { source: 'live', items: normalizeLiveMerchant(payload, nowMs) }
  }
  return { source: 'legacy', items: normalizeLegacyMerchant(payload, nowMs) }
}
