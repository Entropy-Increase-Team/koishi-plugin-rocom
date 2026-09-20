import { isObject } from './client'

export interface PlayerRow {
  field?: string
  label?: string
  value?: unknown
}

export type IngamePlayerPayload = {
  rows?: PlayerRow[]
  notes?: unknown[]
  title?: string
  player_info?: Record<string, any>
  player_card_brief_info?: Record<string, any>
  [key: string]: any
}

// 相对资源地址转绝对地址（上游 v4.1.0）；非字符串/非法协议返回空串，避免渲染裂图。
export function resourceUrl(value: unknown, apiBaseUrl: string): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const text = value.trim()
  if (/^data:/i.test(text)) return text
  try {
    const url = new URL(text, apiBaseUrl.replace(/\/$/, '') + '/')
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

// 将 v4.1.0 玩家嵌套结构与旧 rows 统一成 IngamePlayerRow[] 目标展示。
// 值为 0/false 需要保留，不能用 `value || ''` 清空。
export function playerRows(payload: any, uid: string): PlayerRow[] {
  const legacy: PlayerRow[] = Array.isArray(payload?.rows) ? payload.rows : []
  const p = payload?.player_info ?? {}
  const c = payload?.player_card_brief_info ?? {}
  const stats = c.card_pet_info ?? {}
  const home = p.home_info ?? {}
  const visit = p.visit_info ?? {}
  const appearance = c.card_appearance_info ?? {}
  const business = c.business_card_info ?? {}

  const fields: Array<[string, string, unknown]> = [
    ['uin', 'UID', p.uin ?? p.uid ?? legacy.find(row => row.field === 'uin')?.value ?? uid],
    ['name', '昵称', p.name],
    ['level', '等级', p.level],
    ['online', '在线状态', p.online ?? p.is_online ?? payload?.online],
    ['sex', '性别', p.sex ?? p.gender],
    ['gender', '性别', p.gender ?? p.sex],
    ['signature', '个性签名', p.signature ?? c.card_signature],
    ['home_name', '家园名称', home.home_name ?? home.name],
    ['home_level', '家园等级', home.home_level],
    ['room_level', '房间等级', home.room_level],
    ['home_experience', '家园经验', home.home_experience],
    ['home_comfort_level', '舒适度', home.home_comfort_level ?? home.comfort_level],
    ['visitor_num', '访客数量', visit.visitor_num],
    ['world_level', '世界等级', p.world_level],
    ['card_handbook_collect_num', '图鉴收集', p.card_handbook_collect_num ?? c.card_handbook_collect_num],
    ['last_logout_time', '最后离线', p.last_logout_time],
    ['collected_shining_pet_count', '异色收集', stats.collected_shining_pet_count],
    ['collected_glass_pet_count', '炫彩收集', stats.collected_glass_pet_count],
    ['card_skin_selected', '名片皮肤', appearance.card_skin_selected ?? p.card_skin_selected ?? business.card_skin_selected],
    ['card_icon_selected', '名片头像', c.card_icon_selected ?? p.card_icon_selected ?? appearance.card_icon_selected ?? business.card_icon_selected],
    ['card_bussiness_card_url', '名片图片', business.cur_card_url ?? c.cur_card_url ?? p.card_bussiness_card_url],
  ]

  const mapped = fields
    .filter(([, , v]) => v !== undefined && v !== null)
    .map(([field, label, value]) => ({ field, label, value }))
  return [...new Map([...legacy, ...mapped].map(row => [row.field, row])).values()]
}

export function cleanPlayerFieldValue(field: string, value: unknown): string {
  const text = String(value ?? '').trim().replace(/^'+|'+$/g, '')
  if (!text || ['<0B>', '<0b>', '<0B >', '<0b >'].includes(text)) return '未设置'
  if (['is_online', 'online', 'chat_top_unlock', 'is_friend', 'is_black', 'is_black_role', 'is_chat_node_unlock'].includes(field)) {
    return ['1', 'true', 'True', '是'].includes(text) ? '是' : '否'
  }
  if (['sex', 'gender'].includes(field)) {
    return { '0': '未知', '1': '男', '2': '女' }[text] || text
  }
  if (field === 'friend_type') {
    return { '0': '默认', '1': '特殊' }[text] || text
  }
  if (field === 'battle_state') {
    return { '0': '空闲', '1': '对战中' }[text] || text
  }
  return text
}

export interface ParsedPlayer {
  title: string
  nickname: string
  uid: string
  level: string
  signature: string
  rowMap: Record<string, string>
  labelMap: Record<string, string>
}

export function parseIngamePlayerPayload(payload: IngamePlayerPayload | null | undefined, uid: string): ParsedPlayer {
  const rows = playerRows(payload, uid)
  const rowMap: Record<string, string> = {}
  const labelMap: Record<string, string> = {}

  for (const row of rows) {
    const field = String(row.field || '')
    if (!field) continue
    rowMap[field] = String(row.value ?? '')
    labelMap[field] = String(row.label || field)
  }

  const playerUid = cleanPlayerFieldValue('uin', rowMap.uin || uid)
  const signature = cleanPlayerFieldValue('signature', rowMap.signature || '')
  return {
    title: String((payload as any)?.title || '玩家搜索'),
    nickname: cleanPlayerFieldValue('name', rowMap.name || '-'),
    uid: playerUid,
    level: cleanPlayerFieldValue('level', rowMap.level || '-'),
    signature: signature === '未设置' ? '' : signature,
    rowMap,
    labelMap,
  }
}

export function playerField(parsed: ParsedPlayer | null, field: string, defaultValue = '未设置') {
  if (!parsed) return defaultValue
  const raw = parsed.rowMap[field]
  if (raw == null || raw === '') return defaultValue
  const value = cleanPlayerFieldValue(field, raw)
  return value && value !== '-' && value !== '未设置' ? value : defaultValue
}

export interface PlayerView {
  parsed: ParsedPlayer
  cardImageUrl: string
}

// 合并搜索结果与名片结果；名片失败时保留基础信息（上游 v4.1.0）。
export function buildPlayerView(
  searchPayload: any,
  cardPayload: any,
  uid: string,
  apiBaseUrl: string,
): PlayerView {
  const merged = mergePlayerPayloads(searchPayload, cardPayload)
  const parsed = parseIngamePlayerPayload(merged, uid)
  const cardRaw = playerField(parsed, 'card_bussiness_card_url', '')
  return {
    parsed,
    cardImageUrl: cardRaw ? resourceUrl(cardRaw, apiBaseUrl) : '',
  }
}

export function mergePlayerPayloads(searchPayload: any, cardPayload: any): any {
  const result: any = { ...(searchPayload || {}) }
  const searchUid = playerPayloadUid(searchPayload)
  const cardUid = playerPayloadUid(cardPayload)
  if (searchUid && cardUid && searchUid !== cardUid) return result
  if (!isObject(cardPayload)) return result
  const searchInfo = isObject(result.player_info) ? result.player_info : {}
  const cardInfo = isObject(cardPayload.player_info) ? cardPayload.player_info : {}
  if (Object.keys(cardInfo).length) result.player_info = { ...searchInfo, ...cardInfo }
  for (const key of ['home_info', 'visit_info', 'battle_brief_info', 'pos_info']) {
    if (isObject(searchInfo[key]) && isObject(cardInfo[key])) {
      result.player_info[key] = { ...searchInfo[key], ...cardInfo[key] }
    }
  }
  if (isObject(cardPayload.player_card_brief_info)) {
    const base = isObject(result.player_card_brief_info) ? result.player_card_brief_info : {}
    result.player_card_brief_info = { ...base, ...cardPayload.player_card_brief_info }
    for (const key of ['card_pet_info', 'business_card_info', 'card_appearance_info']) {
      if (isObject(base[key]) && isObject(cardPayload.player_card_brief_info[key])) {
        result.player_card_brief_info[key] = { ...base[key], ...cardPayload.player_card_brief_info[key] }
      }
    }
  }
  if (Array.isArray(result.rows) && result.rows.length && !isObject(cardPayload.player_card_brief_info)) {
    return result
  }
  return result
}

export function playerPayloadUid(payload: any): string {
  return String(payload?.player_info?.uin ?? payload?.player_info?.uid ?? payload?.uin ?? payload?.uid
    ?? payload?.rows?.find((row: PlayerRow) => row.field === 'uin')?.value ?? '')
}

export function buildPlayerText(payload: any, uid: string): string {
  const p = parseIngamePlayerPayload(payload, uid)
  return ['洛克玩家 ' + p.nickname + ' · UID ' + p.uid,
    ...Object.entries(p.rowMap).filter(([key]) => !['uin', 'name'].includes(key))
      .map(([key, value]) => (p.labelMap[key] || key) + '：' + cleanPlayerFieldValue(key, value))].join('\n')
}
