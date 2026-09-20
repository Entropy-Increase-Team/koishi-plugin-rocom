// 家园详情（ingame pet/data）渲染数据构造（移植自上游 astrbot v3.6.1/v3.7.0）。
// 纯函数模块，便于单元测试。

import { classifyWeight } from './pet-size'

export interface PetDataOptionMaps {
  natures: Record<string, string>
  bloodlines: Record<string, string>
  types: Record<string, string>
  talent_ratings: Record<string, string>
}

const CN_TIME_ZONE = 'Asia/Shanghai'

export function petDataDisplay(value: any, defaultText = '--'): string {
  if (value === undefined || value === null || value === '') return defaultText
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

export function petDataImageUrl(petId: any, imageType: 'image' | 'icon' = 'image'): string {
  const assetIdRaw = parseInt(String(petId), 10)
  if (!Number.isFinite(assetIdRaw) || assetIdRaw <= 0) return ''
  const assetId = assetIdRaw < 3000 ? assetIdRaw + 3000 : assetIdRaw
  const type = imageType === 'icon' ? 'icon' : 'image'
  return `https://game.gtimg.cn/images/rocom/rocodata/jingling/${assetId}/${type}.png`
}

export function petDataWikiPetId(value: any): string {
  const petId = parseInt(String(value), 10)
  if (!Number.isFinite(petId) || petId <= 0) return ''
  return String(petId < 3000 ? petId + 3000 : petId)
}

export function normalizeEpochSeconds(value: any): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  // 毫秒时间戳转秒
  return num > 10000000000 ? Math.floor(num / 1000) : Math.floor(num)
}

export function petDataTimeText(value: any): string {
  const ts = normalizeEpochSeconds(value)
  if (!ts) return '--'
  const date = new Date(ts * 1000)
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: CN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

export function petDataSizeText(value: any, unit: 'g' | 'cm' | string): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  if (unit === 'g') return `${(number / 1000).toFixed(2)} kg`
  if (unit === 'cm') return `${number} cm`
  return `${number} ${unit}`.trim()
}

export function petDataVoiceText(value: any): string {
  if (value === undefined || value === null || value === '') return '--'
  const number = Number(value)
  if (!Number.isFinite(number)) return petDataDisplay(value)
  return Number.isInteger(number) ? `${number} dB` : `${number} dB`
}

export function petDataVoiceInfo(value: any): { value: string, hint: string, className: string } {
  const text = petDataVoiceText(value)
  const number = Number(value)
  if (!Number.isFinite(number)) return { value: text, hint: '', className: '' }
  const intNumber = Math.trunc(number)
  if (intNumber >= 96 && intNumber <= 100) {
    return { value: `${text} · 婉转声`, hint: '婉转声 96~100', className: 'voice-soft' }
  }
  if (intNumber >= -100 && intNumber <= -96) {
    return { value: `${text} · 粗嗓门`, hint: '粗嗓门 -96~-100', className: 'voice-rough' }
  }
  return { value: text, hint: '婉转声 96~100 / 粗嗓门 -96~-100', className: '' }
}

export function petDataKgCompact(grams: any): string {
  const number = Number(grams)
  if (!Number.isFinite(number)) return '--'
  const text = (number / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}kg`
}

// 上游 v3.7.0：接入 Wiki 精灵体重范围，与查蛋共用同一判定。
export function petDataWeightSizeInfo(pet: any, wikiPet: any): { label?: string, className?: string, hint?: string } {
  const bodySize = wikiPet && typeof wikiPet === 'object' ? wikiPet.body_size : null
  const weightRange = bodySize && typeof bodySize === 'object' ? bodySize.weight : null
  if (!weightRange || typeof weightRange !== 'object') return {}
  if ([pet?.weight, weightRange.min_g, weightRange.max_g].some(value => value == null || value === '')) return {}
  const current = Number(pet?.weight)
  const low = Number(weightRange.min_g)
  const high = Number(weightRange.max_g)
  if (!Number.isFinite(current) || !Number.isFinite(low) || !Number.isFinite(high)) return {}
  if (high <= low) return {}

  const size = classifyWeight(current / 1000, low / 1000, high / 1000)
  const rangeText = `${petDataKgCompact(low)}-${petDataKgCompact(high)}`
  if (size) {
    return { label: size.label, className: size.css, hint: `${size.label} · ${size.css === 'size-small' ? '≤' : '≥'}${petDataKgCompact(size.threshold * 1000)} · 范围 ${rangeText}` }
  }
  return { label: '', className: '', hint: `范围 ${rangeText}` }
}

export function petDataOptionMaps(options: any): PetDataOptionMaps {
  const petOptions = options && typeof options === 'object' && options.pet && typeof options.pet === 'object' ? options.pet : {}

  const buildMap = (key: string, preferShort = false): Record<string, string> => {
    const result: Record<string, string> = {}
    const values = petOptions[key]
    if (!Array.isArray(values)) return result
    for (const item of values) {
      if (!item || typeof item !== 'object') continue
      const itemId = item.id
      if (itemId === undefined || itemId === null || itemId === '') continue
      const name = preferShort && item.short_name ? item.short_name : item.name
      if (name) result[String(itemId)] = String(name)
    }
    return result
  }

  const natures: Record<string, string> = {}
  for (const item of petOptions.natures || []) {
    if (!item || typeof item !== 'object' || item.id === undefined || item.id === null || item.id === '') continue
    const name = String(item.name || item.id)
    const summary = String(item.summary || '').trim()
    natures[String(item.id)] = summary ? `${name}（${summary}）` : name
  }

  return {
    natures,
    bloodlines: buildMap('bloodlines', true),
    types: buildMap('types'),
    talent_ratings: buildMap('talent_ratings'),
  }
}

export function petDataLookup(mapping: Record<string, string>, value: any, defaultText = '--'): string {
  const key = String(value ?? '').trim()
  if (!key) return defaultText
  return mapping[key] || key
}

// 变体识别：mutation_type 9/1/8 或 mutation_name 或 real_speciality_ids（103=异色、502=炫彩）。
export function petDataVariant(pet: any, fallback: any = {}): { variantText: string, variantIcon: string } {
  fallback = fallback || {}
  const mutationName = String(
    pet?.mutation_name || fallback?.mutation_name || fallback?.pet_mutation_name || '',
  ).trim()
  const mutationType = String(pet?.mutation_type ?? fallback?.mutation_type ?? '').trim()
  const specialityValues: any[] = []
  for (const value of [pet?.real_speciality_ids, fallback?.real_speciality_ids, pet?.speciality_id, fallback?.speciality_id]) {
    if (Array.isArray(value)) specialityValues.push(...value)
    else if (value !== undefined && value !== null && value !== '') specialityValues.push(value)
  }
  const specialityIds = new Set(specialityValues.map(value => String(value).trim()).filter(Boolean))

  if (mutationType === '9' || (mutationName.includes('异色') && mutationName.includes('炫彩')) || (specialityIds.has('103') && specialityIds.has('502'))) {
    return { variantText: '异色炫彩', variantIcon: '异色炫彩.png' }
  }
  if (mutationType === '1' || mutationName.includes('异色') || specialityIds.has('103')) {
    return { variantText: '异色', variantIcon: '异色.png' }
  }
  if (mutationType === '8' || mutationName.includes('炫彩') || specialityIds.has('502')) {
    return { variantText: '炫彩', variantIcon: '炫彩.png' }
  }
  return { variantText: mutationName || '普通', variantIcon: '' }
}

export function petDataAttributes(pet: any): Array<{ label: string, value: string, race: string, talent: string, percent: number }> {
  const attributeInfo = pet?.attribute_info && typeof pet.attribute_info === 'object' ? pet.attribute_info : {}
  const fields: Array<[string, string]> = [
    ['hp', '生命'],
    ['attack', '物攻'],
    ['special_attack', '魔攻'],
    ['defense', '物防'],
    ['special_defense', '魔防'],
    ['speed', '速度'],
  ]
  return fields.map(([key, label]) => {
    const raw = attributeInfo[key] && typeof attributeInfo[key] === 'object' ? attributeInfo[key] : {}
    let percent = 6
    const base = Number(raw.base_value)
    if (Number.isFinite(base)) percent = Math.trunc(Math.max(6, Math.min(100, base / 200 * 100)))
    return {
      label,
      value: petDataDisplay(raw.base_value),
      race: petDataDisplay(raw.total_race),
      talent: petDataDisplay(raw.talent),
      percent,
    }
  })
}

export function petDataSkillItems(pet: any): any[] {
  const skillRoot = pet?.skill && typeof pet.skill === 'object' ? pet.skill : {}
  const skills = Array.isArray(skillRoot.skill_data) ? skillRoot.skill_data : []
  const sortKey = (item: any): [number, number, number] => {
    const equippedRank = item?.is_equipped ? 0 : 1
    const learnedRank = item?.is_learned ? 0 : 1
    let pos = parseInt(String(item?.pos ?? 99), 10)
    if (!Number.isFinite(pos)) pos = 99
    return [equippedRank, learnedRank, pos]
  }
  return skills
    .filter((s: any) => s && typeof s === 'object')
    .sort((a: any, b: any) => {
      const ka = sortKey(a)
      const kb = sortKey(b)
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
    })
}

function extractRawItems(payload: any): any[] {
  const rawItems: any[] = []
  if (Array.isArray(payload?.npc_pets)) {
    rawItems.push(...payload.npc_pets.filter((item: any) => item && typeof item === 'object'))
  } else if (payload?.npc_pet && typeof payload.npc_pet === 'object') {
    const query = payload?.query && typeof payload.query === 'object' ? payload.query : {}
    rawItems.push({
      status: 'ok',
      npc_pet: payload.npc_pet,
      pet_gid: query.pet_gid,
      furniture_guid: query.npc_id || query.furniture_guid,
      npc_id_source: 'query',
    })
  }
  return rawItems
}

export function petDataSkillIdsFromPayload(payload: any): string[] {
  let root = payload || {}
  if (root.result && typeof root.result === 'object') root = root.result
  const ids: string[] = []
  for (const raw of extractRawItems(root)) {
    const npcPet = raw?.npc_pet && typeof raw.npc_pet === 'object' ? raw.npc_pet : {}
    const pet = npcPet?.pet && typeof npcPet.pet === 'object' ? npcPet.pet : {}
    for (const item of petDataSkillItems(pet).slice(0, 8)) {
      const skillId = String(item?.id ?? '').trim()
      if (skillId && !ids.includes(skillId)) ids.push(skillId)
    }
  }
  return ids
}

export function petDataPetIdsFromPayload(payload: any): string[] {
  let root = payload || {}
  if (root.result && typeof root.result === 'object') root = root.result
  const ids: string[] = []
  for (const raw of extractRawItems(root)) {
    const npcPet = raw?.npc_pet && typeof raw.npc_pet === 'object' ? raw.npc_pet : {}
    const pet = npcPet?.pet && typeof npcPet.pet === 'object' ? npcPet.pet : {}
    const petId = petDataWikiPetId(pet.base_conf_id || raw.pet_cfg_id || pet.catch_base_id || pet.conf_id)
    if (petId && !ids.includes(petId)) ids.push(petId)
  }
  return ids
}

export function petDataSkillIconUrl(baseUrl: string, skillId: any, detail: any = null): string {
  const icon = String(detail?.icon || '').trim()
  if (icon) return icon
  const skillText = String(skillId ?? '').trim()
  if (!skillText) return ''
  return `${baseUrl}/api/v1/resources/wiki/assets/skills/${skillText}.png`
}

function wikiNamedValue(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.name || value.label || value.value || '')
  }
  return String(value ?? '')
}

export function petDataSkills(
  pet: any,
  skillLookup: Record<string, any> = {},
  options: { loadSkillIcons?: boolean, baseUrl?: string } = {},
): any[] {
  const loadSkillIcons = options.loadSkillIcons !== false
  const baseUrl = options.baseUrl || ''
  const result: any[] = []
  for (const item of petDataSkillItems(pet).slice(0, 8)) {
    const skillId = petDataDisplay(item?.id)
    const detail = skillId !== '--' ? skillLookup[String(skillId)] : null
    let status: string
    let statusClass: string
    if (item?.is_equipped) {
      status = '已装备'
      statusClass = 'equipped'
    } else if (item?.is_learned) {
      status = '已学会'
      statusClass = 'learned'
    } else {
      status = '未学会'
      statusClass = 'locked'
    }
    const element = detail ? wikiNamedValue(detail.element_type) : ''
    const skillType = detail ? wikiNamedValue(detail.skill_type || detail.damage_type) : ''
    result.push({
      id: skillId,
      name: String(detail?.name || skillId),
      icon: loadSkillIcons ? petDataSkillIconUrl(baseUrl, skillId, detail) : '',
      element: element || '未知',
      type: skillType || '技能',
      power: petDataDisplay(detail?.power),
      cost: petDataDisplay(detail?.cost),
      pos: petDataDisplay(item?.pos),
      status,
      statusClass,
      unlock: item?.unlock_need_lv !== undefined && item?.unlock_need_lv !== null && item?.unlock_need_lv !== '' && item?.unlock_need_lv !== 0
        ? `Lv.${item.unlock_need_lv}`
        : '--',
      description: String(detail?.description || detail?.desc || ''),
    })
  }
  return result
}

export function petDataCardItems(
  pet: any,
  optionMaps: PetDataOptionMaps,
  sizeInfo: { label?: string, className?: string, hint?: string } = {},
): any[] {
  const genderMap: Record<string, string> = { '0': '未知', '1': '雄性', '2': '雌性' }
  const gender = genderMap[String(pet?.gender ?? '')] || petDataDisplay(pet?.gender)
  const nature = petDataLookup(optionMaps.natures, pet?.nature)
  const blood = petDataLookup(optionMaps.bloodlines, pet?.blood_id)
  const talentRank = petDataLookup(optionMaps.talent_ratings, pet?.talent_rank, petDataDisplay(pet?.talent_rank))
  const voiceInfo = petDataVoiceInfo(pet?.voice)
  let weightValue = petDataSizeText(pet?.weight, 'g')
  if (sizeInfo.label) weightValue = `${weightValue} · ${sizeInfo.label}`
  return [
    { label: '等级', value: petDataDisplay(pet?.level) },
    { label: '性别', value: gender },
    { label: '分贝', ...voiceInfo },
    { label: '性格', value: nature },
    { label: '血脉', value: blood },
    { label: '天赋评级', value: talentRank },
    { label: '身高', value: petDataSizeText(pet?.height, 'cm') },
    {
      label: '体重',
      value: weightValue,
      hint: sizeInfo.hint || '',
      className: sizeInfo.className || '',
    },
  ]
}

export function petDataExtractItems(
  payload: any,
  optionMaps: PetDataOptionMaps,
  skillLookup: Record<string, any> = {},
  sizeLookup: Record<string, any> = {},
  options: { loadSkillIcons?: boolean, baseUrl?: string } = {},
): any[] {
  const rawItems = extractRawItems(payload)
  const pets: any[] = []
  rawItems.forEach((raw, index) => {
    const npcPet = raw?.npc_pet && typeof raw.npc_pet === 'object' ? raw.npc_pet : {}
    const pet = npcPet?.pet && typeof npcPet.pet === 'object' ? npcPet.pet : {}
    const status = String(raw?.status || (Object.keys(pet).length ? 'ok' : 'unknown'))
    const { variantText, variantIcon } = petDataVariant(pet, raw)
    const baseId = pet.base_conf_id || raw.pet_cfg_id || pet.catch_base_id || pet.conf_id
    const wikiPetId = petDataWikiPetId(baseId)
    const sizeInfo = petDataWeightSizeInfo(pet, sizeLookup[wikiPetId])
    const name = pet.name || pet.pet_default_name || raw.pet_default_name || raw.name || `精灵 ${baseId || index + 1}`
    const defaultName = pet.pet_default_name || raw.pet_default_name || ''
    const displayDefault = defaultName && defaultName !== name ? defaultName : ''
    const petGid = pet.gid || raw.pet_gid
    const sceneInfo = pet.scene_info && typeof pet.scene_info === 'object' ? pet.scene_info : null
    const furnitureGuid = raw.furniture_guid ?? (sceneInfo ? sceneInfo.npc_id : undefined)
    pets.push({
      index: index + 1,
      status,
      statusText: status === 'ok' ? '成功' : status,
      retCode: petDataDisplay(npcPet.ret_code),
      name: String(name),
      defaultName: String(displayDefault),
      level: petDataDisplay(pet.level),
      baseId: petDataDisplay(baseId),
      confId: petDataDisplay(pet.conf_id),
      petGid: petDataDisplay(petGid),
      npcId: petDataDisplay(furnitureGuid),
      npcIdSource: petDataDisplay(raw.npc_id_source),
      imageUrl: petDataImageUrl(baseId, 'image'),
      iconUrl: petDataImageUrl(baseId, 'icon'),
      variantText,
      variantIcon,
      voiceText: petDataVoiceText(pet.voice),
      cards: petDataCardItems(pet, optionMaps, sizeInfo),
      attributes: petDataAttributes(pet),
      skills: petDataSkills(pet, skillLookup, options),
      catchItems: [
        { label: '捕捉等级', value: petDataDisplay(pet.catch_lv) },
        { label: '捕捉方式', value: petDataDisplay(pet.catch_way) },
        { label: '捕捉营地', value: petDataDisplay(pet.caught_camp) },
        { label: '获得时间', value: petDataTimeText(pet.add_time) },
      ],
      specialityIds: (Array.isArray(pet.real_speciality_ids) ? pet.real_speciality_ids : [])
        .map((x: any) => String(x)).join(' / ') || petDataDisplay(pet.speciality_id),
      relationshipType: petDataDisplay(npcPet.relationship_type),
      errorText: petDataDisplay(raw.error || raw.message || npcPet.error_message, ''),
    })
  })
  return pets
}

export function buildPetDataRenderData(
  res: any,
  uid: string,
  options: {
    optionsPayload?: any
    skillLookup?: Record<string, any>
    sizeLookup?: Record<string, any>
    singleQuery?: boolean
    lowBandwidthMode?: boolean
    baseUrl?: string
  } = {},
): any {
  let payload = res || {}
  if (payload.result && typeof payload.result === 'object') payload = payload.result
  const optionMaps = petDataOptionMaps(options.optionsPayload)
  let playerInfo = payload.player_info && typeof payload.player_info === 'object' ? payload.player_info : {}
  if (!Object.keys(playerInfo).length && payload.npc_pet && typeof payload.npc_pet === 'object') {
    playerInfo = payload.npc_pet.player_info && typeof payload.npc_pet.player_info === 'object' ? payload.npc_pet.player_info : {}
  }
  const pets = petDataExtractItems(payload, optionMaps, options.skillLookup || {}, options.sizeLookup || {}, {
    loadSkillIcons: !options.lowBandwidthMode,
    baseUrl: options.baseUrl || '',
  })
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {}
  const finishedAt = normalizeEpochSeconds(meta.finished_at || meta.created_at)
  const updatedAt = petDataTimeText(finishedAt || Math.floor(Date.now() / 1000))
  const online = playerInfo.online
  const onlineText = online === true ? '在线' : online === false ? '离线' : '未知'
  const okCount = payload.npc_pet_ok_count
  const errorCount = payload.npc_pet_error_count
  const skippedCount = payload.npc_pet_skipped_count
  return {
    title: '家园详情',
    subtitle: 'Ingame Pet Data',
    uid: petDataDisplay(payload.uin || playerInfo.uin || uid),
    playerName: petDataDisplay(playerInfo.name, '未知玩家'),
    playerLevel: petDataDisplay(playerInfo.level),
    worldLevel: petDataDisplay(playerInfo.world_level),
    onlineText,
    isOnline: online === true,
    queryMode: options.singleQuery ? '单只精灵' : '家园批量',
    lowBandwidthMode: Boolean(options.lowBandwidthMode),
    summaryCards: [
      { label: '目标状态', value: onlineText },
      { label: '返回精灵', value: String(pets.length) },
      { label: '成功/失败', value: `${petDataDisplay(okCount, String(pets.length))} / ${petDataDisplay(errorCount, '0')}` },
      { label: '跳过', value: petDataDisplay(skippedCount, '0') },
    ],
    pets,
    updatedAt,
    notice: '该接口依赖目标玩家在线且家园可访问；离线或隐私/上游不可达时可能失败。',
    emptyText: '未获取到家园精灵完整数据。请确认目标玩家在线、家园可访问，或稍后重试。',
    commandHint: '💡 洛克.家园详情 <UID> | 洛克.家园详情 <UID> <pet_gid> <npc_id>',
    copyright: 'Koishi & WeGame 洛克王国插件',
  }
}
