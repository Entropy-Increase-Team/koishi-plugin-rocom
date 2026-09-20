import { isObject } from './client'

export type RankingKind = 'shining' | 'glass'

interface RankingMeta {
  title: string
  subtitle: string
  label: string
  otherLabel: string
  countField: string
  otherCountField: string
  theme: string
}

export const RANKING_META: Record<RankingKind, RankingMeta> = {
  shining: {
    title: '异色精灵排行榜',
    subtitle: '按异色精灵收集数排名',
    label: '异色',
    otherLabel: '炫彩',
    countField: 'collected_shining_pet_count',
    otherCountField: 'collected_glass_pet_count',
    theme: 'shining',
  },
  glass: {
    title: '炫彩精灵排行榜',
    subtitle: '按炫彩精灵收集数排名',
    label: '炫彩',
    otherLabel: '异色',
    countField: 'collected_glass_pet_count',
    otherCountField: 'collected_shining_pet_count',
    theme: 'glass',
  },
}

export interface RankingArgs {
  uid: string
  limit: number
}

// 单参数 1–50 视为数量；其他纯数字视为 UID；两参数分别为 UID/数量。
export function parseRankingArgs(text: string, primaryUid = ''): RankingArgs {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length > 2) throw new Error('用法：排行榜 [UID] [数量]')
  let uid = ''
  let limit = 10
  if (parts.length === 1) {
    const value = parts[0]
    if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 50) {
      limit = Number(value)
    } else {
      uid = value
    }
  } else if (parts.length === 2) {
    uid = parts[0]
    if (!/^\d+$/.test(parts[1])) throw new Error('数量必须是 1–50 的整数')
    limit = Number(parts[1])
  }
  if (uid && !/^\d+$/.test(uid)) throw new Error('UID 只能包含数字')
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('数量必须是 1–50 的整数')
  }
  return { uid: uid || primaryUid, limit }
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

// 无时区的时间字符串按 +08:00 解释（与上游一致）。
export function formatRankingTime(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return '未知'
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text)
    ? `${text.replace(' ', 'T')}+08:00`
    : text.replace('Z', '+00:00')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return text
  const shifted = new Date(date.getTime() + 8 * 3600_000)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

function avatarUrl(baseUrl: string, cardIcon: unknown): string {
  const iconId = String(cardIcon ?? '').trim()
  if (!iconId) return ''
  return `${String(baseUrl || '').replace(/\/$/, '')}/api/v1/resources/wiki/assets/profile/avatar/${iconId}.png`
}

function normalizeItem(item: any, meta: RankingMeta, baseUrl: string) {
  const rank = toInt(item?.rank)
  return {
    rank,
    podiumClass: rank >= 1 && rank <= 3 ? `podium-${rank}` : '',
    playerName: String(item?.player_name || '未记录名称'),
    avatar: avatarUrl(baseUrl, item?.card_icon_selected),
    signature: String(item?.card_signature || '暂无签名'),
    primaryCount: toInt(item?.[meta.countField]),
    secondaryCount: toInt(item?.[meta.otherCountField]),
    sampleCount: toInt(item?.sample_count),
    lastSeen: formatRankingTime(item?.last_seen_at),
  }
}

export function buildRankingView(
  payload: any,
  rankType: RankingKind,
  baseUrl: string,
  requestedUid = '',
  now = new Date(),
) {
  const meta = RANKING_META[rankType] || RANKING_META.shining
  const data = isObject(payload) ? payload : {}
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter(item => isObject(item))
    .map(item => normalizeItem(item, meta, baseUrl))

  let current: any = null
  if (isObject(data.current)) {
    current = normalizeItem(data.current, meta, baseUrl)
    current.uid = String(data.current.uid || requestedUid || '')
    current.titleText = '该玩家名次'
  }

  const pad = (v: number) => String(v).padStart(2, '0')
  const updatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

  return {
    ...meta,
    total: toInt(data.total),
    items,
    current,
    requestedUid: String(requestedUid || ''),
    shownCount: items.length,
    updatedAt,
    commandHint: `/${meta.label}排行榜 [UID] [数量] · 数量支持 1-50`,
    copyright: 'Koishi & WeGame 洛克王国插件',
  }
}

export function buildRankingText(data: any): string {
  const lines = [`${data.title || '精灵排行榜'}（共 ${data.total || 0} 名）`]
  for (const item of data.items || []) {
    lines.push(`#${item.rank} ${item.playerName}：${data.label} ${item.primaryCount}，${data.otherLabel} ${item.secondaryCount}`)
  }
  if (data.current) {
    lines.push(`该玩家名次：#${data.current.rank} ${data.current.playerName}，${data.label} ${data.current.primaryCount}`)
  } else if (data.requestedUid) {
    lines.push(`UID ${data.requestedUid} 暂无排行榜记录。`)
  }
  if (!data.items?.length && !data.current) lines.push('当前排行榜暂无记录。')
  return lines.join('\n')
}
