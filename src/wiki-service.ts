import { Context, Logger } from 'koishi'
import { RocomClient } from './client'
import {
  WikiCatalog,
  WIKI_CATALOG_ROUTES_BY_KEY,
  WIKI_CATALOG_ROUTES_BY_ALIAS,
  wikiGlobalCatalogPriority,
  wikiLabelForKey,
  wikiSectionTitle,
} from './wiki-catalog'

const logger = new Logger('rocom-wiki')

const COPYRIGHT = 'Koishi & WeGame 洛克王国插件'

// ===== 纯文本工具（可独立测试）=====

export function normalizeQueryText(text: any): string {
  return String(text ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

export function wikiNamedValue(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.name || value.label || value.value || '')
  }
  return String(value ?? '')
}

export function wikiNames(values: any): string[] {
  if (!values) return []
  const list = Array.isArray(values) ? values : [values]
  const result: string[] = []
  for (const value of list) {
    const text = wikiNamedValue(value).trim()
    if (text) result.push(text)
  }
  return result
}

export function wikiRangeLabel(data: any, keyMin: string, keyMax: string, unit: string): string {
  if (!data || typeof data !== 'object') return '暂无'
  const low = data[keyMin]
  const high = data[keyMax]
  const empty = (v: any) => v === undefined || v === null || v === ''
  if (empty(low) && empty(high)) return '暂无'
  if (empty(low)) return `${high}${unit}`
  if (empty(high) || low === high) return `${low}${unit}`
  return `${low}-${high}${unit}`
}

// 与上游 SequenceMatcher.ratio 近似：基于编辑距离的相似度。
export function similarityRatio(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const lenA = a.length
  const lenB = b.length
  const dp: number[] = Array.from({ length: lenB + 1 }, (_, j) => j)
  for (let i = 1; i <= lenA; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= lenB; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1
      prev = temp
    }
  }
  return 1 - dp[lenB] / Math.max(lenA, lenB)
}

export function wikiSimilarityScore(query: string, item: any): number {
  const normalizedQuery = normalizeQueryText(query)
  if (!normalizedQuery) return 0
  const candidates = [
    wikiTitleForItem(item, ''),
    item?.name || '',
    item?.summary || '',
    item?.description || item?.desc || '',
  ]
  let best = 0
  for (const text of candidates) {
    const normalizedText = normalizeQueryText(text)
    if (!normalizedText) continue
    if (normalizedQuery === normalizedText) best = Math.max(best, 1)
    else if (normalizedText.includes(normalizedQuery) || normalizedQuery.includes(normalizedText)) best = Math.max(best, 0.82)
    else best = Math.max(best, similarityRatio(normalizedQuery, normalizedText))
  }
  return best
}

export function wikiGenericValue(value: any, depth = 0): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const texts = value.slice(0, 6).map(item => wikiGenericValue(item, depth + 1)).filter(Boolean)
    const suffix = value.length > 6 ? ' ...' : ''
    return texts.join('、') + suffix
  }
  if (typeof value === 'object') {
    for (const key of ['name', 'label', 'title', 'summary', 'description', 'text']) {
      const text = String(value[key] || '').trim()
      if (text) return text
    }
    if ('min_m' in value || 'max_m' in value) return wikiRangeLabel(value, 'min_m', 'max_m', 'm')
    if ('min_kg' in value || 'max_kg' in value) return wikiRangeLabel(value, 'min_kg', 'max_kg', 'kg')
    if (depth >= 1) {
      const pairs: string[] = []
      for (const [key, item] of Object.entries(value).slice(0, 4)) {
        const text = wikiGenericValue(item, depth + 1)
        if (text) pairs.push(`${wikiLabelForKey(key)}：${text}`)
      }
      return pairs.join('；')
    }
    return ''
  }
  return String(value)
}

function wikiSizeLabel(value: any): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return wikiGenericValue(value)
  const parts: string[] = []
  if (value.height && typeof value.height === 'object') {
    const text = wikiRangeLabel(value.height, 'min_m', 'max_m', 'm')
    if (text && text !== '暂无') parts.push(`高 ${text}`)
  }
  if (value.weight && typeof value.weight === 'object') {
    const text = wikiRangeLabel(value.weight, 'min_kg', 'max_kg', 'kg')
    if (text && text !== '暂无') parts.push(`重 ${text}`)
  }
  return parts.join(' / ')
}

function wikiFootprintLabel(value: any): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return wikiGenericValue(value)
  const width = value.width ?? value.x ?? value.cols
  const height = value.height ?? value.y ?? value.rows
  if (width !== undefined && width !== null && width !== '' && height !== undefined && height !== null && height !== '') {
    return `${width} x ${height}`
  }
  return wikiGenericValue(value, 1)
}

function wikiCountLabel(value: any, unit = '个'): string {
  if (Array.isArray(value)) return `${value.length}${unit}`
  if (value === undefined || value === null || value === '') return ''
  return typeof value === 'number' ? `${value}${unit}` : String(value)
}

export function wikiPickImage(item: any): string {
  const imageKeys = [
    'big_icon', 'image', 'cover_image', 'preview_image', 'checkout_icon',
    'icon', 'small_icon', 'background_image', 'display_image', 'package_bg', 'package_cover',
  ]
  for (const key of imageKeys) {
    const value = item?.[key]
    if (typeof value === 'string' && /^(https?:\/\/|\{\{)/.test(value)) return value
    if (value && typeof value === 'object') {
      const url = value.url || value.image || value.icon
      if (typeof url === 'string' && /^(https?:\/\/|\{\{)/.test(url)) return url
    }
  }
  return ''
}

export function wikiTitleForItem(item: any, fallback = 'Wiki 条目'): string {
  for (const key of ['name', 'title', 'display_name', 'summary', 'description']) {
    const value = String(item?.[key] || '').trim()
    if (value) return value.slice(0, 48)
  }
  for (const key of [
    'pet_id', 'skill_id', 'item_id', 'egg_conf_id', 'random_egg_id', 'tree_id', 'medal_id',
    'ball_id', 'plant_id', 'furniture_id', 'suit_id', 'region_id', 'dungeon_id', 'mail_id',
    'music_id', 'task_id', 'shop_id', 'exchange_id', 'id',
  ]) {
    const value = item?.[key]
    if (value !== undefined && value !== null && value !== '') return `${fallback} #${value}`
  }
  return fallback
}

function wikiSummaryForItem(item: any): string {
  for (const key of ['summary', 'description', 'desc', 'effect', 'flavor_text', 'text', 'content']) {
    const value = wikiGenericValue(item?.[key])
    if (value) return value.slice(0, 180)
  }
  return ''
}

function wikiBadgesForItem(item: any): string[] {
  const badges: string[] = []
  for (const key of ['type', 'skill_type', 'damage_type', 'element_type', 'category', 'quality', 'rarity', 'label_type', 'egg_type', 'grade', 'gender']) {
    const value = wikiGenericValue(item?.[key])
    if (value) badges.push(value)
  }
  for (const badge of item?.badges || []) {
    const value = wikiGenericValue(badge)
    if (value) badges.push(value)
  }
  for (const key of ['type_names', 'egg_group_names', 'tags', 'source_counts']) {
    badges.push(...wikiNames(item?.[key]).slice(0, 4))
  }
  const output: string[] = []
  const seen = new Set<string>()
  for (const badge of badges) {
    const key = String(badge)
    if (key && !seen.has(key)) {
      output.push(key)
      seen.add(key)
    }
  }
  return output.slice(0, 8)
}

function wikiAddFact(rows: Array<{ label: string, value: string }>, label: string, value: any) {
  const text = wikiGenericValue(value)
  if (text) rows.push({ label, value: text.slice(0, 96) })
}

export function wikiMetaForItem(item: any, limit = 12, catalogKey = ''): Array<{ label: string, value: string }> {
  const rows: Array<{ label: string, value: string }> = []
  if (catalogKey === 'pets') {
    wikiAddFact(rows, '图鉴编号', item?.handbook_no)
    wikiAddFact(rows, '精灵ID', item?.pet_id)
    wikiAddFact(rows, '属性', item?.type_names || item?.types)
    wikiAddFact(rows, '蛋组', item?.egg_group_names || item?.egg_groups)
  } else if (catalogKey === 'skills') {
    wikiAddFact(rows, '技能ID', item?.skill_id)
    wikiAddFact(rows, '属性', item?.element_type || item?.type)
    wikiAddFact(rows, '类型', item?.skill_type || item?.damage_type)
    wikiAddFact(rows, '威力 / 能量', `${item?.power ?? '-'} / ${item?.cost ?? '-'}`)
    wikiAddFact(rows, '可用精灵', item?.pet_count)
  } else if (['pet-eggs', 'egg-items', 'random-eggs', 'pet-egg'].includes(catalogKey)) {
    wikiAddFact(rows, '蛋ID', item?.egg_conf_id || item?.random_egg_id || item?.item_id)
    wikiAddFact(rows, '蛋类型', item?.egg_type)
    wikiAddFact(rows, '孵化时间', item?.hatch_label)
    wikiAddFact(rows, '尺寸', wikiSizeLabel(item?.egg_size))
    wikiAddFact(rows, '关联精灵', item?.pet)
  } else if (['pet-foods', 'pet-gifts'].includes(catalogKey)) {
    wikiAddFact(rows, '物品ID', item?.item_id)
    wikiAddFact(rows, '亲密经验', item?.food_close_exp || item?.close_exp)
    wikiAddFact(rows, '家园经验', item?.home_exp_num)
    wikiAddFact(rows, '制作时间', item?.need_time_label)
    wikiAddFact(rows, '交互次数', item?.interaction_count)
  } else if (catalogKey === 'home-egg-lay-rates') {
    wikiAddFact(rows, '巢穴数', item?.nest_num)
    wikiAddFact(rows, '产蛋巢', item?.egg_laying_nest_num)
    const rate = item?.pet_lay_egg_rate_percent
    wikiAddFact(rows, '产蛋概率', rate !== undefined && rate !== null && rate !== '' ? `${rate}%` : '')
  } else if (catalogKey === 'pet-levels') {
    wikiAddFact(rows, '等级', item?.level)
    wikiAddFact(rows, '累计经验', item?.total_exp)
    wikiAddFact(rows, '下级所需', item?.next_level_exp)
  } else if (catalogKey === 'furniture') {
    wikiAddFact(rows, '家具ID', item?.furniture_id)
    wikiAddFact(rows, '分类', item?.category)
    wikiAddFact(rows, '舒适度', item?.comfort)
    wikiAddFact(rows, '占地', wikiFootprintLabel(item?.footprint))
  } else if (catalogKey === 'fashion') {
    wikiAddFact(rows, '套装ID', item?.suit_id)
    wikiAddFact(rows, '性别', item?.gender)
    wikiAddFact(rows, '品级', item?.grade)
    wikiAddFact(rows, '部件', wikiCountLabel(item?.parts))
  } else if (catalogKey === 'exchanges') {
    wikiAddFact(rows, '兑换ID', item?.exchange_id)
    wikiAddFact(rows, '获得', item?.get_items)
    wikiAddFact(rows, '消耗', item?.cost_items)
  } else if (catalogKey === 'shops') {
    wikiAddFact(rows, '商店ID', item?.shop_id)
    wikiAddFact(rows, '页签', item?.tab_name)
    wikiAddFact(rows, '商品数', wikiCountLabel(item?.goods))
  } else if (['skill-stones', 'skill-stone-recipes', 'items', 'pet-fruits', 'recipes', 'balls', 'plants', 'pet-carryons', 'medals'].includes(catalogKey)) {
    wikiAddFact(rows, '物品ID', item?.item_id || item?.medal_id || item?.ball_id || item?.plant_id || item?.carryon_id)
    wikiAddFact(rows, '类型', item?.type || item?.label_type)
    wikiAddFact(rows, '品质', item?.quality)
    wikiAddFact(rows, '效果', item?.summary || item?.catch_effect || item?.carryon)
  } else {
    for (const key of [
      'pet_id', 'skill_id', 'item_id', 'tree_id', 'level', 'close_level', 'action_label',
      'region_id', 'dungeon_id', 'mail_id', 'music_id', 'emoji_id', 'task_id', 'summary_id',
      'asset_type', 'asset_id', 'action_type', 'action_id', 'quality', 'type', 'category',
    ]) {
      if (item && key in item) wikiAddFact(rows, wikiLabelForKey(key), item[key])
    }
  }
  if (rows.length) return rows.slice(0, limit)

  const skip = new Set([
    'name', 'title', 'description', 'desc', 'summary', 'icon', 'small_icon', 'big_icon',
    'image', 'cover_image', 'preview_image', 'background_image', 'items', 'rewards',
    'reward_items', 'tags', 'badges', 'catalog',
  ])
  for (const [key, value] of Object.entries(item || {})) {
    if (skip.has(key)) continue
    const text = wikiGenericValue(value)
    if (!text) continue
    rows.push({ label: wikiLabelForKey(key), value: text.slice(0, 80) })
    if (rows.length >= limit) break
  }
  return rows
}

export function wikiCardForItem(item: any, fallback: string, catalog?: WikiCatalog | null) {
  const catalogKey = String(catalog?.key || '')
  return {
    title: wikiTitleForItem(item, fallback),
    image: wikiPickImage(item),
    summary: wikiSummaryForItem(item),
    badges: wikiBadgesForItem(item),
    meta: wikiMetaForItem(item, 5, catalogKey),
  }
}

function wikiRowsFromDict(value: Record<string, any>, limit = 16): Array<{ label: string, value: string }> {
  const rows: Array<{ label: string, value: string }> = []
  for (const [key, item] of Object.entries(value)) {
    if (['icon', 'small_icon', 'big_icon', 'image', 'display_image'].includes(key)) continue
    const text = wikiGenericValue(item)
    if (text) rows.push({ label: wikiLabelForKey(key), value: text.slice(0, 120) })
    if (rows.length >= limit) break
  }
  return rows
}

export function wikiSectionsForPayload(payload: any, catalog?: WikiCatalog | null): any[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const sections: any[] = []

  const addList = (title: string, value: any) => {
    if (!Array.isArray(value) || !value.length) return
    const dictItems = value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
    if (dictItems.length) {
      sections.push({
        title,
        cards: dictItems.slice(0, 12).map(item => wikiCardForItem(item, title, catalog)),
        rows: [],
        total: dictItems.length,
      })
      return
    }
    const texts = value.slice(0, 16).map(item => wikiGenericValue(item)).filter(Boolean)
    if (!texts.length) return
    sections.push({
      title,
      cards: [],
      rows: texts.map((text, idx) => ({ label: String(idx + 1), value: text })),
      total: texts.length,
    })
  }

  for (const [key, value] of Object.entries(payload)) {
    const title = wikiSectionTitle(key)
    if (value && typeof value === 'object' && !Array.isArray(value)
      && ['probabilities', 'npc_reactions', 'catch_effect', 'carryon', 'planting', 'limit', 'bond', 'mall_package'].includes(key)) {
      const rows = wikiRowsFromDict(value as Record<string, any>)
      if (rows.length) sections.push({ title, cards: [], rows, total: rows.length })
      continue
    }
    addList(title, value)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subkey, subvalue] of Object.entries(value)) {
        addList(`${title} / ${wikiSectionTitle(subkey)}`, subvalue)
      }
    }
  }
  return sections.slice(0, 8)
}

export function findExactWikiMatch(results: any[], query: string): any | null {
  const normalizedQuery = normalizeQueryText(query)
  if (!normalizedQuery) return null
  for (const item of results) {
    const name = String(item?.name || '')
    const form = String(item?.form || '')
    const candidates = [
      normalizeQueryText(name),
      normalizeQueryText(`${name}${form}`),
      normalizeQueryText(`${name} ${form}`),
      normalizeQueryText(`${form}${name}`),
    ]
    if (candidates.includes(normalizedQuery)) return item
  }
  return null
}

export function wikiCandidateText(query: string, items: any[], kind: string): string {
  const lines = [`找到多个${kind}候选，请使用更精确名称：`]
  items.slice(0, 10).forEach((item, idx) => {
    const name = item?.name || '未知'
    const form = item?.form || ''
    const itemId = item?.pet_id || item?.skill_id || item?.id || '-'
    const suffix = form && form !== '普通' ? `（${form}）` : ''
    lines.push(`${idx + 1}. ${name}${suffix} #${itemId}`)
  })
  lines.push(`\n你查询的是：${query}`)
  return lines.join('\n')
}

function wikiBodySize(...sources: any[]): { height: string, weight: string } {
  let bodySize: any = {}
  for (const source of sources) {
    if (source && typeof source === 'object' && source.body_size && typeof source.body_size === 'object') {
      bodySize = source.body_size
      break
    }
  }
  return {
    height: wikiRangeLabel(bodySize?.height, 'min_m', 'max_m', 'm'),
    weight: wikiRangeLabel(bodySize?.weight, 'min_kg', 'max_kg', 'kg'),
  }
}

function wikiGenderLabel(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts: string[] = []
    if (value.male_percent !== undefined && value.male_percent !== null && value.male_percent !== '') parts.push(`雄 ${value.male_percent}%`)
    if (value.female_percent !== undefined && value.female_percent !== null && value.female_percent !== '') parts.push(`雌 ${value.female_percent}%`)
    return parts.length ? parts.join(' / ') : '暂无'
  }
  return String(value || '暂无')
}

function wikiEcologyLabel(value: any, fallback: any = ''): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts: string[] = []
    for (const key of ['pet_text', 'pet_style']) {
      const text = String(value[key] || '').trim()
      if (text) parts.push(text)
    }
    const habitats = wikiNames(value.habitats)
    if (habitats.length) parts.push('栖息：' + habitats.join(' / '))
    return parts.join('；')
  }
  return String(value || fallback || '').trim()
}

function wikiSourceLabel(source: any, fallback: any = ''): string {
  const mapping: Record<string, string> = { level: '升级', machine: '技能石', blood: '血脉', field: '特殊来源' }
  const text = String(source || '').trim()
  return String(fallback || mapping[text] || text || '')
}

function wikiTypeEffectiveness(profile: any): Array<{ label: string, value: string }> {
  const data = profile?.type_effectiveness
  if (!data || typeof data !== 'object') return []
  const rows: Array<{ label: string, value: string }> = []
  const definitions: Array<[string, [string, string]]> = [
    ['攻击克制', ['attack', 'strong']],
    ['攻击弱效', ['attack', 'weak']],
    ['防御弱点', ['defense', 'weak']],
    ['防御抵抗', ['defense', 'resist']],
  ]
  for (const [label, [groupKey, itemKey]] of definitions) {
    const group = data[groupKey] && typeof data[groupKey] === 'object' ? data[groupKey] : {}
    const names = wikiNames(group?.[itemKey])
    if (names.length) rows.push({ label, value: names.join(' / ') })
  }
  return rows
}

function buildPetStats(profile: any) {
  const attrs = profile?.attributes && typeof profile.attributes === 'object' ? profile.attributes : {}
  const defs: Array<[string, string, string]> = [
    ['精力', 'hp', '#42b883'],
    ['物攻', 'physical_attack', '#e86452'],
    ['魔攻', 'magic_attack', '#5987f5'],
    ['物防', 'physical_defense', '#d69a32'],
    ['魔防', 'magic_defense', '#25a6a6'],
    ['速度', 'speed', '#8d62d9'],
  ]
  return defs.map(([label, key, color]) => {
    const value = Number(attrs[key]) || 0
    return { label, value, color, percent: Math.min(value / 160 * 100, 100) }
  })
}

function buildPetSkillGroups(skillsData: any) {
  const groups: any[] = []
  const sourceDefs: Array<[string, string]> = [
    ['level', '升级习得'],
    ['machine', '技能机'],
    ['blood', '血脉技能'],
    ['field', '场景习得'],
  ]
  for (const [key, label] of sourceDefs) {
    const rawItems = Array.isArray(skillsData?.[key]) ? skillsData[key] : []
    const items = rawItems.slice(0, 10).map((skill: any) => ({
      name: skill?.name || '未知技能',
      icon: skill?.icon || '',
      level: skill?.level || skill?.source_label || '',
      type: wikiNamedValue(skill?.element_type || skill?.type) || '未知',
      category: wikiNamedValue(skill?.skill_type) || wikiNamedValue(skill?.damage_type) || '未知',
      cost: skill?.cost ?? '?',
      power: skill?.power ?? '?',
      desc: skill?.desc || skill?.description || skill?.flavor_text || '暂无说明',
    }))
    if (items.length) groups.push({ label, items })
  }
  return groups
}

function buildPetFamily(familyData: any, currentId: any) {
  let items: any[] = []
  if (familyData && typeof familyData === 'object' && !Array.isArray(familyData)) {
    if (Array.isArray(familyData.members)) items.push(...familyData.members)
    for (const formGroup of familyData.forms || []) {
      for (const member of formGroup?.members || []) {
        const merged = { ...member }
        if (formGroup?.name && !merged.form_group) merged.form_group = formGroup.name
        items.push(merged)
      }
    }
    if (!items.length) {
      for (const key of ['items', 'family', 'evolutions']) {
        if (Array.isArray(familyData[key])) {
          items.push(...familyData[key])
          break
        }
      }
    }
  } else if (Array.isArray(familyData)) {
    items = familyData
  }
  const result: any[] = []
  const seen = new Set<string>()
  for (const item of items.slice(0, 12)) {
    const petId = item?.pet_id ?? item?.id
    const key = String(petId ?? item?.name ?? '')
    if (key && seen.has(key)) continue
    seen.add(key)
    const conditionTexts = Array.isArray(item?.condition_texts) ? item.condition_texts : []
    result.push({
      pet_id: petId ?? '-',
      name: item?.name || '未知精灵',
      form: item?.form || item?.form_group || '',
      icon: item?.icon || item?.small_icon || '',
      condition: item?.condition_summary
        || conditionTexts.filter(Boolean).join(' / ')
        || item?.evolution_description
        || item?.condition
        || item?.evolve_condition
        || item?.relation
        || '',
      is_current: String(petId ?? '') === String(currentId ?? ''),
    })
  }
  return result
}

function buildHandbookTopics(handbookData: any) {
  const topics = Array.isArray(handbookData?.topics) ? handbookData.topics : []
  const result: any[] = []
  for (const item of topics.slice(0, 8)) {
    const rewards: any[] = []
    let rewardItems = item?.rewards || item?.reward_items
    if (!rewardItems && item?.reward && typeof item.reward === 'object') rewardItems = item.reward.items
    for (const reward of rewardItems || []) {
      rewards.push({
        name: reward?.name || '奖励',
        count: reward?.count || '',
        icon: reward?.icon || '',
      })
    }
    result.push({
      name: item?.name || item?.title || `课题 ${item?.topic_id || ''}`.trim(),
      desc: item?.description || item?.desc || '',
      rewards: rewards.slice(0, 4),
    })
  }
  return result
}

export function buildWikiPetRenderData(
  overview: any,
  profile: any,
  skills: any,
  family: any,
  handbook: any,
  query: string,
) {
  profile = profile || {}
  skills = skills || {}
  family = family || {}
  handbook = handbook || {}
  const petId = overview?.pet_id ?? profile?.pet_id
  const typeNames = wikiNames(overview?.type_names || overview?.types)
  const eggGroups = wikiNames(overview?.egg_group_names || overview?.egg_groups)
  const feature = overview?.feature || {}
  const bodySize = wikiBodySize(profile, overview)
  const stats = buildPetStats(profile)
  const totalStats = profile?.attributes?.sum || stats.reduce((sum, item) => sum + item.value, 0)
  const form = overview?.form || profile?.form || ''
  const classis = wikiNamedValue(overview?.classis) || '暂无'
  const habitats = wikiNames(profile?.habitats)
  const areas = wikiNames(handbook?.areas)
  return {
    name: overview?.name || profile?.name || query,
    query,
    pet_id: petId ?? '-',
    number: overview?.handbook_no || profile?.handbook_no || '---',
    form,
    formLine: `${form || '普通'}${classis && classis !== '暂无' ? ` · ${classis}` : ''}`,
    quality: overview?.quality || profile?.quality || '',
    stage: overview?.stage || profile?.stage || '',
    pet_icon: overview?.icon || overview?.small_icon || '',
    main_image: profile?.small_icon || overview?.small_icon || profile?.icon || overview?.icon || '',
    type_names: typeNames,
    egg_groups: eggGroups,
    description: profile?.description || overview?.description || '暂无图鉴描述',
    classis,
    feature_name: feature?.name || '暂无',
    feature_desc: feature?.desc || '暂无特性说明',
    ride_talent: overview?.has_ride_talent ? '支持' : '不支持',
    height_label: bodySize.height,
    weight_label: bodySize.weight,
    gender_ratio: wikiGenderLabel(profile?.gender_ratio),
    move_type: profile?.move_type || '暂无',
    habitats,
    habitatsLabel: habitats.length ? habitats.join(' / ') : '暂无',
    ecology: wikiEcologyLabel(profile?.ecology, profile?.pet_style),
    type_effectiveness: wikiTypeEffectiveness(profile),
    total_stats: totalStats,
    pet_stats: stats,
    skill_groups: buildPetSkillGroups(skills),
    family_members: buildPetFamily(family, petId),
    handbook_topics: buildHandbookTopics(handbook),
    areas,
    areasLabel: areas.join(' / '),
    commandHint: '💡 洛克wiki <类型> <关键词或ID> | 示例：洛克wiki 技能 圣光斩',
    copyright: COPYRIGHT,
  }
}

export function buildWikiSkillRenderData(item: any, petsData: any, query: string) {
  const pets = ((petsData || {}).items || []).slice(0, 30).map((pet: any) => {
    const source = wikiSourceLabel(pet?.source, pet?.source_label)
    const level = pet?.level || ''
    return {
      name: pet?.name || '未知精灵',
      pet_id: pet?.pet_id ?? '-',
      icon: pet?.icon || pet?.small_icon || '',
      source,
      level,
      sourceLine: source || level ? `${source}${level ? ` · Lv.${level}` : ''}` : '',
    }
  })
  const tags = (item?.tags || []).map((tag: any) => ({ name: tag?.name || '', icon: tag?.icon || '' }))
  return {
    name: item?.name || query,
    skill_id: item?.skill_id ?? '-',
    query,
    icon: item?.icon || '',
    type: wikiNamedValue(item?.type) || '未知',
    skill_type: wikiNamedValue(item?.skill_type) || '未知',
    damage_type: wikiNamedValue(item?.damage_type) || '未知',
    element_type: wikiNamedValue(item?.element_type) || '未知',
    cost: item?.cost ?? '?',
    power: item?.power ?? '?',
    families: item?.families || '暂无',
    description: item?.description || '暂无说明',
    flavor_text: item?.flavor_text || '',
    tags,
    pets,
    pet_total: (petsData || {}).total || pets.length,
    commandHint: '💡 洛克wiki 技能 <技能名或ID>',
    copyright: COPYRIGHT,
  }
}

export function splitWikiCommandParts(text: string): { parts: string[], pageNo: number } {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  let pageNo = 1
  if (parts.length) {
    const tail = parts[parts.length - 1]
    const pageMatch = /^(?:(?:p|P|页|第)(\d+)(?:页)?|(\d+)页)$/.exec(tail)
    if (pageMatch && parts.length > 1) {
      const pageValue = pageMatch[1] || pageMatch[2]
      pageNo = Math.max(parseInt(pageValue, 10), 1)
      parts.pop()
    }
  }
  return { parts, pageNo }
}

export function wikiCatalogByToken(token: string): WikiCatalog | null {
  const text = String(token || '').trim().toLowerCase()
  return WIKI_CATALOG_ROUTES_BY_ALIAS.get(text) || null
}

// ===== 需要访问后端的服务 =====

export class WikiService {
  private catalogsCache: any = null
  private catalogsCacheTs = 0
  private optionsCache: any = null
  private optionsCacheTs = 0
  private skillDetailCache = new Map<string, any>()
  private petDetailCache = new Map<string, any>()

  constructor(private ctx: Context, private client: RocomClient) {}

  async getCatalogsPayload(force = false): Promise<any> {
    const now = Date.now()
    if (!force && this.catalogsCache !== null && now - this.catalogsCacheTs < 300000) {
      return this.catalogsCache
    }
    const payload = await this.client.getWikiCatalogs(this.ctx)
    if (payload && typeof payload === 'object') {
      this.catalogsCache = payload
      this.catalogsCacheTs = now
      return payload
    }
    return this.catalogsCache || {}
  }

  async getOptionsPayload(force = false): Promise<any> {
    const now = Date.now()
    if (!force && this.optionsCache !== null && now - this.optionsCacheTs < 300000) {
      return this.optionsCache
    }
    const payload = await this.client.getWikiOptions(this.ctx)
    if (payload && typeof payload === 'object') {
      this.optionsCache = payload
      this.optionsCacheTs = now
      return payload
    }
    return this.optionsCache || {}
  }

  backendCatalogItems(payload: any): any[] {
    if (!payload || typeof payload !== 'object') return []
    const items = payload.items
    if (!Array.isArray(items)) return []
    return items.filter(item => item && typeof item === 'object')
  }

  catalogFromBackendItem(item: any): WikiCatalog {
    const key = String(item?.key || '').trim()
    const base = WIKI_CATALOG_ROUTES_BY_KEY.get(key)
    const catalog: WikiCatalog = base
      ? { ...base, aliases: [...base.aliases] }
      : { key, title: String(item?.name || key || 'Wiki'), aliases: [], list_path: '', detail_path: '', id_fields: [], search: null }
    const backendName = String(item?.name || '').trim()
    if (backendName && !base) catalog.title = backendName
    for (const alias of [key, backendName, backendName.replace(/图鉴/g, '').trim()]) {
      if (alias && !catalog.aliases.includes(alias)) catalog.aliases.push(alias)
    }
    const filters = Array.isArray(item?.filters) ? item.filters : []
    const hasQFilter = filters.some((f: any) => f && typeof f === 'object' && f.key === 'q')
    const routeSearch = catalog.search
    catalog.search = routeSearch === null || routeSearch === undefined ? hasQFilter : Boolean(routeSearch)
    if (item?.path) catalog.list_path = String(item.path)
    catalog._backend = item
    return catalog
  }

  catalogForKeyFromPayload(key: string, catalogsPayload: any): WikiCatalog | null {
    const item = this.backendCatalogItems(catalogsPayload).find(it => String(it?.key || '') === String(key || ''))
    if (item) return this.catalogFromBackendItem(item)
    const route = WIKI_CATALOG_ROUTES_BY_KEY.get(String(key || ''))
    return route ? { ...route, aliases: [...route.aliases] } : null
  }

  catalogsFromPayload(catalogsPayload: any): WikiCatalog[] {
    return this.backendCatalogItems(catalogsPayload).map(item => this.catalogFromBackendItem(item))
  }

  async getCatalogByKey(key: string): Promise<WikiCatalog | null> {
    return this.catalogForKeyFromPayload(key, await this.getCatalogsPayload())
  }

  dynamicCatalogByToken(token: string, catalogsPayload: any): WikiCatalog | null {
    const text = normalizeQueryText(token)
    if (!text) return null
    for (const item of this.backendCatalogItems(catalogsPayload)) {
      const candidates = [
        item?.key,
        item?.name,
        String(item?.name || '').replace(/图鉴/g, '').trim(),
      ]
      if (candidates.some(candidate => candidate && normalizeQueryText(candidate) === text)) {
        return this.catalogFromBackendItem(item)
      }
    }
    return null
  }

  parseWikiCommand(text: string): { catalog: WikiCatalog | null, query: string, pageNo: number } {
    const trimmed = String(text || '').trim()
    if (!trimmed) return { catalog: null, query: '', pageNo: 1 }
    const { parts, pageNo } = splitWikiCommandParts(trimmed)
    const catalog = parts.length ? wikiCatalogByToken(parts[0]) : null
    if (catalog) return { catalog: { ...catalog, aliases: [...catalog.aliases] }, query: parts.slice(1).join(' ').trim(), pageNo }
    return { catalog: null, query: trimmed, pageNo }
  }

  catalogUsageText(): string {
    const catalogs = this.catalogsFromPayload(this.catalogsCache || {})
    const names = catalogs.slice(0, 24).map(item => item.title || item.key).join('、')
    return [
      'Wiki 用法：',
      '  洛克wiki <类型> [关键词或ID]',
      '  洛克wiki <关键词或ID>',
      '示例：洛克wiki 水灵、洛克wiki 技能 圣光斩、洛克wiki 物品 xx球、洛克wiki 种植 食谱名',
      `后端目录：${names || '请稍后重试'}`,
    ].join('\n')
  }

  buildCatalogRenderData(catalogsPayload: any, optionsPayload: any) {
    const catalogs = this.catalogsFromPayload(catalogsPayload)

    const topicCard = (catalog: WikiCatalog) => {
      const backend = catalog._backend && typeof catalog._backend === 'object' ? catalog._backend : {}
      const filters = Array.isArray(backend.filters) ? backend.filters : []
      const filterText = filters.slice(0, 6)
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => String(item.label || item.key || ''))
        .join('、')
      const title = String(catalog.title || backend.name || catalog.key || 'Wiki')
      const key = String(catalog.key || '')
      const count = backend.count
      let hint = `洛克wiki ${title} <关键词或ID>`
      if (key) hint = `${hint} / 洛克wiki ${key} <关键词或ID>`
      let coverage = String(backend.description || '').trim()
      if (filterText) coverage = `${coverage} 筛选：${filterText}`.trim()
      return {
        title,
        key,
        summary: count !== undefined && count !== null && count !== '' ? `${hint} · 条目 ${count}` : hint,
        desc: key,
        children: coverage,
      }
    }

    const groups = [{
      title: '后端 Wiki 图鉴入口',
      desc: '',
      items: catalogs.map(topicCard),
      total: catalogs.length,
    }]
    return {
      title: '洛克 Wiki',
      subtitle: '统一资料查询入口',
      summary: '',
      badges: [],
      facts: [],
      primary: [],
      groups,
      commandHint: '💡 示例：洛克wiki 水灵 | 洛克wiki 技能 圣光斩 | 洛克wiki 物品 国王球',
      copyright: COPYRIGHT,
    }
  }

  globalSearchCatalogs(catalogsPayload: any): WikiCatalog[] {
    const catalogs: WikiCatalog[] = []
    const seen = new Set<string>()
    for (const catalog of this.catalogsFromPayload(catalogsPayload)) {
      const key = String(catalog.key || '')
      if (seen.has(key) || !catalog.list_path || catalog.search === false) continue
      catalogs.push(catalog)
      seen.add(key)
    }
    return catalogs
  }

  resultCommandExamples(items: any[], catalog?: WikiCatalog | null, limit = 3): string[] {
    const examples: string[] = []
    const seen = new Set<string>()
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const child = this.catalogForKeyFromPayload(String(item._catalog_key || ''), this.catalogsCache || {}) || catalog || null
      const category = String(item._catalog_title || child?.title || '').trim()
      const title = wikiTitleForItem(item, '').trim()
      if (!category || !title) continue
      const command = `洛克wiki ${category} ${title}`
      if (seen.has(command)) continue
      examples.push(command)
      seen.add(command)
      if (examples.length >= limit) break
    }
    return examples
  }

  wikiPathParamsFromItem(catalog: WikiCatalog, item: any, rawText = ''): Record<string, string> {
    const tokens = String(rawText || '').split(/\s+/).filter(Boolean)
    const params: Record<string, string> = {}
    const idFields = catalog.id_fields || []
    idFields.forEach((field, idx) => {
      let value = item?.[field]
      const empty = (v: any) => v === undefined || v === null || v === ''
      if (empty(value) && ['item_id', 'asset_id', 'action_id'].includes(field)) value = item?.id
      if (empty(value) && ['ball_id', 'plant_id', 'carryon_id'].includes(field)) value = item?.item_id ?? item?.id
      if (empty(value) && idx < tokens.length) value = tokens[idx]
      if (!empty(value)) params[field] = String(value)
    })
    return params
  }

  fillDetailPath(catalog: WikiCatalog, params: Record<string, string>): string {
    let path = String(catalog.detail_path || '')
    for (const field of catalog.id_fields || []) {
      const value = params[field]
      if (value === undefined || value === null || value === '') return ''
      path = path.replace(`{${field}}`, String(value))
    }
    return path
  }

  itemMatchesQueryExact(catalog: WikiCatalog, item: any, query: string): boolean {
    const trimmed = String(query || '').trim()
    if (!trimmed) return false
    const normalizedQuery = normalizeQueryText(trimmed)
    for (const field of catalog.id_fields || []) {
      let value = item?.[field]
      if ((value === undefined || value === null || value === '') && ['ball_id', 'plant_id', 'carryon_id'].includes(field)) {
        value = item?.item_id ?? item?.id
      }
      if (String(value ?? '') === trimmed) return true
    }
    return normalizeQueryText(wikiTitleForItem(item, '')) === normalizedQuery
  }

  findCatalogMatch(catalog: WikiCatalog, items: any[], query: string, allowSingle = true): any | null {
    const trimmed = String(query || '').trim()
    if (!trimmed) return null
    for (const item of items) {
      if (this.itemMatchesQueryExact(catalog, item, trimmed)) return item
    }
    if (allowSingle && items.length === 1) return items[0]
    return null
  }

  async suggestCatalogItems(catalog: WikiCatalog | null, query: string, limit = 10): Promise<any[]> {
    if (!catalog || !catalog.list_path) return []
    const trimmed = String(query || '').trim()
    if (!trimmed) return []
    const terms: string[] = []
    for (const term of [trimmed, trimmed.slice(0, 2), trimmed.slice(0, 1), trimmed.slice(0, -1)]) {
      const cleaned = String(term || '').trim()
      if (cleaned && !terms.includes(cleaned)) terms.push(cleaned)
    }

    const collected = new Map<string, any>()
    for (const term of terms.slice(0, 4)) {
      const res = await this.client.listWikiCatalogItems(
        this.ctx, catalog.list_path, term, 1, 30,
        Boolean(term && catalog.search !== false),
      )
      const items = res && typeof res === 'object' ? res.items : []
      for (const item of items || []) {
        if (!item || typeof item !== 'object') continue
        const title = wikiTitleForItem(item, '')
        const keyParts = [catalog.key || '', title]
        for (const field of catalog.id_fields || []) {
          if (item[field] !== undefined && item[field] !== null && item[field] !== '') keyParts.push(String(item[field]))
        }
        const dedupeKey = keyParts.join('|')
        if (!collected.has(dedupeKey)) collected.set(dedupeKey, item)
      }
      if (collected.size >= limit * 3) break
    }

    const scored: Array<[number, any]> = []
    for (const item of collected.values()) {
      const score = wikiSimilarityScore(trimmed, item)
      if (score >= 0.18) scored.push([score, item])
    }
    scored.sort((a, b) => b[0] - a[0])
    if (!scored.length) return [...collected.values()].slice(0, limit)
    return scored.slice(0, limit).map(([, item]) => item)
  }

  buildGenericRenderData(catalog: WikiCatalog | { title: string, key: string }, payload: any, query: string, mode: string, pageNo = 1) {
    payload = payload || {}
    const fullCatalog = catalog as WikiCatalog
    if (mode === 'global-search') {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const cards: any[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const child = this.catalogForKeyFromPayload(String(item._catalog_key || ''), this.catalogsCache || {}) || fullCatalog
        const card: any = wikiCardForItem(item, child?.title || 'Wiki', child as WikiCatalog)
        if (item._catalog_title) card.badges = [item._catalog_title, ...card.badges]
        cards.push(card)
      }
      return {
        title: `全局搜索：${query}`,
        subtitle: 'Wiki / 全局搜索',
        image: '',
        summary: '未指定分类时，会在所有可搜索的大分类接口中使用后端 q 参数查询。',
        badges: ['全局搜索', '可继续指定分类'],
        facts: [
          { label: '查询词', value: query || '-' },
          { label: '结果数', value: String(payload?.total ?? cards.length) },
          { label: '搜索接口', value: String(this.globalSearchCatalogs(this.catalogsCache || {}).length) },
        ],
        actionHint: '要查看具体条目，请按卡片绿色分类 tag 加名称继续查询。',
        actionExamples: this.resultCommandExamples(items, fullCatalog),
        cards,
        sections: [],
        commandHint: '💡 结果过多时可指定分类，例如 洛克wiki 技能 水花 或 洛克wiki 物品 国王球',
        copyright: COPYRIGHT,
      }
    }
    if (mode === 'suggestions') {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const cards: any[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const child = this.catalogForKeyFromPayload(String(item._catalog_key || ''), this.catalogsCache || {}) || fullCatalog
        const card: any = wikiCardForItem(item, child?.title || fullCatalog.title, child as WikiCatalog)
        if (item._catalog_title) card.badges = [item._catalog_title, ...card.badges]
        cards.push(card)
      }
      return {
        title: `没有找到「${query}」`,
        subtitle: `Wiki / ${fullCatalog.title} / 联想结果`,
        summary: '接口没有返回精确结果，下面是按名称、摘要和相似度整理的候选。',
        image: '',
        badges: [fullCatalog.title, '联想'],
        facts: [
          { label: '查询词', value: query || '-' },
          { label: '候选数', value: String(cards.length) },
        ],
        actionHint: '接口没有精确命中时，可按候选卡片的绿色分类 tag 加名称继续查询。',
        actionExamples: this.resultCommandExamples(items, fullCatalog),
        cards,
        sections: [],
        commandHint: `💡 可使用 洛克wiki ${fullCatalog.title} <候选名称或ID> 继续查询`,
        copyright: COPYRIGHT,
      }
    }
    if (mode === 'list') {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const cards = items.filter((item: any) => item && typeof item === 'object')
        .map((item: any) => wikiCardForItem(item, fullCatalog.title, fullCatalog as WikiCatalog))
      const catalogInfo = payload?.catalog && typeof payload.catalog === 'object' ? payload.catalog : {}
      return {
        title: `${fullCatalog.title}列表`,
        subtitle: `Wiki / ${fullCatalog.title} / 第 ${pageNo} 页`,
        image: '',
        summary: catalogInfo.description || `共 ${payload?.total ?? cards.length} 条`,
        badges: [fullCatalog.title, '列表'],
        facts: [
          { label: '当前页', value: String(payload?.page_no ?? pageNo) },
          { label: '总页数', value: String(payload?.total_pages ?? '-') },
          { label: '总数', value: String(payload?.total ?? cards.length) },
        ],
        actionHint: query ? '搜索结果较多时，可按分类加名称继续查询具体条目。' : '',
        actionExamples: query ? this.resultCommandExamples(items, fullCatalog) : [],
        cards,
        sections: [],
        commandHint: '💡 洛克wiki <类型> <关键词或ID> | 洛克wiki 查看支持类型',
        copyright: COPYRIGHT,
      }
    }
    const item = payload && typeof payload === 'object' ? payload : {}
    return {
      title: wikiTitleForItem(item, fullCatalog.title),
      subtitle: `Wiki / ${fullCatalog.title}`,
      image: wikiPickImage(item),
      summary: wikiSummaryForItem(item),
      badges: [fullCatalog.title, ...wikiBadgesForItem(item)],
      facts: wikiMetaForItem(item, 16, String(fullCatalog.key || '')),
      cards: [],
      sections: wikiSectionsForPayload(item, fullCatalog as WikiCatalog),
      commandHint: '💡 洛克wiki <类型> <关键词或ID> | 洛克wiki 查看支持类型',
      copyright: COPYRIGHT,
    }
  }

  private mergeDetailPayloads(base: any, extra: any): any {
    const merged = { ...(base || {}) }
    for (const [key, value] of Object.entries(extra || {})) {
      if (value === undefined || value === null || value === ''
        || (Array.isArray(value) && !value.length)
        || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as object).length)) continue
      const oldValue = merged[key]
      if (oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue)
        && value && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = this.mergeDetailPayloads(oldValue, value)
      } else if (Array.isArray(oldValue) && Array.isArray(value)) {
        const seen = new Set<string>()
        const combined: any[] = []
        for (const item of [...oldValue, ...value]) {
          const marker = typeof item === 'object' ? JSON.stringify(item) : String(item)
          if (seen.has(marker)) continue
          seen.add(marker)
          combined.push(item)
        }
        merged[key] = combined
      } else {
        merged[key] = value
      }
    }
    return merged
  }

  private itemDetailCompanionKeys(catalog: WikiCatalog, detail: any): string[] {
    const catalogKey = String(catalog?.key || '')
    const itemId = detail?.item_id
    if (itemId === undefined || itemId === null || itemId === '') return []
    if (['skill-stones', 'skill-stone-recipes', 'balls', 'medals', 'pet-carryons'].includes(catalogKey)) {
      return detail?.item_kind ? ['items'] : []
    }
    if (catalogKey !== 'items') return []

    const flags = detail?.flags && typeof detail.flags === 'object' ? detail.flags : {}
    const typeLabel = wikiGenericValue(detail?.type || detail?.label_type)
    if (flags.is_skill_stone || typeLabel === '技能石') return ['skill-stones']
    if (flags.is_skill_stone_recipe || String(detail?.name || '').startsWith('配方-')) return ['skill-stone-recipes']
    if (typeLabel === '咕噜球') return ['balls']
    if (['奖章', '勋章'].includes(typeLabel)) return ['medals']
    if (['携带物', '精灵携带物'].includes(typeLabel)) return ['pet-carryons']
    return []
  }

  async enrichItemDetail(catalog: WikiCatalog, detail: any): Promise<any> {
    if (!detail || typeof detail !== 'object') return detail
    const itemId = detail.item_id
    if (itemId === undefined || itemId === null || itemId === '') return detail

    let merged = { ...detail }
    for (const key of this.itemDetailCompanionKeys(catalog, detail)) {
      const companion = this.catalogForKeyFromPayload(key, this.catalogsCache || {})
      if (!companion) continue
      if (key === 'items') {
        const itemKind = detail.item_kind
        if (itemKind === undefined || itemKind === null || itemKind === '') continue
        const companionDetail = await this.client.getWikiPath(this.ctx, `/api/v1/games/rocom/wiki/items/${itemKind}/${itemId}`)
        if (companionDetail) merged = this.mergeDetailPayloads(companionDetail, merged)
        continue
      }
      const companionDetail = await this.client.getWikiPath(this.ctx, `/api/v1/games/rocom/wiki/${key}/${itemId}`)
      if (companionDetail) merged = this.mergeDetailPayloads(merged, companionDetail)
    }
    return merged
  }

  async resolveWikiPet(query: string): Promise<{ detail: any, candidates: any[], error: string }> {
    const trimmed = String(query || '').trim()
    if (!trimmed) return { detail: null, candidates: [], error: '请输入精灵名称或 ID。用法：洛克wiki 精灵 <精灵名或ID>' }
    if (/^\d+$/.test(trimmed)) {
      const detail = await this.client.getWikiPet(this.ctx, trimmed)
      if (detail) return { detail, candidates: [], error: '' }
      return { detail: null, candidates: [], error: `获取 Wiki 精灵详情失败：${this.client.getLastError()}` }
    }
    const searchRes = await this.client.listWikiPets(this.ctx, trimmed, 1, 10)
    const items = (searchRes || {}).items || []
    if (!items.length) {
      const suggestions = await this.suggestCatalogItems(await this.getCatalogByKey('pets'), trimmed, 10)
      if (suggestions.length) return { detail: null, candidates: suggestions, error: '' }
      return { detail: null, candidates: [], error: `未找到「${trimmed}」的 Wiki 精灵资料：${this.client.getLastError('无匹配结果')}` }
    }
    let selected = findExactWikiMatch(items, trimmed)
    if (!selected && items.length === 1) selected = items[0]
    if (!selected) return { detail: null, candidates: items, error: '' }
    const detail = await this.client.getWikiPet(this.ctx, selected.pet_id)
    if (detail) return { detail, candidates: [], error: '' }
    return { detail: null, candidates: [], error: `获取 Wiki 精灵详情失败：${this.client.getLastError()}` }
  }

  async resolveWikiSkill(query: string): Promise<{ detail: any, candidates: any[], error: string }> {
    const trimmed = String(query || '').trim()
    if (!trimmed) return { detail: null, candidates: [], error: '请输入技能名称或 ID。用法：洛克wiki 技能 <技能名或ID>' }
    if (/^\d+$/.test(trimmed)) {
      const detail = await this.client.getWikiSkill(this.ctx, trimmed)
      if (detail) return { detail, candidates: [], error: '' }
      return { detail: null, candidates: [], error: `获取技能详情失败：${this.client.getLastError()}` }
    }
    const searchRes = await this.client.listWikiSkills(this.ctx, trimmed, 1, 10)
    const items = (searchRes || {}).items || []
    if (!items.length) {
      const suggestions = await this.suggestCatalogItems(await this.getCatalogByKey('skills'), trimmed, 10)
      if (suggestions.length) return { detail: null, candidates: suggestions, error: '' }
      return { detail: null, candidates: [], error: `未找到「${trimmed}」的技能 Wiki 资料：${this.client.getLastError('无匹配结果')}。用法：洛克wiki 技能 <技能名或ID>` }
    }
    let selected = findExactWikiMatch(items, trimmed)
    if (!selected && items.length === 1) selected = items[0]
    if (!selected) return { detail: null, candidates: items, error: '' }
    const detail = await this.client.getWikiSkill(this.ctx, selected.skill_id)
    if (detail) return { detail, candidates: [], error: '' }
    return { detail: null, candidates: [], error: `获取技能详情失败：${this.client.getLastError()}` }
  }

  async fetchWikiPetSections(petId: any): Promise<{ profile: any, skills: any, family: any, handbook: any }> {
    const [profile, skills, family, handbook] = await Promise.all([
      this.client.getWikiPetProfile(this.ctx, petId).catch(() => null),
      this.client.getWikiPetSkills(this.ctx, petId).catch(() => null),
      this.client.getWikiPetFamily(this.ctx, petId).catch(() => null),
      this.client.getWikiPetHandbook(this.ctx, petId).catch(() => null),
    ])
    return {
      profile: profile && typeof profile === 'object' ? profile : {},
      skills: skills && typeof skills === 'object' ? skills : {},
      family: family && typeof family === 'object' ? family : {},
      handbook: handbook && typeof handbook === 'object' ? handbook : {},
    }
  }

  // 通过缓存查询技能详情（供家园详情技能补全使用）
  async getSkillDetailCached(skillId: string): Promise<any | null> {
    const key = String(skillId || '').trim()
    if (!key) return null
    if (this.skillDetailCache.has(key)) return this.skillDetailCache.get(key)
    const detail = await this.client.getWikiSkill(this.ctx, key)
    if (detail && typeof detail === 'object') {
      this.skillDetailCache.set(key, detail)
      return detail
    }
    return null
  }

  // 通过缓存查询精灵详情（供家园详情体重范围使用）
  async getPetDetailCached(petId: string): Promise<any | null> {
    const key = String(petId || '').trim()
    if (!key) return null
    if (this.petDetailCache.has(key)) return this.petDetailCache.get(key)
    const detail = await this.client.getWikiPet(this.ctx, key)
    if (detail && typeof detail === 'object') {
      this.petDetailCache.set(key, detail)
      return detail
    }
    return null
  }

  async fetchGenericCatalog(catalog: WikiCatalog, query: string, pageNo: number): Promise<{ payload: any, mode: string, error: string }> {
    const trimmed = String(query || '').trim()
    const detailPath = String(catalog.detail_path || '')
    const listPath = String(catalog.list_path || '')

    if (detailPath && trimmed) {
      const directParams = this.wikiPathParamsFromItem(catalog, {}, trimmed)
      const idFields = catalog.id_fields || []
      if (idFields.length === 1 && idFields[0] === 'pet_id' && !/^\d+$/.test(trimmed)) {
        const { detail: pet } = await this.resolveWikiPet(trimmed)
        if (pet?.pet_id !== undefined && pet?.pet_id !== null && pet?.pet_id !== '') directParams.pet_id = String(pet.pet_id)
      }
      if (idFields.length === 1 && idFields[0] === 'skill_id' && !/^\d+$/.test(trimmed)) {
        const { detail: skill } = await this.resolveWikiSkill(trimmed)
        if (skill?.skill_id !== undefined && skill?.skill_id !== null && skill?.skill_id !== '') directParams.skill_id = String(skill.skill_id)
      }
      const directPath = this.fillDetailPath(catalog, directParams)
      const typeFields = new Set(['item_kind', 'asset_type', 'action_type'])
      let directAllowed = Boolean(directPath) && Object.keys(directParams).length >= idFields.length
      for (const field of idFields) {
        if (typeFields.has(field)) continue
        if (!/^\d+$/.test(String(directParams[field] || ''))) {
          directAllowed = false
          break
        }
      }
      if (directAllowed) {
        const detail = await this.client.getWikiPath(this.ctx, directPath)
        if (detail) return { payload: await this.enrichItemDetail(catalog, detail), mode: 'detail', error: '' }
      }
    }

    if (!listPath) {
      return { payload: null, mode: 'detail', error: `${catalog.title} 需要提供 ID。用法：洛克wiki ${catalog.title} <ID>` }
    }

    const listRes = await this.client.listWikiCatalogItems(this.ctx, listPath, trimmed, pageNo, 12, catalog.search !== false)
    if (listRes === null) {
      return { payload: null, mode: 'list', error: `获取 ${catalog.title} 失败：${this.client.getLastError()}` }
    }
    if (!listRes || typeof listRes !== 'object' || !('items' in listRes)) {
      return { payload: listRes, mode: 'detail', error: '' }
    }

    const items = listRes.items || []
    if (trimmed && !items.length) {
      const suggestions = await this.suggestCatalogItems(catalog, trimmed, 10)
      if (suggestions.length) return { payload: { items: suggestions, query: trimmed }, mode: 'suggestions', error: '' }
    }
    if (detailPath && trimmed && items.length) {
      const selected = this.findCatalogMatch(catalog, items, trimmed)
      if (selected) {
        const params = this.wikiPathParamsFromItem(catalog, selected, trimmed)
        const selectedPath = this.fillDetailPath(catalog, params)
        if (selectedPath) {
          const detail = await this.client.getWikiPath(this.ctx, selectedPath)
          if (detail) return { payload: await this.enrichItemDetail(catalog, detail), mode: 'detail', error: '' }
        }
      }
    }
    return { payload: listRes, mode: 'list', error: '' }
  }

  private async fetchDetailForCatalogItem(catalog: WikiCatalog, item: any, query: string): Promise<any | null> {
    if (!catalog.detail_path) return null
    const params = this.wikiPathParamsFromItem(catalog, item, query)
    const detailPath = this.fillDetailPath(catalog, params)
    if (!detailPath) return null
    const detail = await this.client.getWikiPath(this.ctx, detailPath)
    return this.enrichItemDetail(catalog, detail)
  }

  async fetchGlobalSearch(query: string, pageNo: number): Promise<{ payload: any, mode: string, error: string }> {
    const trimmed = String(query || '').trim()
    if (!trimmed) return { payload: null, mode: 'global-search', error: '请输入 Wiki 关键词。' }

    const catalogsPayload = await this.getCatalogsPayload()
    const catalogs = this.globalSearchCatalogs(catalogsPayload)
    if (!catalogs.length) return { payload: null, mode: 'global-search', error: '暂无可全局搜索的 Wiki 接口。' }

    // 有限并发抓取各目录
    const results: Array<{ catalog: WikiCatalog, items: any[], error: string }> = []
    const concurrency = 8
    let index = 0
    const worker = async () => {
      while (index < catalogs.length) {
        const catalog = catalogs[index++]
        try {
          const res = await this.client.listWikiCatalogItems(this.ctx, catalog.list_path!, trimmed, pageNo, 6, true)
          if (res === null) {
            results.push({ catalog, items: [], error: this.client.getLastError('') })
          } else {
            const items = res && typeof res === 'object' ? res.items : []
            results.push({ catalog, items: (items || []).filter((item: any) => item && typeof item === 'object'), error: '' })
          }
        } catch (e) {
          results.push({ catalog, items: [], error: String(e) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, catalogs.length) }, worker))

    const collected = new Map<string, any>()
    const exactKeys = new Set<string>()
    const errors: string[] = []

    for (const { catalog, items, error } of results) {
      if (error) {
        errors.push(`${catalog.title || catalog.key}：${error}`)
        continue
      }
      for (const item of items) {
        const merged: any = { ...item, _catalog_key: catalog.key, _catalog_title: catalog.title }
        const title = wikiTitleForItem(item, '')
        const keyParts = [String(catalog.key || ''), title]
        for (const field of catalog.id_fields || []) {
          let value = item[field]
          if ((value === undefined || value === null || value === '') && ['ball_id', 'plant_id', 'carryon_id'].includes(field)) {
            value = item.item_id ?? item.id
          }
          if (value !== undefined && value !== null && value !== '') keyParts.push(String(value))
        }
        const dedupeKey = keyParts.join('|')
        if (collected.has(dedupeKey)) continue
        let score = wikiSimilarityScore(trimmed, merged)
        if (this.itemMatchesQueryExact(catalog, item, trimmed)) {
          score += 10 - wikiGlobalCatalogPriority(catalog) * 0.01
          exactKeys.add(dedupeKey)
        }
        merged._match_score = score
        collected.set(dedupeKey, merged)
      }
    }

    const items = [...collected.values()]
    items.sort((a, b) => (b._match_score || 0) - (a._match_score || 0))

    const exactItems = [...exactKeys].filter(key => collected.has(key)).map(key => collected.get(key))
    if (exactItems.length) {
      const priorityOf = (item: any) => wikiGlobalCatalogPriority(
        this.catalogForKeyFromPayload(String(item._catalog_key || ''), catalogsPayload),
      )
      exactItems.sort((a, b) => priorityOf(a) - priorityOf(b) || (b._match_score || 0) - (a._match_score || 0))
      const bestPriority = priorityOf(exactItems[0])
      const bestItems = exactItems.filter(item => priorityOf(item) === bestPriority)
      if (bestItems.length === 1) {
        const exactItem = bestItems[0]
        const catalog = this.catalogForKeyFromPayload(String(exactItem._catalog_key || ''), catalogsPayload)
        if (catalog) {
          const detail = await this.fetchDetailForCatalogItem(catalog, exactItem, trimmed)
          if (detail) return { payload: { item: detail, _catalog: catalog }, mode: 'global-detail', error: '' }
        }
      }
    }

    if (items.length) {
      return { payload: { items: items.slice(0, 12), query: trimmed, total: items.length, _global: true }, mode: 'global-search', error: '' }
    }
    if (errors.length) return { payload: null, mode: 'global-search', error: `全局搜索失败：${errors[0]}` }
    return { payload: { items: [], query: trimmed, total: 0, _global: true }, mode: 'global-search', error: '' }
  }
}
