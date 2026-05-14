import { Logger } from 'koishi'
import { PluginDeps } from '../types'
import { getPrimaryToken, notLoggedInHint } from './account'
import { sendImageWithFallback } from '../send-image'
import { sendScheduledMessage } from '../subscription-send'
import fs from 'node:fs'
import path from 'node:path'

const logger = new Logger('rocom-query')

async function sendImage(deps: PluginDeps, session: any, templateName: string, data: any, fallback: string) {
  const png = await deps.renderer.renderHtml(deps.ctx, templateName, data)
  await sendImageWithFallback(session, png, fallback, `query:${templateName}`, deps.config)
}

type IngamePlayerRow = {
  field?: string
  label?: string
  value?: unknown
}

type IngamePlayerPayload = {
  rows?: IngamePlayerRow[]
  notes?: unknown[]
  title?: string
  [key: string]: any
}

function cleanPlayerFieldValue(field: string, value: unknown): string {
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

function parseIngamePlayerPayload(payload: IngamePlayerPayload | null | undefined, uid: string) {
  const rows = payload?.rows || []
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
    title: String(payload?.title || '玩家搜索'),
    nickname: cleanPlayerFieldValue('name', rowMap.name || '-'),
    uid: playerUid,
    level: cleanPlayerFieldValue('level', rowMap.level || '-'),
    signature: signature === '未设置' ? '' : signature,
    rowMap,
    labelMap,
  }
}

function playerField(parsed: ReturnType<typeof parseIngamePlayerPayload> | null, field: string, defaultValue = '未设置') {
  if (!parsed) return defaultValue
  const raw = parsed.rowMap[field]
  if (raw == null || raw === '') return defaultValue
  const value = cleanPlayerFieldValue(field, raw)
  return value && value !== '-' && value !== '未设置' ? value : defaultValue
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractTopLevelJsonSegments(text: string): string[] {
  const segments: string[] = []
  let start = -1
  let depth = 0
  let quote: '"' | '\'' | '' = ''
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === quote) quote = ''
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch as '"' | '\''
      continue
    }

    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth++
      continue
    }

    if (ch === '}' || ch === ']') {
      if (depth <= 0) continue
      depth--
      if (depth === 0 && start >= 0) {
        segments.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }

  return segments
}

function collectExchangeItemNames(input: unknown, output: Set<string>) {
  if (input == null) return

  if (Array.isArray(input)) {
    for (const item of input) collectExchangeItemNames(item, output)
    return
  }

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>
    const preferredKeys = ['name', 'item_name', 'title', 'label', 'text', 'value']
    let consumedPreferred = false

    for (const key of preferredKeys) {
      if (record[key] == null) continue
      consumedPreferred = true
      collectExchangeItemNames(record[key], output)
    }

    if (!consumedPreferred) {
      for (const value of Object.values(record)) collectExchangeItemNames(value, output)
    }
    return
  }

  if (typeof input === 'string') {
    const text = input.trim()
    if (!text) return

    const direct = tryParseJson(text)
    if (direct != null) {
      collectExchangeItemNames(direct, output)
      return
    }

    const unescaped = text.replace(/\\"/g, '"')
    if (unescaped !== text) {
      const escapedParsed = tryParseJson(unescaped)
      if (escapedParsed != null) {
        collectExchangeItemNames(escapedParsed, output)
        return
      }
    }

    const chunks = extractTopLevelJsonSegments(text)
    let parsedFromChunks = false
    for (const chunk of chunks) {
      const parsed = tryParseJson(chunk)
      if (parsed == null) continue
      parsedFromChunks = true
      collectExchangeItemNames(parsed, output)
    }
    if (parsedFromChunks) return

    const nameRegex = /["']name["']\s*:\s*["']([^"']+)["']/g
    let matched = false
    for (let match = nameRegex.exec(text); match; match = nameRegex.exec(text)) {
      const candidate = match[1]?.trim()
      if (!candidate) continue
      output.add(candidate)
      matched = true
    }
    if (matched) return

    output.add(text)
    return
  }

  const text = String(input).trim()
  if (text) output.add(text)
}

function parseExchangeItems(raw: unknown): string[] {
  const names = new Set<string>()
  collectExchangeItemNames(raw, names)
  return [...names]
}

function parseExchangeWantText(raw: unknown): string {
  const names = parseExchangeItems(raw)
  return names[0] || '交友'
}

function normalizeLineupLookupId(rawValue: unknown): string {
  const text = String(rawValue ?? '').trim()
  if (!text) return ''
  const match = text.match(/\d+/)
  return match ? match[0] : text
}

function isTargetLineup(lineup: any, lineupId: string): boolean {
  const target = normalizeLineupLookupId(lineupId)
  if (!target) return false
  const candidates = new Set([
    normalizeLineupLookupId(lineup?.id),
    normalizeLineupLookupId(lineup?.code),
    normalizeLineupLookupId(lineup?.lineup_code),
  ])
  candidates.delete('')
  return candidates.has(target)
}

function stringifyInspectValue(value: any): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) {
    if (!value.length) return '-'
    if (value.every(item => item === null || typeof item !== 'object')) return value.map(String).join('、')
    return `共 ${value.length} 项`
  }
  if (typeof value === 'object') {
    const pairs = Object.entries(value).slice(0, 4).map(([key, item]) => `${key}: ${stringifyInspectValue(item)}`)
    return pairs.length ? `${pairs.join(' | ')}${Object.keys(value).length > 4 ? ' | ...' : ''}` : '-'
  }
  return String(value)
}

function accountTypeText(accountType: number) {
  return ({ 0: '自动', 1: 'QQ', 2: '微信' } as Record<number, string>)[accountType] || String(accountType)
}

function normalizeEpochSeconds(value: any): number {
  const ts = Number(value)
  if (!Number.isFinite(ts)) return 0
  if (ts > 10000000000000) return Math.floor(ts / 1000000)
  if (ts > 10000000000) return Math.floor(ts / 1000)
  return Math.floor(ts)
}

function normalizeDurationSeconds(value: any): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return 0
  if (seconds > 1000000000) return Math.floor(seconds / 1000000)
  if (seconds > 1000000) return Math.floor(seconds / 1000)
  return Math.floor(seconds)
}

function formatHomeRemaining(targetTs: number, nowTs = Math.floor(Date.now() / 1000)): string {
  if (!targetTs) return '未开始'
  const remain = Math.max(0, targetTs - nowTs)
  if (remain <= 0) return '已完成'
  const hours = Math.floor(remain / 3600)
  const minutes = Math.floor((remain % 3600) / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}天${hours % 24}小时`
  if (hours > 0) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

function homeInfoPayload(res: any): any {
  const payload = res || {}
  if (payload.result?.home_info) return payload.result.home_info
  if (payload.home_info) return payload.home_info
  if (payload.data?.result?.home_info) return payload.data.result.home_info
  if (payload.data?.home_info) return payload.data.home_info
  return payload && typeof payload === 'object' ? payload : {}
}

function homeBriefInfo(homeInfo: any): any {
  return homeInfo?.friend_home_brief_info || homeInfo?.home_brief_info || homeInfo || {}
}

function homeCellInfo(homeInfo: any): any {
  return homeInfo?.friend_cell_home_brief_info || homeInfo?.cell_home_brief_info || {}
}

function homePetIcon(petId: any, iconUrl = ''): string {
  if (iconUrl) return iconUrl
  let assetId = Number(String(petId || '0'))
  if (!Number.isFinite(assetId) || assetId <= 0) return ''
  if (assetId < 3000) assetId += 3000
  return `https://game.gtimg.cn/images/rocom/rocodata/jingling/${assetId}/icon.png`
}

function homePetImage(petId: any, imageUrl = ''): string {
  if (imageUrl) return imageUrl
  let assetId = Number(String(petId || '0'))
  if (!Number.isFinite(assetId) || assetId <= 0) return ''
  if (assetId < 3000) assetId += 3000
  return `https://game.gtimg.cn/images/rocom/rocodata/jingling/${assetId}/image.png`
}

type PanelSkillItem = {
  id: string
  name: string
  isEquipped: boolean
  cost: string
  power: string
  typeLabel: string
  iconUrl: string
  description: string
}

type PanelAttributeItem = {
  key: string
  label: string
  value: number
  talent: number
  effortAdd: number
}

type PanelFeature = {
  id: string
  name: string
  desc: string
}

type PanelPetItem = {
  gid: string
  petId: string
  name: string
  level: number
  gender: string
  energy: number
  mutationType: number
  mutationLabel: string
  bloodId: string
  bloodlineLabel: string
  elementLabels: string[]
  elementIcons: string[]
  iconUrl: string
  imageUrl: string
  feature: PanelFeature
  equipSkills: PanelSkillItem[]
  skills: PanelSkillItem[]
  attributes: PanelAttributeItem[]
}

type PanelPetCacheRecord = {
  uid: string
  pets: PanelPetItem[]
  updatedAt: number
}

type PanelPetCacheData = Record<string, PanelPetCacheRecord>

const PANEL_PET_STAT_DEFS = [
  { key: 'hp', label: 'HP', addiType: 1, aliases: ['hp'] },
  { key: 'attack', label: '物攻', addiType: 2, aliases: ['attack', 'atk'] },
  { key: 'special_attack', label: '魔攻', addiType: 3, aliases: ['special_attack', 'magic_attack', 'sp_attack'] },
  { key: 'defense', label: '物防', addiType: 4, aliases: ['defense', 'def'] },
  { key: 'special_defense', label: '魔防', addiType: 5, aliases: ['special_defense', 'magic_defense', 'sp_defense'] },
  { key: 'speed', label: '速度', addiType: 6, aliases: ['speed', 'spd'] },
]

const PANEL_PET_CACHE_PATH = path.join('data', 'rocom', 'rocom_pet_panel_cache.json')
const PANEL_EMPTY_FEATURE: PanelFeature = { id: '', name: '暂无特性', desc: '当前接口未返回特性描述。' }
const PANEL_EMPTY_SKILL_HINT = '当前接口未返回技能详情。'

let panelPetCacheMem: PanelPetCacheData | null = null

function panelPetCacheFilePath(deps: PluginDeps) {
  return path.join(deps.ctx.baseDir, PANEL_PET_CACHE_PATH)
}

function ensureBloodlineLabel(raw: string, mutationLabel: string): string {
  if (raw && raw !== '未知血脉') return raw
  return mutationLabel === '普通' ? '普通' : `${mutationLabel}系`
}

function loadPanelPetCache(deps: PluginDeps): PanelPetCacheData {
  if (panelPetCacheMem) return panelPetCacheMem
  const filePath = panelPetCacheFilePath(deps)
  try {
    if (!fs.existsSync(filePath)) {
      panelPetCacheMem = {}
      return panelPetCacheMem
    }
    const text = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(text)
    panelPetCacheMem = parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    logger.warn(`加载精灵面板缓存失败: ${err}`)
    panelPetCacheMem = {}
  }
  return panelPetCacheMem
}

function savePanelPetCache(deps: PluginDeps, data: PanelPetCacheData) {
  const filePath = panelPetCacheFilePath(deps)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)
  panelPetCacheMem = data
}

function readPanelPetCache(deps: PluginDeps, uid: string): PanelPetCacheRecord | null {
  const cache = loadPanelPetCache(deps)
  return cache[String(uid)] || null
}

function writePanelPetCache(deps: PluginDeps, uid: string, pets: PanelPetItem[]) {
  const cache = loadPanelPetCache(deps)
  cache[String(uid)] = {
    uid: String(uid),
    pets,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  savePanelPetCache(deps, cache)
  return cache[String(uid)]
}

function toNumber(value: any, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeMutationLabel(mutationType: number): string {
  if (mutationType === 9) return '了不起'
  if (mutationType === 8) return '炫彩'
  if (mutationType === 1) return '异色'
  return '普通'
}

function normalizeGender(value: any): string {
  const text = String(value ?? '').trim()
  if (!text) return '未知'
  if (['1', 'male', 'man', 'boy', 'm', '公'].includes(text.toLowerCase())) return '公'
  if (['2', 'female', 'woman', 'girl', 'f', '母'].includes(text.toLowerCase())) return '母'
  if (text === '0') return '无'
  return text
}

function pickFirstNonEmpty(...values: any[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function uniqueStrings(items: Array<string | undefined | null>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function normalizeSkillItem(raw: any): PanelSkillItem {
  const id = pickFirstNonEmpty(raw?.id, raw?.skill_id, raw?.skillId)
  return {
    id,
    name: pickFirstNonEmpty(raw?.name, raw?.skill_name, raw?.skillName) || (id ? `技能#${id}` : '未知技能'),
    isEquipped: Boolean(raw?.is_equipped ?? raw?.equipped ?? raw?.isEquipped),
    cost: pickFirstNonEmpty(raw?.cost, raw?.energy_cost, raw?.consume, raw?.spend) || '-',
    power: pickFirstNonEmpty(raw?.power, raw?.damage, raw?.power_value, raw?.damage_value) || '-',
    typeLabel: pickFirstNonEmpty(raw?.element, raw?.type_name, raw?.typeName, raw?.attribute_name, raw?.attributeName) || '未知',
    iconUrl: pickFirstNonEmpty(raw?.skill_img_url, raw?.icon, raw?.icon_url, raw?.img_url, raw?.image_url),
    description: pickFirstNonEmpty(raw?.desc, raw?.description, raw?.detail),
  }
}

function parsePanelSkills(raw: any): { feature: PanelFeature; equipSkills: PanelSkillItem[]; skills: PanelSkillItem[] } {
  const items: any[] = []
  const pushAll = (input: any) => {
    if (!input) return
    if (Array.isArray(input)) {
      for (const item of input) items.push(item)
      return
    }
    if (typeof input === 'object') {
      items.push(input)
    }
  }

  pushAll(raw?.display_info?.skill?.skill_data)
  pushAll(raw?.display_info?.skill_data)
  pushAll(raw?.display_info?.skills)
  pushAll(raw?.display_info?.skills_info)
  pushAll(raw?.skill?.skill_data)
  pushAll(raw?.skill_data)
  pushAll(raw?.skills)
  pushAll(raw?.skills_info)

  const featureCandidates: PanelFeature[] = []
  const skills: PanelSkillItem[] = []
  const equipSkills: PanelSkillItem[] = []
  const seenSkill = new Set<string>()

  const appendSkill = (skill: PanelSkillItem) => {
    const key = `${skill.name}#${skill.id}`
    if (seenSkill.has(key)) return
    seenSkill.add(key)
    skills.push(skill)
    if (skill.isEquipped) equipSkills.push(skill)
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const type = toNumber(item?.type, 1)
    if (type === 2) {
      featureCandidates.push({
        id: pickFirstNonEmpty(item?.id, item?.feature_id, item?.featureId),
        name: pickFirstNonEmpty(item?.name, item?.feature_name, item?.featureName) || '未知特性',
        desc: pickFirstNonEmpty(item?.desc, item?.description, item?.feature_desc, item?.featureDesc),
      })
      continue
    }
    appendSkill(normalizeSkillItem(item))
  }

  if (!skills.length) {
    const fallbackSkills = Array.isArray(raw?.display_info?.equip_skills) ? raw.display_info.equip_skills : []
    for (const skill of fallbackSkills) {
      appendSkill({ ...normalizeSkillItem(skill), isEquipped: true })
    }
    const normalSkills = Array.isArray(raw?.display_info?.skills) ? raw.display_info.skills : []
    for (const skill of normalSkills) appendSkill(normalizeSkillItem(skill))
  }

  const featureRaw = raw?.display_info?.feature || raw?.feature || raw?.feature_info || raw?.featureInfo
  if (featureRaw && typeof featureRaw === 'object') {
    featureCandidates.unshift({
      id: pickFirstNonEmpty(featureRaw?.id, featureRaw?.feature_id, featureRaw?.featureId),
      name: pickFirstNonEmpty(featureRaw?.name, featureRaw?.feature_name, featureRaw?.featureName) || '未知特性',
      desc: pickFirstNonEmpty(featureRaw?.desc, featureRaw?.description, featureRaw?.feature_desc, featureRaw?.featureDesc),
    })
  }

  const feature = featureCandidates.find(item => item.name && item.name !== '未知特性') || featureCandidates[0] || PANEL_EMPTY_FEATURE
  if (!equipSkills.length && skills.length) {
    equipSkills.push(...skills.slice(0, Math.min(4, skills.length)).map(item => ({ ...item, isEquipped: true })))
  }

  return { feature, equipSkills, skills }
}

function extractAttributeValue(source: any, addiMap: Record<number, number>, def: { aliases: string[]; addiType: number }) {
  let value = addiMap[def.addiType]
  let talent = 0
  let effortAdd = 0
  for (const key of def.aliases) {
    const attr = source?.[key]
    if (!attr || typeof attr !== 'object') continue
    if (!value) value = toNumber(attr.value, value)
    talent = toNumber(attr.talent, talent)
    effortAdd = toNumber(attr.effort_add, effortAdd)
  }
  return { value, talent, effortAdd }
}

function parsePanelAttributes(raw: any): PanelAttributeItem[] {
  const display = raw?.display_info || {}
  const attrSource = display?.attribute_info || raw?.attribute_info || {}
  const addiData = Array.isArray(display?.attribute_new_info?.addi_attr_data)
    ? display.attribute_new_info.addi_attr_data
    : Array.isArray(raw?.attribute_new_info?.addi_attr_data)
      ? raw.attribute_new_info.addi_attr_data
      : []

  const addiMap: Record<number, number> = {}
  for (const item of addiData) {
    const type = toNumber(item?.type)
    if (!type) continue
    addiMap[type] = toNumber(item?.addi_attr)
  }

  return PANEL_PET_STAT_DEFS.map(def => {
    const { value, talent, effortAdd } = extractAttributeValue(attrSource, addiMap, def)
    return {
      key: def.key,
      label: def.label,
      value,
      talent,
      effortAdd,
    }
  })
}

function parsePanelPetItem(raw: any, index: number): PanelPetItem | null {
  if (!raw || typeof raw !== 'object') return null
  const homePet = raw?.home_pet_info && typeof raw.home_pet_info === 'object' ? raw.home_pet_info : raw
  const display = raw?.display_info && typeof raw.display_info === 'object' ? raw.display_info : {}
  const petId = pickFirstNonEmpty(
    display?.base_conf_id,
    homePet?.pet_cfg_id,
    homePet?.pet_id,
    raw?.pet_cfg_id,
    raw?.pet_id,
    raw?.pet_base_id,
  )
  if (!petId || petId === '0') return null

  const gid = pickFirstNonEmpty(homePet?.pet_gid, raw?.pet_gid, raw?.gid, raw?.id, index + 1)
  const name = pickFirstNonEmpty(display?.name, homePet?.name, homePet?.pet_name, raw?.name, raw?.pet_name) || `精灵 ${petId}`
  const level = toNumber(display?.level ?? raw?.level ?? homePet?.level, 1)
  const mutationType = toNumber(display?.mutation_type ?? raw?.mutation_type ?? homePet?.mutation_type, 0)
  const bloodId = pickFirstNonEmpty(display?.blood_id, raw?.blood_id, homePet?.blood_id, homePet?.bloodline_id)

  const petTypesInfo = Array.isArray(display?.pet_types_info)
    ? display.pet_types_info
    : Array.isArray(raw?.pet_types_info)
      ? raw.pet_types_info
      : []
  const elementLabels = uniqueStrings(petTypesInfo.map((item: any) => pickFirstNonEmpty(item?.name, item?.type_name, item?.label)))
  const elementIcons = uniqueStrings(petTypesInfo.map((item: any) => pickFirstNonEmpty(item?.icon, item?.icon_url, item?.img_url)))
  const bloodlineLabelRaw = pickFirstNonEmpty(
    display?.bloodline_info?.name,
    display?.bloodline_info?.title,
    raw?.bloodline_info?.name,
    raw?.bloodline_info?.title,
    bloodId ? `血脉 ${bloodId}` : '',
  ) || '未知血脉'

  const { feature, equipSkills, skills } = parsePanelSkills(raw)
  const attributes = parsePanelAttributes(raw)
  const iconUrl = homePetIcon(petId, pickFirstNonEmpty(display?.pet_icon_url, raw?.pet_icon_url, raw?.icon_url, raw?.pet_img_url))
  const imageUrl = homePetImage(petId, pickFirstNonEmpty(display?.pet_img_url, raw?.pet_img_url, raw?.image_url, raw?.icon_url))

  const mutationLabel = normalizeMutationLabel(mutationType)

  return {
    gid,
    petId,
    name,
    level,
    gender: normalizeGender(display?.gender ?? raw?.gender ?? homePet?.gender),
    energy: toNumber(display?.energy ?? raw?.energy ?? homePet?.energy, 0),
    mutationType,
    mutationLabel,
    bloodId,
    bloodlineLabel: ensureBloodlineLabel(bloodlineLabelRaw, mutationLabel),
    elementLabels,
    elementIcons,
    iconUrl,
    imageUrl,
    feature,
    equipSkills,
    skills,
    attributes,
  }
}

function normalizeMutationBySubset(subset: number): number {
  if (subset === 1) return 9
  if (subset === 2) return 1
  if (subset === 3) return 8
  return 0
}

function parseMutationTypeFromPet(pet: any, subset: number): number {
  const direct = toNumber(pet?.pet_mutation ?? pet?.mutation_type ?? pet?.mutation ?? pet?.petMutation, NaN)
  if (Number.isFinite(direct) && direct >= 0) return direct
  return normalizeMutationBySubset(subset)
}

function panelPetItemFromBagPet(raw: any, subset: number, index: number): PanelPetItem | null {
  if (!raw || typeof raw !== 'object') return null
  const petId = pickFirstNonEmpty(raw?.pet_base_id, raw?.pet_id, raw?.id)
  if (!petId || petId === '0') return null
  const mutationType = parseMutationTypeFromPet(raw, subset)
  const mutationLabel = normalizeMutationLabel(mutationType)
  const petNameRaw = pickFirstNonEmpty(raw?.pet_name, raw?.name) || `精灵 ${petId}`
  const [baseName] = petNameRaw.split('&')
  const level = toNumber(raw?.pet_level ?? raw?.level, 1)
  const types = Array.isArray(raw?.pet_types_info) ? raw.pet_types_info : []
  const elementLabels = uniqueStrings(types.map((item: any) => pickFirstNonEmpty(item?.name, item?.type_name)))
  const elementIcons = uniqueStrings(types.map((item: any) => pickFirstNonEmpty(item?.icon, item?.icon_url)))
  const iconFromImage = String(raw?.pet_img_url || '').replace('/image.png', '/icon.png')
  const iconUrl = homePetIcon(petId, iconFromImage)
  const imageUrl = homePetImage(petId, pickFirstNonEmpty(raw?.pet_img_url, raw?.image_url))
  const gid = pickFirstNonEmpty(raw?.pet_gid, raw?.gid, raw?.id, `${subset}-${index + 1}`)

  return {
    gid,
    petId,
    name: baseName || petNameRaw,
    level,
    gender: '未知',
    energy: 0,
    mutationType,
    mutationLabel,
    bloodId: '',
    bloodlineLabel: ensureBloodlineLabel('', mutationLabel),
    elementLabels,
    elementIcons,
    iconUrl,
    imageUrl,
    feature: PANEL_EMPTY_FEATURE,
    equipSkills: [],
    skills: [],
    attributes: PANEL_PET_STAT_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      value: 0,
      talent: 0,
      effortAdd: 0,
    })),
  }
}

function panelRefreshErrorHint(client: any): string {
  const detail = client.getLastErrorBrief('请稍后重试')
  if (/api key|access token|anonymous token|认证凭证|未授权|401|403/i.test(String(detail))) {
    return '刷新失败：当前环境缺少 API 凭证，且本账号未登录，无法拉取面板数据。请先执行 洛克.QQ登录 或 洛克.微信登录。'
  }
  return `刷新失败：${detail}`
}

async function fetchPanelPetsFromBag(deps: PluginDeps, userId: string): Promise<PanelPetItem[] | null> {
  const fwToken = await getPrimaryToken(deps, userId)
  if (!fwToken) return null
  const userIdentifier = userId

  const listTasks: Promise<any>[] = []
  for (const subset of [0, 1, 2, 3]) {
    listTasks.push(deps.client.getPets(deps.ctx, fwToken, subset, 1, 200, userIdentifier))
  }

  const listRes = await Promise.all(listTasks)
  const pets: PanelPetItem[] = []
  const dedup = new Set<string>()
  listRes.forEach((res, idx) => {
    const subset = idx
    const rows = Array.isArray(res?.pets) ? res.pets : []
    rows.forEach((raw: any, rowIndex: number) => {
      const pet = panelPetItemFromBagPet(raw, subset, rowIndex)
      if (!pet) return
      const key = `${pet.petId}#${pet.name}#${pet.mutationType}`
      if (dedup.has(key)) return
      dedup.add(key)
      pets.push(pet)
    })
  })

  return pets
}

function extractPanelPetSources(homeInfo: any): any[] {
  const cell = homeCellInfo(homeInfo)
  const sources: any[] = []
  const pushAll = (value: any) => {
    if (!Array.isArray(value)) return
    for (const item of value) sources.push(item)
  }

  pushAll(homeInfo?.home_pets)
  pushAll(cell?.home_pets)
  pushAll(cell?.home_pet_info?.home_pet_list)
  pushAll(homeInfo?.friend_cell_home_brief_info?.home_pets)

  return sources
}

function buildPanelPetList(homeInfo: any): PanelPetItem[] {
  const sources = extractPanelPetSources(homeInfo)
  const pets: PanelPetItem[] = []
  const dedup = new Set<string>()
  for (let i = 0; i < sources.length; i++) {
    const pet = parsePanelPetItem(sources[i], i)
    if (!pet) continue
    const key = `${pet.gid}#${pet.petId}`
    if (dedup.has(key)) continue
    dedup.add(key)
    pets.push(pet)
  }
  return pets
}

function panelUidFromBinding(deps: PluginDeps, session: any, uid = ''): string {
  const inputUid = String(uid || '').trim()
  if (inputUid) return inputUid
  return String(deps.userMgr.getPrimaryBinding(session?.userId || '')?.role_id || '')
}

function parsePanelPetQuery(rawQuery: string) {
  const query = String(rawQuery || '').trim()
  const gid = (query.match(/\d+/)?.[0] || '').trim()
  const name = query.replace(/\d+/g, '').trim()
  return { query, gid, name }
}

function findPanelPets(pets: PanelPetItem[], queryRaw: string): PanelPetItem[] {
  const parsed = parsePanelPetQuery(queryRaw)
  if (!parsed.query) return []

  let candidates = pets
  if (parsed.gid) {
    candidates = candidates.filter(pet => String(pet.gid) === parsed.gid)
  }
  if (parsed.name) {
    const exact = candidates.filter(pet => pet.name === parsed.name)
    if (exact.length) return exact
    const normalized = parsed.name.toLowerCase()
    candidates = candidates.filter((pet) => String(pet.name || '').toLowerCase().includes(normalized))
  }
  if (!parsed.gid && !parsed.name) {
    const normalized = parsed.query.toLowerCase()
    candidates = candidates.filter((pet) =>
      String(pet.gid).includes(parsed.query)
      || String(pet.petId).includes(parsed.query)
      || String(pet.name || '').toLowerCase().includes(normalized),
    )
  }
  return candidates
}

function panelPetListFallback(uid: string, pets: PanelPetItem[], updatedAtText: string) {
  const lines = [
    `【UID ${uid} 精灵面板已刷新】`,
    `刷新时间：${updatedAtText}`,
    `共 ${pets.length} 只精灵`,
  ]
  for (const pet of pets.slice(0, 40)) {
    const tags = [...pet.elementLabels, pet.bloodlineLabel].filter(Boolean).join(' / ')
    lines.push(`- ${pet.name} (GID:${pet.gid}) Lv.${pet.level} ${pet.mutationLabel}${tags ? ` | ${tags}` : ''}`)
  }
  if (pets.length > 40) lines.push(`... 其余 ${pets.length - 40} 只请使用图片面板查看`)
  lines.push('查询详情：洛克.精灵面板 <名称或GID> [UID]')
  return lines.join('\n')
}

function panelPetDetailFallback(uid: string, pet: PanelPetItem, cacheUpdatedAtText: string) {
  const lines = [
    `【精灵面板】${pet.name} (GID:${pet.gid})`,
    `UID: ${uid} | 刷新时间: ${cacheUpdatedAtText}`,
    `等级: Lv.${pet.level} | 稀有: ${pet.mutationLabel} | 血脉: ${pet.bloodlineLabel}`,
    `属性: ${pet.elementLabels.join(' / ') || '未知'}`,
  ]
  if (pet.feature?.name) {
    lines.push(`特性: ${pet.feature.name}`)
    if (pet.feature.desc) lines.push(`说明: ${pet.feature.desc}`)
  }
  if (pet.equipSkills.length) {
    lines.push('已装备技能:')
    for (const skill of pet.equipSkills.slice(0, 6)) {
      lines.push(`- ${skill.name} [${skill.typeLabel}] 能耗:${skill.cost} 威力:${skill.power}`)
    }
  }
  return lines.join('\n')
}

function panelPetListData(uid: string, pets: PanelPetItem[], updatedAtText: string) {
  return {
    title: '精灵面板',
    subtitle: `UID ${uid} · 共 ${pets.length} 只精灵`,
    updatedAtText,
    cards: pets.map((pet) => ({
      gid: pet.gid,
      petId: pet.petId,
      name: pet.name,
      level: pet.level,
      mutationLabel: pet.mutationLabel,
      bloodlineLabel: pet.bloodlineLabel,
      iconUrl: pet.iconUrl,
      elementLabels: pet.elementLabels,
      elementIcons: pet.elementIcons,
    })),
    commandHint: '洛克.精灵面板 <名称或GID> [UID] | 洛克.刷新面板 [UID]',
  }
}

function panelPetDetailData(uid: string, pet: PanelPetItem, updatedAtText: string) {
  return {
    title: '精灵详情面板',
    subtitle: `UID ${uid} · GID ${pet.gid}`,
    updatedAtText,
    pet,
    hasEquipSkills: pet.equipSkills.length > 0,
    hasSkills: pet.skills.length > 0,
    emptySkillHint: PANEL_EMPTY_SKILL_HINT,
    commandHint: '再次刷新：洛克.刷新面板 [UID] | 查询其他精灵：洛克.精灵面板 <名称或GID> [UID]',
  }
}

async function refreshPanelPets(deps: PluginDeps, uid: string, userId = '') {
  const res = await deps.client.ingameHomeInfo(deps.ctx, uid, 20000)
  if (res) {
    const homeInfo = homeInfoPayload(res)
    const pets = buildPanelPetList(homeInfo)
    return writePanelPetCache(deps, uid, pets)
  }

  // 无 ingame 凭证时，自动降级到已登录账号的背包接口
  const fallbackUserId = String(userId || '').trim()
  const fallbackPets = fallbackUserId ? await fetchPanelPetsFromBag(deps, fallbackUserId) : null
  if (fallbackPets && fallbackPets.length) {
    return writePanelPetCache(deps, uid, fallbackPets)
  }
  return null
}

async function resolvePanelPets(deps: PluginDeps, uid: string, userId = '', forceRefresh = false) {
  if (forceRefresh) {
    const refreshed = await refreshPanelPets(deps, uid, userId)
    if (refreshed) return { record: refreshed, refreshed: true }
    return { record: null, refreshed: true }
  }

  const cache = readPanelPetCache(deps, uid)
  if (cache?.pets?.length) return { record: cache, refreshed: false }
  const refreshed = await refreshPanelPets(deps, uid, userId)
  return { record: refreshed, refreshed: true }
}

function formatPanelUpdatedAt(ts: number) {
  const value = Number(ts)
  if (!Number.isFinite(value) || value <= 0) return new Date().toLocaleString('zh-CN')
  return new Date(value * 1000).toLocaleString('zh-CN')
}

function extractHomePet(raw: any, index: number, guard = false) {
  if (!raw || typeof raw !== 'object') return null
  const homePet = raw.home_pet_info && typeof raw.home_pet_info === 'object' ? raw.home_pet_info : raw
  const display = raw.display_info && typeof raw.display_info === 'object' ? raw.display_info : {}
  const petId = homePet.pet_cfg_id || homePet.pet_id || homePet.pet_base_id || raw.pet_cfg_id || raw.pet_id || raw.id
  if (['', '0'].includes(String(petId || '0')) && !guard) return null
  const feedInfo = homePet.feed_info && typeof homePet.feed_info === 'object' ? homePet.feed_info : {}
  const beginTime = normalizeEpochSeconds(feedInfo.begin_time)
  const timeCost = normalizeDurationSeconds(feedInfo.time_cost)
  let readyAt = normalizeEpochSeconds(homePet.pet_rip_time || raw.pet_rip_time || raw.rip_time)
  if (!readyAt && beginTime && timeCost) readyAt = beginTime + timeCost
  const nowTs = Math.floor(Date.now() / 1000)
  const hasInspiration = Boolean(readyAt)
  const inspireReady = hasInspiration && nowTs >= readyAt
  const isGuard = guard || Boolean(raw.is_guard || raw.guard) || ['2', 'guard', '守卫'].includes(String(raw.status).toLowerCase())
  const statusText = isGuard && !hasInspiration ? '守卫中' : inspireReady ? '灵感已完成' : hasInspiration ? '灵感收集中' : '未喂食'
  const statusClass = isGuard && !hasInspiration ? 'guard' : inspireReady ? 'ready' : hasInspiration ? 'progress' : 'idle'
  return {
    id: String(petId || ''),
    pos: raw.pos || raw.position || index + 1,
    name: String(homePet.name || homePet.pet_name || raw.name || raw.pet_name || `精灵 ${petId || ''}`),
    level: display.level || raw.level || homePet.level || '--',
    iconUrl: homePetIcon(petId, raw.icon_url || raw.pet_img_url || raw.petIcon || ''),
    badge: isGuard ? '守' : '',
    isGuard,
    statusText,
    statusClass,
    note: hasInspiration ? formatHomeRemaining(readyAt, nowTs) : (isGuard ? '家园守卫位' : '暂无灵感倒计时'),
    inspireReady,
    readyAt,
  }
}

function homePetSources(homeInfo: any) {
  const cell = homeCellInfo(homeInfo)
  const indoorSources: any[] = []
  const guardSources: any[] = []
  if (Array.isArray(homeInfo?.home_pets)) indoorSources.push(...homeInfo.home_pets)
  if (Array.isArray(cell?.home_pets)) {
    for (const pet of cell.home_pets) {
      const homePet = pet?.home_pet_info || {}
      if (String(homePet.pet_cfg_id || '0') === '0' && (homePet.name || homePet.pet_name)) guardSources.push(pet)
      else indoorSources.push(pet)
    }
  }
  const petInfo = cell?.home_pet_info || {}
  if (Array.isArray(petInfo.home_pet_list)) indoorSources.push(...petInfo.home_pet_list)
  for (const key of ['guard_pets', 'home_guard_pets', 'guard_pet_list']) {
    if (Array.isArray(homeInfo?.[key])) guardSources.push(...homeInfo[key])
    if (Array.isArray(cell?.[key])) guardSources.push(...cell[key])
  }
  for (const key of ['guard_pet', 'home_guard_pet', 'guard_pet_info', 'home_guard_pet_info', 'defend_pet', 'defend_pet_info', 'protect_pet', 'protect_pet_info']) {
    if (homeInfo?.[key] && typeof homeInfo[key] === 'object') guardSources.push(homeInfo[key])
    if (cell?.[key] && typeof cell[key] === 'object') guardSources.push(cell[key])
  }
  return { indoorSources, guardSources }
}

function homePlantIcon(deps: PluginDeps, iconId: any): string {
  if (!iconId) return ''
  const text = String(iconId)
  if (/^(https?:|data:)/.test(text)) return text
  return deps.renderer.resourceUrl(`render-templates/home/img/home_icon/${text}_2.png`)
}

let homePlantMapCache: Record<string, any> | null = null
const HOME_PLANT_MAP_RELATIVE_PATH = path.join('render-templates', 'home', 'data', 'home_item_list.json')

function resolveHomePlantMapPath() {
  const candidates = [
    path.resolve(__dirname, '..', HOME_PLANT_MAP_RELATIVE_PATH),
    path.resolve(__dirname, HOME_PLANT_MAP_RELATIVE_PATH),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

function loadHomePlantMap(): Record<string, any> {
  if (homePlantMapCache) return homePlantMapCache
  const filePath = resolveHomePlantMapPath()
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    homePlantMapCache = data && typeof data === 'object' ? data : {}
  } catch (err) {
    logger.warn(`加载家园作物映射失败: ${err}`)
    homePlantMapCache = {}
  }
  return homePlantMapCache
}

function extractHomePlants(deps: PluginDeps, homeInfo: any): any[] {
  const cell = homeCellInfo(homeInfo)
  const plantSources: any[] = []
  const plantMap = loadHomePlantMap()
  if (Array.isArray(homeInfo?.home_plants)) plantSources.push(...homeInfo.home_plants)
  const plantInfo = cell?.home_plant_info || {}
  for (const land of Array.isArray(plantInfo.home_plant_land_list) ? plantInfo.home_plant_land_list : []) {
    for (const item of land.home_plant_list || []) plantSources.push({ ...item, land_index: land.land_index })
  }
  const nowTs = Math.floor(Date.now() / 1000)
  return plantSources.map((raw, index) => {
    const plantData = raw.plant_info && typeof raw.plant_info === 'object' ? raw.plant_info : raw
    const plantId = raw.plant_seed_id || raw.plant_cfg_id || raw.plant_id || plantData.id
    if (['', '0'].includes(String(plantId || '0'))) return null
    const mappedPlant = plantMap[String(plantId)] || {}
    const iconId = plantData.icon_url || plantData.iconUrl || raw.icon_url || raw.iconUrl || plantData.iconid || raw.iconid || raw.icon_id || mappedPlant.iconid
    let readyAt = normalizeEpochSeconds(raw.plant_rip_time || raw.rip_time || raw.end_time)
    const leftTime = Number(raw.left_time || 0)
    if (!readyAt && leftTime > 0) readyAt = nowTs + leftTime
    const ready = Boolean(readyAt && nowTs >= readyAt) || ['2', 'ready', 'mature'].includes(String(raw.status))
    const total = Number(raw.time_cost || raw.total_time || 0)
    const progress = total && readyAt ? Math.max(0, Math.min(100, Math.floor(((total - Math.max(0, readyAt - nowTs)) / total) * 100))) : (ready ? 100 : 35)
    const harvestNum = raw.plant_harvest_num
    const stealAccount = raw.plant_steal_account
    const canStealAccount = raw.plant_can_steal_account
    return {
      id: String(plantId),
      landIndex: raw.slot_index || raw.land_index || index + 1,
      plantName: plantData.name || raw.name || mappedPlant.name || `种子 ${plantId}`,
      iconUrl: homePlantIcon(deps, iconId),
      stateType: ready ? 'ready' : 'warning',
      statusText: ready ? '已成熟' : '成长中',
      leftTimeText: ready ? '可收获' : formatHomeRemaining(readyAt, nowTs),
      progress,
      ready,
      readyAt,
      harvestText: harvestNum !== undefined && harvestNum !== '' ? `产量 ${harvestNum}` : '',
      stealText: stealAccount !== undefined && canStealAccount !== undefined ? `可偷 ${stealAccount}/${canStealAccount}` : '',
    }
  }).filter(Boolean)
}

function buildHomeRenderData(deps: PluginDeps, res: any, uid: string) {
  const homeInfo = homeInfoPayload(res)
  const brief = homeBriefInfo(homeInfo)
  const { indoorSources, guardSources } = homePetSources(homeInfo)
  const indoorPets: any[] = []
  const guardPets: any[] = []
  indoorSources.forEach((raw, index) => {
    const item = extractHomePet(raw, index)
    if (!item) return
    if (item.isGuard) guardPets.push(item)
    else indoorPets.push(item)
  })
  guardSources.forEach((raw, index) => {
    const item = extractHomePet(raw, index, true)
    if (item) guardPets.push(item)
  })
  const gardenPlots = extractHomePlants(deps, homeInfo)
  const createdAt = normalizeEpochSeconds(res?.meta?.created_at)
  return {
    title: '洛克家园',
    subtitle: 'Home Information',
    homeName: brief.home_name || brief.name || `${uid} 的小屋`,
    uid,
    summaryCards: [
      { label: '房间等级', value: brief.room_level || '--' },
      { label: '家园等级', value: brief.home_level || '--' },
      { label: '家园经验', value: brief.home_experience || '--' },
      { label: '舒适度', value: brief.home_comfort_level || '--' },
    ],
    gardenPlots,
    guardPets,
    indoorPets,
    gardenCount: gardenPlots.length,
    guardCount: guardPets.length,
    indoorCount: indoorPets.length,
    guardEmptyText: '后端当前返回中没有守卫精灵字段',
    updatedAt: new Date(createdAt ? createdAt * 1000 : Date.now()).toLocaleString('zh-CN'),
  }
}

function buildPlayerSearchRenderData(payload: any, uid: string) {
  const parsed = parseIngamePlayerPayload(payload, uid)
  const pack = (title: string, pairs: [string, string][]) => {
    const items = pairs
      .filter(([, value]) => value && value !== '-' && value !== '未设置')
      .map(([label, value]) => ({ label, value }))
    return items.length ? { title, items } : null
  }
  const sections = [
    pack('核心档案', [
      ['等级', parsed.level],
      ['在线状态', playerField(parsed, 'online', playerField(parsed, 'is_online'))],
      ['性别', playerField(parsed, 'gender', playerField(parsed, 'sex'))],
      ['世界等级', playerField(parsed, 'world_level')],
      ['图鉴收集', playerField(parsed, 'card_handbook_collect_num')],
      ['最后离线', playerField(parsed, 'last_logout_time')],
    ]),
    pack('家园信息', [
      ['家园名称', playerField(parsed, 'home_name')],
      ['家园等级', playerField(parsed, 'home_level')],
      ['家园经验', playerField(parsed, 'home_experience')],
      ['舒适度', playerField(parsed, 'home_comfort_level')],
      ['访客数量', playerField(parsed, 'visitor_num')],
    ]),
    pack('名片信息', [
      ['名片皮肤', playerField(parsed, 'card_skin_selected')],
      ['名片头像', playerField(parsed, 'card_icon_selected')],
      ['首标签', playerField(parsed, 'card_label_first_selected')],
      ['尾标签', playerField(parsed, 'card_label_last_selected')],
    ]),
  ].filter(Boolean)
  const summaryCards = [
    { label: '等级', value: parsed.level },
    { label: '在线状态', value: playerField(parsed, 'online', playerField(parsed, 'is_online')) },
    { label: '世界等级', value: playerField(parsed, 'world_level') },
    { label: '图鉴收集', value: playerField(parsed, 'card_handbook_collect_num') },
    { label: '家园等级', value: playerField(parsed, 'home_level') },
    { label: '舒适度', value: playerField(parsed, 'home_comfort_level') },
  ].filter(item => item.value && item.value !== '-')
  const signature = parsed.signature && parsed.signature !== '未设置' ? parsed.signature : ''
  return {
    title: '洛克玩家',
    subtitle: parsed.title,
    heroTitle: '玩家信息',
    heroValue: parsed.nickname,
    heroSubvalue: `UID ${parsed.uid}`,
    summaryCards,
    signature,
    showSignature: Boolean(signature),
    sections,
    commandHint: '洛克.玩家 <UID>',
    copyright: 'Koishi & WeGame Locke Kingdom Plugin',
  }
}

function buildShopRenderData(payload: any, shopId: string) {
  const sections: any[] = []
  const detailItems: any[] = []
  const summaryCards: any[] = [{ label: '商店 ID', value: shopId }]
  if (Array.isArray(payload?.rows)) {
    detailItems.push(...payload.rows.filter((row: any) => Number(row.level || 0) === 0).map((row: any) => ({
      label: row.label || row.field || '-',
      value: stringifyInspectValue(row.value),
    })))
  } else {
    for (const [key, value] of Object.entries(payload || {})) {
      if (Array.isArray(value)) {
        summaryCards.push({ label: key, value: String(value.length) })
        sections.push({
          title: key.replace(/_/g, ' '),
          cards: value.slice(0, 24).map((item: any, index: number) => ({
            title: item?.name || item?.title || item?.item_name || `${key} #${index + 1}`,
            image: item?.icon || item?.icon_url || item?.image || item?.image_url || '',
            meta: Object.entries(item || {})
              .filter(([metaKey, metaValue]) => !['name', 'title', 'item_name', 'icon', 'icon_url', 'image', 'image_url'].includes(metaKey) && (metaValue === null || typeof metaValue !== 'object'))
              .slice(0, 6)
              .map(([metaKey, metaValue]) => ({ label: metaKey.replace(/_/g, ' '), value: stringifyInspectValue(metaValue) })),
          })),
        })
      } else if (value === null || typeof value !== 'object') {
        detailItems.push({ label: key.replace(/_/g, ' '), value: stringifyInspectValue(value) })
      }
    }
  }
  return {
    title: '洛克商店',
    subtitle: `shop_id = ${shopId}`,
    heroTitle: '商店查询',
    heroValue: detailItems.find(item => ['name', 'title', '名称', '标题'].includes(item.label))?.value || shopId,
    heroSubvalue: `shop_id = ${shopId}`,
    summaryCards: summaryCards.slice(0, 3),
    sections,
    detailItems: detailItems.slice(0, 18),
    commandHint: '洛克.商店 <shop_id>',
    copyright: 'Koishi & WeGame Locke Kingdom Plugin',
  }
}

function buildFriendshipRenderData(payload: any, userIds: string) {
  const result = payload?.result || {}
  const users = payload?.user_list || payload?.userList || []
  const userCards = users.map((user: any, index: number) => {
    const statusCode = user.status
    return {
      title: `用户 ${index + 1}`,
      userId: String(user.user_id || user.userId || '-'),
      statusCode: stringifyInspectValue(statusCode),
      statusText: String(statusCode) === '0' ? '状态正常' : `状态码 ${statusCode}`,
      statusDesc: '接口已返回该用户状态，但后端当前没有提供更具体的关系类型说明。',
    }
  })
  return {
    title: '好友关系',
    subtitle: `查询 ID：${userIds}`,
    summaryCards: [
      { label: '查询对象', value: String(userCards.length || userIds.split(',').length) },
      { label: '接口状态', value: Number(result.error_code || 0) === 0 ? '成功' : '异常' },
      { label: '上游返回', value: result.error_message || 'OK' },
    ],
    userCards,
    resultCode: stringifyInspectValue(result.error_code || 0),
    resultDesc: '当前接口只返回 status 字段，尚未提供“好友/非好友/黑名单”等可读关系类型。',
    commandHint: '洛克.好友关系 <id1,id2>',
    copyright: 'Koishi & WeGame Locke Kingdom Plugin',
  }
}

function buildStudentRenderData(statePayload: any, perksPayload: any, area: number, accountType: number) {
  const school = statePayload?.school || statePayload?.school_name || '未返回'
  const certified = String(statePayload?.certified) === '1'
  const cards = perksPayload?.cards || []
  return {
    title: '洛克学生',
    subtitle: `大区：${area}  账号类型：${accountTypeText(accountType)}`,
    heroTitle: '学生信息总览',
    heroValue: certified ? '已通过' : '未认证',
    heroSubvalue: school,
    summaryCards: [
      { label: '认证状态', value: certified ? '已认证' : '未认证' },
      { label: '学校', value: school },
      { label: '奖励数量', value: String(cards.length) },
    ],
    stateItems: [
      { label: '学生认证', value: certified ? '是' : '否' },
      { label: '游戏内认证', value: String(statePayload?.game_certified) === '1' ? '是' : '否' },
      { label: '学校', value: school },
      { label: '上游状态', value: statePayload?.result?.error_message || 'WG_COMM_SUCC' },
      { label: '上游错误码', value: stringifyInspectValue(statePayload?.result?.error_code || 0) },
    ],
    perkCards: cards.map((card: any) => ({
      name: card.name || `奖励 #${card.id || '-'}`,
      count: card.count || 0,
      desc: card.desc || '暂无说明',
      icon: card.icon || '',
      id: stringifyInspectValue(card.id),
      stateText: `状态码 ${stringifyInspectValue(card.state)}`,
    })),
    detailItems: Object.entries(perksPayload || {})
      .filter(([key, value]) => !['cards', 'result'].includes(key) && (value === null || typeof value !== 'object'))
      .map(([key, value]) => ({ label: key.replace(/_/g, ' '), value: stringifyInspectValue(value) })),
    stateResult: statePayload?.result?.error_message || 'WG_COMM_SUCC',
    perksResult: perksPayload?.result?.error_message || 'WG_COMM_SUCC',
    commandHint: '洛克.学生 [area] [account_type]',
    copyright: 'Koishi & WeGame Locke Kingdom Plugin',
  }
}

function sessionTarget(session: any) {
  return {
    platform: session?.platform || session?.bot?.platform || '',
    channelId: session?.channelId || session?.guildId || '',
    userId: session?.guildId ? '' : (session?.userId || ''),
  }
}

function homeSubscriptionKey(session: any, uid: string, kind: 'garden' | 'inspiration') {
  const target = sessionTarget(session)
  return [target.platform, target.channelId || 'private', target.userId || session?.guildId || '', uid, kind].join(':')
}

function isBotAdmin(session: any, adminUserIds: string[]) {
  return adminUserIds.includes(session?.userId || '')
}

async function resolveHomeUid(deps: PluginDeps, session: any, uid = '') {
  const targetUid = String(uid || '').trim()
  if (targetUid) return targetUid
  return String(deps.userMgr.getPrimaryBinding(session?.userId || '')?.role_id || '')
}

async function subscribeHome(deps: PluginDeps, session: any, uid: string, kind: 'garden' | 'inspiration') {
  const target = sessionTarget(session)
  if (!target.userId && !isBotAdmin(session, deps.config.adminUserIds)) return '此指令仅限管理员使用。'
  const targetUid = await resolveHomeUid(deps, session, uid)
  if (!targetUid) return kind === 'garden' ? '请提供玩家 UID，或先完成绑定后再订阅家园菜园。' : '请提供玩家 UID，或先完成绑定后再订阅家园灵感。'
  const key = homeSubscriptionKey(session, targetUid, kind)
  deps.homeSubMgr.upsert(key, {
    key,
    kind,
    uid: targetUid,
    platform: target.platform,
    channel_id: target.channelId,
    guild_id: session?.guildId || '',
    user_id: target.userId,
    updated_by: session?.userId || '',
    notify_state: {},
    updated_at: Math.floor(Date.now() / 1000),
  })
  return kind === 'garden'
    ? `已订阅 UID ${targetUid} 的家园菜园提醒：首个成熟和全部成熟时各推送一次。`
    : `已订阅 UID ${targetUid} 的家园精灵灵感提醒：首个完成和全部完成时各推送一次。`
}

function homeSubscriptionState(data: any, kind: 'garden' | 'inspiration') {
  if (kind === 'garden') {
    const items = data.gardenPlots || []
    const readyItems = items.filter((item: any) => item.ready)
    const names = readyItems.map((item: any) => `田地${item.landIndex} ${item.plantName}`)
    return { items, readyItems, names }
  }
  const items = [...(data.indoorPets || []), ...(data.guardPets || [])].filter((item: any) => item.readyAt)
  const readyItems = items.filter((item: any) => item.inspireReady)
  const names = readyItems.map((item: any) => item.name || '未知精灵')
  return { items, readyItems, names }
}

function homeSubscriptionMessage(uid: string, kind: 'garden' | 'inspiration', level: 'first' | 'all', totalCount: number, readyItems: any[], names: string[]) {
  const kindText = kind === 'garden' ? '菜园作物' : '精灵灵感'
  const actionText = kind === 'garden' ? '成熟' : '完成'
  const levelText = level === 'first' ? '首个' : '全部'
  return [
    `家园${kindText}${levelText}${actionText}提醒：${uid}`,
    `进度：${readyItems.length}/${totalCount}`,
    names.length ? `已完成：${names.slice(0, 8).join('、')}` : '',
  ].filter(Boolean).join('\n')
}

async function checkHomeSubscriptions(deps: PluginDeps) {
  const subs = deps.homeSubMgr.getAll()
  const cache = new Map<string, any>()
  let checkedCount = 0
  let pushedCount = 0
  for (const [key, sub] of Object.entries(subs)) {
    if (!sub.uid || !['garden', 'inspiration'].includes(sub.kind)) continue
    checkedCount++
    if (!cache.has(sub.uid)) {
      cache.set(sub.uid, await deps.client.ingameHomeInfo(deps.ctx, sub.uid))
    }
    const res = cache.get(sub.uid)
    if (!res) continue
    const data = buildHomeRenderData(deps, res, sub.uid)
    const { items, readyItems, names } = homeSubscriptionState(data, sub.kind)
    const totalCount = items.length
    if (totalCount <= 0) continue
    const notifyState = sub.notify_state || {}
    const pushLevels: ('first' | 'all')[] = []
    if (!readyItems.length) {
      notifyState.first = false
      notifyState.all = false
    } else {
      if (!notifyState.first) pushLevels.push('first')
      if (readyItems.length >= totalCount && !notifyState.all) pushLevels.push('all')
      if (readyItems.length < totalCount) notifyState.all = false
    }
    if (!pushLevels.length) {
      deps.homeSubMgr.upsert(key, { ...sub, notify_state: notifyState })
      continue
    }
    const messages = pushLevels.map(level => homeSubscriptionMessage(sub.uid, sub.kind, level, totalCount, readyItems, names))
    try {
      const sent = await sendScheduledMessage(deps.ctx, {
        platform: sub.platform,
        channelId: sub.channel_id || sub.guild_id || sub.user_id || '',
        guildId: sub.guild_id || '',
        userId: sub.user_id || '',
      }, messages.join('\n\n'))
      if (!sent) continue
    } catch (e) {
      logger.warn(`家园订阅推送失败: ${e}`)
      continue
    }
    for (const level of pushLevels) notifyState[level] = true
    pushedCount += pushLevels.length
    deps.homeSubMgr.upsert(key, { ...sub, notify_state: notifyState, last_push_time: Math.floor(Date.now() / 1000) })
  }
  return { subscriptions: Object.keys(subs).length, checked: checkedCount, pushed: pushedCount }
}

export function register(deps: PluginDeps) {
  const { ctx, client } = deps

  ctx.command('洛克').subcommand('.档案', '查看个人档案')
    .alias('洛克档案')
    .action(async ({ session }) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const userIdentifier = session!.userId!

      const [roleRes, evalRes, sumRes, collRes, boRes, blRes] = await Promise.all([
        client.getRole(ctx, fwToken, undefined, userIdentifier),
        client.getEvaluation(ctx, fwToken, userIdentifier),
        client.getPetSummary(ctx, fwToken, userIdentifier),
        client.getCollection(ctx, fwToken, userIdentifier),
        client.getBattleOverview(ctx, fwToken, userIdentifier),
        client.getBattleList(ctx, fwToken, 1, '', userIdentifier),
      ])

      if (!roleRes?.role) return `获取角色档案失败：${client.getLastErrorBrief('请重新登录后重试')}`

      const role = roleRes.role
      const ev = evalRes || {}
      const sm = sumRes || {}
      const cl = collRes || {}
      const bo = boRes || {}
      const recentBattle = blRes?.battles?.[0]
      const playerSearchRes = role?.id ? await client.ingamePlayerSearch(ctx, String(role.id)) : null
      const playerSearchData = parseIngamePlayerPayload(playerSearchRes, String(role.id || ''))
      const profileSignature = playerSearchData?.signature || ''
      const profileHeadTags = playerSearchData ? [
        { label: '在线', value: playerField(playerSearchData, 'online', '未知') },
        { label: '性别', value: playerField(playerSearchData, 'gender', playerField(playerSearchData, 'sex', '未知')) },
        { label: '世界等级', value: playerField(playerSearchData, 'world_level') },
        { label: '家园等级', value: playerField(playerSearchData, 'home_level') },
      ].filter((item) => item.value && item.value !== '-' && item.value !== '未设置').slice(0, 4) : []
      const profileHomeItems = playerSearchData ? [
        { label: '家园名称', value: playerField(playerSearchData, 'home_name') },
        { label: '家园等级', value: playerField(playerSearchData, 'home_level') },
        { label: '家园经验', value: playerField(playerSearchData, 'home_experience') },
        { label: '舒适度', value: playerField(playerSearchData, 'home_comfort_level') },
        { label: '访客数量', value: playerField(playerSearchData, 'visitor_num') },
      ].filter((item) => item.value && item.value !== '-' && item.value !== '未设置') : []
      const profileCardItems = playerSearchData ? [
        { label: '名片皮肤', value: playerField(playerSearchData, 'card_skin_selected') },
        { label: '名片头像', value: playerField(playerSearchData, 'card_icon_selected') },
      ].filter((item) => item.value && item.value !== '-' && item.value !== '未设置') : []
      const profileCardImage = playerSearchData ? playerField(playerSearchData, 'card_bussiness_card_url', '') : ''
      const profileStatusText = playerSearchData ? playerField(playerSearchData, 'online', '未知') : '未知'
      const hasExtraProfileData = Boolean(profileSignature || profileHomeItems.length || profileCardItems.length || profileCardImage)

      let degraded = false
      if (!sm) {
        logger.warn('[Rocom] 洛克.档案：pet-summary 接口不可用，已降级为基础档案渲染')
        degraded = true
      }
      if (!ev) {
        logger.warn('[Rocom] 洛克.档案：evaluation 接口不可用，已降级为基础档案渲染')
        degraded = true
      }
      if (!cl) {
        logger.warn('[Rocom] 洛克.档案：collection 接口不可用，已降级为基础档案渲染')
        degraded = true
      }
      if (!bo) {
        logger.warn('[Rocom] 洛克.档案：battle-overview 接口不可用，已降级为基础档案渲染')
        degraded = true
      }
      if (degraded) {
        try {
          await session!.send('AI评分接口暂不可用，已降级为基础档案渲染。')
        } catch {
          // Ignore prompt delivery failure and continue rendering the card.
        }
      }

      const radarData = {
        strength: ev.strength || 0,
        collection: ev.collection || 0,
        capture: ev.capture || 0,
        progression: ev.progression || 0,
      }
      const cx = 130
      const cy = 130
      const r = 90
      const dims = [
        { label: '战力', value: radarData.strength, angle: -90 },
        { label: '收藏', value: radarData.collection, angle: 0 },
        { label: '捕捉', value: radarData.capture, angle: 90 },
        { label: '推进', value: radarData.progression, angle: 180 },
      ]
      const toXY = (angle: number, radius: number) => {
        const rad = angle * Math.PI / 180
        return { x: Math.round(cx + radius * Math.cos(rad)), y: Math.round(cy + radius * Math.sin(rad)) }
      }
      const radarPolygons = [1, 0.66, 0.33].map((scale) => {
        const pts = dims.map(dim => toXY(dim.angle, r * scale))
        return pts.map(point => `${point.x},${point.y}`).join(' ')
      })
      const radarAxes = dims.map(dim => toXY(dim.angle, r))
      const radarAreaPoints = dims
        .map(dim => toXY(dim.angle, r * Math.min(dim.value, 100) / 100))
        .map(point => `${point.x},${point.y}`)
        .join(' ')
      const radarAxisLabels = dims.map(dim => {
        const point = toXY(dim.angle, r + 28)
        return { x: point.x, y: point.y, name: dim.label, anchor: 'middle' }
      })
      const radarValueBadges = dims.map(dim => {
        const point = toXY(dim.angle, r + 14)
        return { x: point.x - 20, y: point.y + 8, width: 40, value: dim.value }
      })
      const radarDots = dims.map(dim => toXY(dim.angle, r * Math.min(dim.value, 100) / 100))

      const data = {
        userName: role.name || '洛克',
        userLevel: role.level || 1,
        userUid: role.id || '',
        userAvatarDisplay: role.avatar_url || '',
        enrollDays: role.enroll_days || 0,
        starName: role.star_name || '魔法学徒',
        backgroundUrl: role.background_url || '',
        hasAiProfileData: !!sm.best_pet_name,
        bestPetName: sm.best_pet_name || '',
        summaryTitleParts: String(sm.summary_title || '未 知').split(' '),
        bestPetImageDisplay: sm.best_pet_img_url || '',
        fallbackPetImage: '{{_res_path}}img/roco_icon.png',
        scoreText: ev.score || '0.0',
        aiCommentText: sm.summary_content || '暂无点评',
        centerX: cx,
        centerY: cy,
        radarPolygons,
        radarAxes,
        radarAreaPoints,
        radarAxisLabels,
        radarValueBadges,
        radarDots,
        currentCollectionCount: cl.current_collection_count || 0,
        totalCollectionCount: cl.total_collection_count || 0,
        amazingSpriteCount: cl.amazing_sprite_count || 0,
        shinySpriteCount: cl.shiny_sprite_count || 0,
        colorfulSpriteCount: cl.colorful_sprite_count || 0,
        fashionCollectionCount: cl.fashion_collection_count || 0,
        itemCount: cl.item_count || 0,
        collectionHint: '查看收藏详情',
        hasBattleData: bo.total_match > 0,
        tierBadgeUrl: bo.tier_icon_url || '',
        winRate: `${bo.win_rate || 0}%`,
        totalMatch: bo.total_match || 0,
        matchResult: '',
        leftTeamPets: [],
        rightTeamPets: [],
        opponentName: '',
        opponentAvatarDisplay: '',
        hasExtraProfileData,
        profileSignature,
        showProfileSignature: Boolean(profileSignature),
        profileHeadTags,
        profileHomeItems,
        profileCardItems,
        profileCardImage,
        profileStatusText,
        profileStatusClass: profileStatusText === '是' ? 'online' : 'offline',
        commandHint: '洛克.背包 <筛选> <页码> | 洛克.战绩 <页码> | 洛克 查看菜单',
        copyright: 'AstrBot & WeGame Locke Kingdom Plugin',
      }

      if (recentBattle) {
        data.hasBattleData = true
        data.matchResult = recentBattle.result === 1 ? 'fail' : 'win'
        data.opponentName = recentBattle.enemy_nickname || ''
        data.opponentAvatarDisplay = recentBattle.enemy_avatar_url || ''
        data.leftTeamPets = (recentBattle.pet_base_info || []).map((pet: any) => ({
          icon: pet.pet_img_url?.replace('/image.png', '/icon.png') || '',
        }))
        data.rightTeamPets = (recentBattle.enemy_pet_base_info || []).map((pet: any) => ({
          icon: pet.pet_img_url?.replace('/image.png', '/icon.png') || '',
        }))
      }

      const fallback = `【${role.name}的档案】Lv.${role.level} UID:${role.id}\n评分:${ev.score || '0'} 收藏:${cl.current_collection_count || 0}/${cl.total_collection_count || 0}`
      await sendImage(deps, session, 'personal-card', data, fallback)
    })

  ctx.command('洛克').subcommand('.战绩 [page:number]', '查看对战战绩')
    .alias('洛克战绩')
    .action(async ({ session }, _page = 1) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const userIdentifier = session!.userId!
      const [roleRes, boRes, blRes] = await Promise.all([
        client.getRole(ctx, fwToken, undefined, userIdentifier),
        client.getBattleOverview(ctx, fwToken, userIdentifier),
        client.getBattleList(ctx, fwToken, 4, '', userIdentifier),
      ])

      if (!roleRes?.role) return `获取战绩数据失败：${client.getLastErrorBrief('请稍后重试')}`

      const role = roleRes.role
      const bo = boRes || {}
      const battles = (blRes?.battles || []).map((battle: any) => {
        const result = battle.result === 1 ? 'fail' : 'win'
        const battleTime = battle.battle_time ? new Date(battle.battle_time) : null
        return {
          time: battleTime ? battleTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '?',
          date: battleTime ? battleTime.toLocaleDateString('zh-CN') : '?',
          result,
          leftName: battle.nickname || '',
          leftAvatar: battle.avatar_url || '',
          leftPets: (battle.pet_base_info || []).map((pet: any) => ({
            icon: pet.pet_img_url?.replace('/image.png', '/icon.png') || '',
          })),
          rightName: battle.enemy_nickname || '',
          rightAvatar: battle.enemy_avatar_url || '',
          rightPets: (battle.enemy_pet_base_info || []).map((pet: any) => ({
            icon: pet.pet_img_url?.replace('/image.png', '/icon.png') || '',
          })),
        }
      })

      const data = {
        userAvatarDisplay: role.avatar_url || '',
        userName: role.name,
        userLevel: role.level || 1,
        userUid: role.id || '',
        winRate: `${bo.win_rate || 0}%`,
        totalMatch: bo.total_match || 0,
        battles,
        commandHint: '洛克.战绩 <页码>',
        copyright: 'Koishi & WeGame 洛克王国插件',
      }

      await sendImage(deps, session, 'record', data, `【${role.name}的战绩】胜率:${bo.win_rate || 0}% 场次:${bo.total_match || 0}`)
    })

  ctx.command('洛克').subcommand('.背包 [arg1:string] [arg2:string]', '查看精灵背包')
    .alias('洛克背包')
    .action(async ({ session }, arg1, arg2) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const catMap: Record<string, number> = { '全部': 0, '了不起': 1, '异色': 2, '炫彩': 3 }
      let category = '全部'
      let pageNo = 1
      for (const arg of [arg1, arg2]) {
        if (!arg) continue
        if (/^\d+$/.test(arg)) pageNo = parseInt(arg)
        else if (arg in catMap) category = arg
        else if (arg.replace('精灵', '') in catMap) category = arg.replace('精灵', '')
      }

      const userIdentifier = session!.userId!
      const petSubset = catMap[category] ?? 0
      const [roleRes, petRes] = await Promise.all([
        client.getRole(ctx, fwToken, undefined, userIdentifier),
        client.getPets(ctx, fwToken, petSubset, pageNo, 10, userIdentifier),
      ])

      if (!roleRes?.role) return `获取背包数据失败：${client.getLastErrorBrief('请重新登录后重试')}`
      if (!petRes?.pets) return `获取背包数据失败：${client.getLastErrorBrief('请稍后重试')}`

      const role = roleRes.role
      const data = {
        userName: role.name || '洛克',
        userLevel: role.level || 1,
        userUid: role.id || '',
        userAvatar: role.avatar_url || '',
        pageTitle: `背包 - ${category}精灵`, 
        tabs: [
          { text: '全部精灵', active: category === '全部' },
          { text: '了不起精灵', active: category === '了不起' },
          { text: '异色精灵', active: category === '异色' },
          { text: '炫彩精灵', active: category === '炫彩' },
        ],
        currentTab: `${category}精灵`, 
        totalCount: petRes.total || 0,
        accountLabel: role.name || '',
        pets: (petRes.pets || []).map((pet: any) => ({
          name: pet.pet_name?.split('&')[0] || '?',
          custom_name: pet.pet_name?.includes('&') ? pet.pet_name.split('&')[1] : undefined,
          level: pet.pet_level || 1,
          pet_img_url: pet.pet_img_url || '',
          elementIcons: (pet.pet_types_info || []).map((petType: any) => ({ src: petType.icon || '', name: petType.name || '' })),
          badgeImage: '',
        })),
        emptySlots: [],
        currentPage: pageNo,
        totalPages: Math.max(1, Math.ceil((petRes.total || 0) / 10)),
        pageSize: 10,
        commandHint: '洛克.背包 <全部/异色/了不起/炫彩> <页码>',
        fallbackPetImage: '',
      }

      await sendImage(deps, session, 'package', data, `【背包 - ${category}精灵】共${petRes.total || 0}只`)
    })

  ctx.command('洛克').subcommand('.阵容 [arg1:string] [arg2:string]', '查看阵容推荐')
    .alias('洛克阵容')
    .action(async ({ session }, arg1, arg2) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const userIdentifier = session!.userId!
      let category = ''
      let pageNo = 1
      for (const arg of [arg1, arg2]) {
        if (!arg) continue
        if (/^\d+$/.test(arg)) pageNo = parseInt(arg)
        else category = arg
      }

      const res = await client.getLineupList(ctx, fwToken, pageNo, category, userIdentifier)
      if (!res?.lineups) return `获取阵容数据失败：${client.getLastErrorBrief('请稍后重试')}`

      const data = {
        category: category || '热门推荐',
        lineups: (res.lineups || []).map((lineup: any) => ({
          name: lineup.name || '',
          tags: lineup.tags || [],
          likes: lineup.likes || 0,
          author_name: lineup.author_name || '?',
          author_avatar: lineup.author_avatar || '',
          lineup_code: String(lineup.id || ''),
          pets: (lineup.lineup?.pets || []).map((pet: any) => ({
            pet_name: pet.pet_name || '',
            pet_img_url: pet.pet_img_url || '',
            skills_info: (pet.skills_info || []).map((skill: any) => ({ skill_img_url: skill.skill_img_url || '' })),
          })),
        })),
        page_no: res.page_no || pageNo,
        total_pages: res.total_pages || 1,
        fallbackPetImage: '',
        commandHint: '洛克.阵容 <分类> <页码>',
      }

      await sendImage(deps, session, 'lineup', data, `【阵容推荐】${category || '热门'} 第${pageNo}页`)
    })

  ctx.command('查看阵容 <lineupId:string>', '查看阵容详情')
    .action(async ({ session }, lineupId) => {
      const normalizedLineupId = normalizeLineupLookupId(lineupId)
      if (!normalizedLineupId) return '请提供有效的阵容码。用法：查看阵容 <阵容码>'

      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const userIdentifier = session!.userId!
      const firstPageRes = await client.getLineupList(ctx, fwToken, 1, '', userIdentifier)
      if (!firstPageRes?.lineups) return `获取阵容数据失败：${client.getLastErrorBrief('请稍后重试')}`

      let targetLineup = (firstPageRes.lineups || []).find((lineup: any) => isTargetLineup(lineup, normalizedLineupId))

      if (!targetLineup) {
        const totalPages = Math.max(1, Number(firstPageRes.total_pages) || 1)
        const maxSearchPage = Math.min(totalPages, 10)
        for (let page = 2; page <= maxSearchPage; page++) {
          const pageRes = await client.getLineupList(ctx, fwToken, page, '', userIdentifier)
          const lineups = pageRes?.lineups || []
          targetLineup = lineups.find((lineup: any) => isTargetLineup(lineup, normalizedLineupId))
          if (targetLineup) break
        }
      }

      if (!targetLineup) return `未找到阵容码为 ${normalizedLineupId} 的阵容。`

      const lineupData = targetLineup.lineup || {}
      const processedPets = (lineupData.pets || []).map((pet: any) => ({
        pet_name: pet.pet_name || '',
        pet_img_url: pet.pet_img_url || '',
        skills: (pet.skills_info || []).map((skill: any) => skill.skill_img_url || '').filter(Boolean),
        bloodline: Boolean(pet.bloodline_info),
        bloodline_icon: pet.bloodline_info?.icon || '',
      }))

      const data = {
        lineup: {
          name: targetLineup.name || '',
          tags: targetLineup.tags || [],
          pets: processedPets,
          author_name: targetLineup.author_name || '',
          author_avatar: targetLineup.author_avatar || '',
          likes: targetLineup.likes || 0,
          lineup_code: normalizedLineupId,
        },
        fallbackPetImage: '{{_res_path}}img/roco_icon.png',
      }

      const fallback = `【阵容详情】${targetLineup.name || '未知阵容'} | 阵容码: ${normalizedLineupId}`
      await sendImage(deps, session, 'lineup-detail', data, fallback)
    })

  ctx.command('洛克').subcommand('.交换大厅 [page:number]', '查看交换大厅')
    .alias('洛克交换大厅')
    .action(async ({ session }, page = 1) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()

      const userIdentifier = session!.userId!
      const res = await client.getExchangePosters(ctx, fwToken, page, userIdentifier)
      if (!res?.posters) return `获取交换大厅数据失败：${client.getLastErrorBrief('请稍后重试')}`

      const data = {
        filterLabel: '全部',
        posts: (res.posters || []).map((poster: any) => {
          const user = poster.user_info || {}
          const provideItems = parseExchangeItems(
            poster.offer_items ?? poster.offer_item_names ?? poster.offerItems ?? [],
          )
          return {
            userName: user.nickname || '?',
            userLevel: user.level || 0,
            isOnline: user.online_status === 1,
            avatarUrl: user.avatar_url || '',
            userId: user.role_id || '',
            wantText: parseExchangeWantText(
              poster.want_item_name ?? poster.want_item ?? poster.wantText ?? '交友',
            ),
            wantBadgeUrl: '',
            isExpired: false,
            provideItems: provideItems.length > 0 ? provideItems : ['暂无'],
            timeLabel: poster.create_time
              ? new Date(Number(poster.create_time) * 1000).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              : '?',
          }
        }),
        currentPage: page,
        totalPages: res.total_pages || 1,
        commandHint: '洛克.交换大厅 <页码>',
      }

      await sendImage(deps, session, 'exchange-hall', data, `【交换大厅】第${page}页`)
    })

  ctx.command('洛克').subcommand('.玩家 <uid:string>', '通过 ingame 接口查询玩家基础资料')
    .alias('洛克玩家')
    .action(async ({ session }, uid) => {
      if (!uid) return '请提供玩家 UID。用法：洛克.玩家 <UID>'
      const res = await client.ingamePlayerSearch(ctx, uid)
      if (!res) return `玩家搜索失败：${client.getLastErrorBrief()}`
      await sendImage(deps, session, 'player-search', buildPlayerSearchRenderData(res, uid), `【洛克玩家】UID ${uid}`)
    })

  ctx.command('洛克').subcommand('.家园 [uid:string]', '通过 UID 查询家园菜园、守卫和室内精灵')
    .alias('洛克家园')
    .action(async ({ session }, uid = '') => {
      let targetUid = String(uid || '').trim()
      if (!targetUid) {
        const binding = deps.userMgr.getPrimaryBinding(session!.userId!)
        targetUid = String(binding?.role_id || '')
      }
      if (!targetUid) return '请提供玩家 UID，或先完成绑定后使用 洛克.家园。'
      const res = await client.ingameHomeInfo(ctx, targetUid)
      if (!res) return `家园查询失败：${client.getLastErrorBrief()}`
      await sendImage(deps, session, 'home', buildHomeRenderData(deps, res, targetUid), `【洛克家园】UID ${targetUid}`)
    })

  ctx.command('洛克').subcommand('.刷新面板 [uid:string]', '刷新指定 UID 的精灵面板缓存')
    .alias('洛克刷新面板')
    .alias('刷新面板')
    .alias('刷新精灵')
    .alias('强制刷新')
    .action(async ({ session }, uid = '') => {
      const targetUid = panelUidFromBinding(deps, session, uid)
      if (!targetUid) return '请提供 UID，或先绑定账号后再使用 洛克.刷新面板。'
      if (!/^\d+$/.test(targetUid)) return '请输入正确的 UID 格式。'

      const record = await refreshPanelPets(deps, targetUid, session?.userId || '')
      if (!record) return panelRefreshErrorHint(client)

      const updatedAtText = formatPanelUpdatedAt(record.updatedAt)
      const data = panelPetListData(targetUid, record.pets, updatedAtText)
      const fallback = panelPetListFallback(targetUid, record.pets, updatedAtText)
      await sendImage(deps, session, 'pet-panel', data, fallback)
    })

  ctx.command('洛克').subcommand('.精灵面板 [query:text] [uid:string]', '查询精灵面板详情（按名称或GID），不填参数则显示精灵列表')
    .alias('洛克精灵面板')
    .alias('精灵面板')
    .alias('面板')
    .alias('查询精灵面板')
    .alias('查看面板')
    .action(async ({ session }, query, uid = '') => {
      const queryText = String(query || '').trim()

      const targetUid = panelUidFromBinding(deps, session, uid)
      if (!targetUid) return '请提供 UID，或先绑定账号后再使用 洛克.精灵面板。'
      if (!/^\d+$/.test(targetUid)) return '请输入正确的 UID 格式。'

      const { record } = await resolvePanelPets(deps, targetUid, session?.userId || '', false)
      if (!record) return panelRefreshErrorHint(client)
      if (!record.pets.length) return `UID ${targetUid} 当前没有可用精灵数据，请先执行 洛克.刷新面板。`

      if (!queryText) {
        const updatedAtText = formatPanelUpdatedAt(record.updatedAt)
        const data = panelPetListData(targetUid, record.pets, updatedAtText)
        const fallback = panelPetListFallback(targetUid, record.pets, updatedAtText)
        await sendImage(deps, session, 'pet-panel', data, fallback)
        return
      }

      const matched = findPanelPets(record.pets, queryText)
      if (!matched.length) {
        return [
          `未在 UID ${targetUid} 的面板缓存中找到「${queryText}」。`,
          '可先执行：洛克.刷新面板 [UID]',
          '或尝试更精确名称 / GID。',
        ].join('\n')
      }

      let selected: PanelPetItem | null = null
      if (matched.length === 1) {
        selected = matched[0]
      } else {
        const optionLines = matched.slice(0, 20).map((pet, index) =>
          `${index + 1}. ${pet.name} (GID:${pet.gid}) Lv.${pet.level} ${pet.mutationLabel}`,
        )
        await session?.send?.([
          `检测到 ${matched.length} 个候选，请在 60 秒内回复序号选择：`,
          ...optionLines,
          '超时将默认选择第 1 个。',
        ].join('\n'))
        try {
          const input = await session?.prompt?.(60 * 1000)
          const choice = Number(String(input || '').trim())
          if (Number.isFinite(choice) && choice >= 1 && choice <= Math.min(matched.length, 20)) {
            selected = matched[choice - 1]
          }
        } catch {
          // Ignore prompt failures and fall back to default choice.
        }
        if (!selected) selected = matched[0]
      }

      const updatedAtText = formatPanelUpdatedAt(record.updatedAt)
      const data = panelPetDetailData(targetUid, selected, updatedAtText)
      const fallback = panelPetDetailFallback(targetUid, selected, updatedAtText)
      await sendImage(deps, session, 'pet-panel-detail', data, fallback)
    })

  ctx.command('洛克').subcommand('.商店 <shopId:string>', '通过 ingame 接口查询商店信息')
    .alias('洛克商店')
    .action(async ({ session }, shopId) => {
      if (!shopId) return '请提供商店 ID。用法：洛克.商店 <shop_id>'
      const res = await client.ingameMerchantInfo(ctx, shopId)
      if (!res) return `商店查询失败：${client.getLastErrorBrief()}`
      await sendImage(deps, session, 'ingame-shop', buildShopRenderData(res, shopId), `【洛克商店】shop_id=${shopId}`)
    })

  ctx.command('洛克').subcommand('.好友关系 <userIds:string>', '查询好友关系')
    .alias('洛克好友关系')
    .action(async ({ session }, userIds) => {
      if (!userIds) return '请提供要查询的用户 ID 列表。用法：洛克.好友关系 <id1,id2>'
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()
      const res = await client.getFriendship(ctx, fwToken, userIds, session!.userId!)
      if (!res) return `好友关系查询失败：${client.getLastErrorBrief()}`
      await sendImage(deps, session, 'friendship', buildFriendshipRenderData(res, userIds), `【好友关系】${userIds}`)
    })

  ctx.command('洛克').subcommand('.学生 [area:number] [accountType:number]', '查询学生认证状态与学生活动福利')
    .alias('洛克学生')
    .action(async ({ session }, area = 101, accountType = 0) => {
      const fwToken = await getPrimaryToken(deps, session!.userId!)
      if (!fwToken) return notLoggedInHint()
      const userIdentifier = session!.userId!
      const [stateRes, perksRes] = await Promise.all([
        client.getStudentState(ctx, fwToken, accountType, userIdentifier),
        client.getStudentPerks(ctx, fwToken, area, accountType, userIdentifier),
      ])
      if (!stateRes) return `学生认证状态查询失败：${client.getLastErrorBrief()}`
      if (!perksRes) return `学生活动福利查询失败：${client.getLastErrorBrief()}`
      await sendImage(deps, session, 'student', buildStudentRenderData(stateRes, perksRes, area, accountType), '【洛克学生】认证与福利信息')
    })

  ctx.command('订阅家园菜园 [uid:string]', '订阅指定 UID 的家园菜园成熟提醒')
    .action(async ({ session }, uid = '') => subscribeHome(deps, session, uid, 'garden'))

  ctx.command('订阅家园灵感 [uid:string]', '订阅指定 UID 的家园精灵灵感完成提醒')
    .action(async ({ session }, uid = '') => subscribeHome(deps, session, uid, 'inspiration'))

  ctx.command('取消订阅家园 [kind:string] [uid:string]', '取消当前会话的家园订阅')
    .action(async ({ session }, kind = '全部', uid = '') => {
      const target = sessionTarget(session)
      if (!target.userId && !isBotAdmin(session, deps.config.adminUserIds)) return '此指令仅限管理员使用。'
      const kindMap: Record<string, string> = { '菜园': 'garden', '灵感': 'inspiration', '全部': '', all: '', garden: 'garden', inspiration: 'inspiration' }
      const deleted = deps.homeSubMgr.deleteMatching(target, kindMap[String(kind || '全部')] ?? '', String(uid || '').trim())
      return deleted ? `已取消 ${deleted} 条家园订阅。` : '当前会话没有匹配的家园订阅。'
    })

  ctx.command('洛克').subcommand('.调试家园订阅', '立即执行一次家园订阅检查')
    .alias('洛克调试家园订阅')
    .action(async ({ session }) => {
      if (!isBotAdmin(session, deps.config.adminUserIds)) return '此指令仅限管理员使用。'
      const result = await checkHomeSubscriptions(deps)
      return `家园订阅检查完成：订阅 ${result.subscriptions} 条，检查 ${result.checked} 条，推送 ${result.pushed} 档提醒。`
    })

  if (deps.config.homeSubscriptionEnabled) {
    ctx.setInterval(() => checkHomeSubscriptions(deps).catch(err => logger.warn(`家园订阅检查失败: ${err}`)), Math.max(1, deps.config.homeSubscriptionIntervalMinutes || 5) * 60000)
  }
}
