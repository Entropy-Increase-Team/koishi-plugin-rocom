import { isObject } from './client'
import { resourceUrl } from './player-service'
import { bloodlineElement, elementColor } from './element-colors'

export const SHARE_CODE_MAX_LENGTH = 16 * 1024

export type ShareCodeSource = 'parse' | 'record'

export function extractShareCode(input: string): string {
  const raw = String(input ?? '').trim().replace(/^[`"']+|[`"']+$/g, '')
  if (!raw) return ''
  if (raw.length > SHARE_CODE_MAX_LENGTH) throw new Error('分享码内容过长')

  const match = /(?:[?&#]|^)share(?:Data|_data|_code)=([^&#\s]+)/i.exec(raw)
  if (!match) {
    if (/^https?:\/\//i.test(raw)) throw new Error('链接中没有分享码参数')
    return raw
  }

  let value = match[1]
  for (let i = 0; i < 2; i++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      throw new Error('分享码链接的编码不完整')
    }
    if (decoded === value) break
    value = decoded
  }
  return value.trim().replace(/^[`"']+|[`"']+$/g, '')
}

// 避免对已存解析对象重复发 POST。
export function parsedRecord(record: any): any | null {
  for (const candidate of [record?.share_code, record?.parsed, record]) {
    if (candidate && typeof candidate === 'object' && Array.isArray(candidate.teams)) {
      return candidate
    }
  }
  return null
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  const s = String(value).trim()
  return s || fallback
}

function formatTime(value: unknown): string {
  const raw = text(value)
  if (!raw) return ''
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/.test(raw)
    ? `${raw.replace(' ', 'T')}+08:00`
    : raw.replace('Z', '+00:00')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  const shifted = new Date(date.getTime() + 8 * 3600_000)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

function normalizeUrl(value: unknown, baseUrl: string): string {
  return resourceUrl(value, baseUrl)
}

function wikiAssetUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path
  return `${String(baseUrl).replace(/\/$/, '')}${path}`
}

function normalizeNamedIcon(value: any, emptyName: string, baseUrl: string) {
  const item = isObject(value) ? value : {}
  const id = toInt(item.id)
  return {
    id,
    name: text(item.name, emptyName),
    icon: normalizeUrl(item.icon, baseUrl),
    configured: Boolean(id || text(item.name) || text(item.icon)),
  }
}

function normalizeTeam(value: any, index: number, baseUrl: string) {
  const team = isObject(value) ? value : {}
  const pet = normalizeNamedIcon(team.pet, '未配置精灵', baseUrl)
  if (pet.id) pet.icon = wikiAssetUrl(baseUrl, `/api/v1/resources/wiki/assets/pets/${pet.id}/icon.png`)
  const bloodline = normalizeNamedIcon(team.bloodline, '未配置血脉', baseUrl)
  const personality = normalizeNamedIcon(team.personality, '未配置性格', baseUrl)

  const ivs: Array<ReturnType<typeof normalizeNamedIcon>> = []
  for (const raw of Array.isArray(team.ivs_detail) ? team.ivs_detail : []) {
    ivs.push(normalizeNamedIcon(raw, '未配置', baseUrl))
  }
  while (ivs.length < 3) ivs.push(normalizeNamedIcon(null, '未配置', baseUrl))

  const skills: Array<ReturnType<typeof normalizeNamedIcon>> = []
  for (const raw of Array.isArray(team.skills) ? team.skills : []) {
    const skill = normalizeNamedIcon(raw, '未配置技能', baseUrl)
    if (skill.id) skill.icon = wikiAssetUrl(baseUrl, `/api/v1/resources/wiki/assets/skills/${skill.id}.png`)
    skills.push(skill)
  }
  while (skills.length < 4) skills.push(normalizeNamedIcon(null, '未配置技能', baseUrl))

  return {
    slot: toInt(team.slot, index + 1),
    pet,
    // 精灵属性名列表，供信笺风模板显示属性图标。
    typeNames: (Array.isArray((team.pet as any)?.type_names) ? (team.pet as any).type_names as string[] : [])
      .map((item: any) => String(item ?? '').trim())
      .filter(Boolean),
    bloodline,
    personality,
    ivs: ivs.slice(0, 3),
    skills: skills.slice(0, 4),
    empty: !pet.configured,
  }
}

function unwrapRecord(record: any): { payload: any, meta: any } {
  if (!isObject(record)) return { payload: {}, meta: {} }
  if (isObject(record.share_code)) return { payload: record.share_code, meta: record }
  if (isObject(record.parsed)) return { payload: record.parsed, meta: record }
  return { payload: record, meta: {} }
}

function shareCodePreview(code: string): string {
  if (code.length <= 36) return code
  return `${code.slice(0, 20)}...${code.slice(-12)}`
}

export function buildShareCodeView(
  payload: any,
  source: ShareCodeSource,
  record?: any,
  baseUrl = '',
) {
  let data: any = isObject(payload) ? payload : {}
  let recordMeta: any = {}
  if (record) {
    const unwrapped = unwrapRecord(record)
    if (!data.teams) data = unwrapped.payload
    recordMeta = unwrapped.meta
  }

  const teams = (Array.isArray(data.teams) ? data.teams : [])
    .map((item: any, index: number) => normalizeTeam(item, index, baseUrl))
    .sort((a: any, b: any) => a.slot - b.slot)

  const shareCode = text(data.share_code)
  const mode = normalizeNamedIcon(data.mode, '未知编队模式', baseUrl)
  const magic = normalizeNamedIcon(data.magic, '未配置魔法', baseUrl)
  if (magic.configured && magic.name === '未配置魔法') magic.name = `魔法 ${magic.id}`
  const spriteCount = toInt(data.sprite_count, teams.length)

  return {
    source,
    sourceLabel: source === 'record' ? '历史记录' : '即时解析',
    shareCode,
    shareCodePreview: shareCodePreview(shareCode),
    version: toInt(data.version, 1),
    spriteCount,
    mode,
    magic,
    teams,
    parseCount: toInt(recordMeta.parse_count),
    firstSeen: formatTime(recordMeta.first_seen_at),
    lastSeen: formatTime(recordMeta.last_seen_at),
    shareCodeHash: text(recordMeta.share_code_hash),
    commandHint: '阵容码 解析 <分享码或链接> · 阵容码 查询 <分享码>',
    copyright: 'Koishi & WeGame 洛克王国插件',
  }
}

export function buildShareCodeText(data: any): string {
  const lines = [
    `阵容码${data.sourceLabel || '解析'}：${data.mode?.name || '未知模式'}，共 ${data.spriteCount || 0} 只精灵`,
  ]
  for (const team of data.teams || []) {
    const talents = (team.ivs || []).filter((item: any) => item.configured).map((item: any) => item.name)
    const skillNames = (team.skills || []).filter((item: any) => item.configured).map((item: any) => item.name)
    lines.push(
      `${team.slot}. ${team.pet.name} | ${team.bloodline.name} | ${team.personality.name} | 天赋：${talents.join('、') || '未配置'} | 技能：${skillNames.join('、') || '未配置'}`,
    )
  }
  if (data.parseCount) {
    lines.push(`解析次数：${data.parseCount}，最近记录：${data.lastSeen || '未知'}`)
  }
  return lines.join('\n')
}

// ---------- 信笺风阵容分享模板（share-code-classic）视图 ----------

export interface ShareCodeClassicAssets {
  frame: string
  logo: string
  rocoIcon: string
  star: string
  wax: string
  typeIcon: (name: string) => string
  bloodIcon: (element: string) => string
}

export interface ClassicNatureInfo {
  name?: string
  up?: string
  down?: string
  summary?: string
}

// 性格摘要解析：兼容「+攻击 -特攻」「攻击↑ 特攻↓」「加攻击/减特攻」等写法。
export function parseNaturePair(summary: unknown): { up: string, down: string } {
  const text = String(summary ?? '')
  const upMatch = text.match(/([一-龥A-Za-z]{1,4})\s*(?:↑|▲)|(?:\+|加|▲)\s*([一-龥A-Za-z]{1,4})/)
  const downMatch = text.match(/([一-龥A-Za-z]{1,4})\s*(?:↓|▼)|(?:-|－|减|▼)\s*([一-龥A-Za-z]{1,4})/)
  return {
    up: (upMatch && (upMatch[1] || upMatch[2])) || '',
    down: (downMatch && (downMatch[1] || downMatch[2])) || '',
  }
}

export function buildShareCodeClassicView(
  view: any,
  assets: ShareCodeClassicAssets,
  natureLookup: (id: string) => ClassicNatureInfo = () => ({}),
) {
  const teams = (view?.teams || []).map((team: any) => {
    const element = bloodlineElement(team?.bloodline?.name || '')
    const nature = natureLookup(String(team?.personality?.id ?? '')) || {}
    const naturePair = { up: String(nature.up || '').trim(), down: String(nature.down || '').trim() }
    if (!naturePair.up && !naturePair.down) {
      const parsed = parseNaturePair(nature.summary)
      naturePair.up = parsed.up
      naturePair.down = parsed.down
    }
    const typeNames: string[] = Array.isArray(team?.typeNames) ? team.typeNames : []
    return {
      slotText: String(team?.slot ?? 0).padStart(2, '0'),
      color: elementColor(element),
      pet: {
        name: team?.pet?.name || '未配置精灵',
        icon: team?.pet?.icon || '',
      },
      typeIcons: typeNames.map((name: string) => ({ name, icon: assets.typeIcon(name) })),
      bloodline: {
        name: team?.bloodline?.name || `${element}系血脉`,
        icon: team?.bloodline?.icon || assets.bloodIcon(element),
      },
      personality: {
        name: team?.personality?.name || nature.name || '未知',
        up: naturePair.up,
        down: naturePair.down,
      },
      ivs_detail: (team?.ivs || [])
        .filter((item: any) => item?.configured)
        .map((item: any) => ({ name: item.name })),
      skills: (team?.skills || []).map((skill: any) => ({
        name: skill?.name || '未配置技能',
        icon: skill?.icon || '',
      })),
    }
  })

  const spriteCount = view?.spriteCount || teams.length
  return {
    team: {
      mode_name: view?.mode?.name || '未知编队模式',
      share_code: view?.shareCodePreview || view?.shareCode || '',
      sprite_count: spriteCount,
      count_label: `/ ${spriteCount} 精灵`,
      magic_icon: view?.magic?.icon || assets.rocoIcon,
      teams,
    },
    shareAssets: {
      frame: assets.frame,
      logo: assets.logo,
      rocoIcon: assets.rocoIcon,
      star: assets.star,
      wax: assets.wax,
    },
  }
}
