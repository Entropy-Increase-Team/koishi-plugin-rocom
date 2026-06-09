import { Logger } from 'koishi'
import fs from 'node:fs'
import path from 'node:path'

const logger = new Logger('rocom-egg')

export const EGG_GROUP_META: Record<number, { label: string; desc: string }> = {
  1:  { label: '未发现', desc: '不能和任何精灵生蛋' },
  2:  { label: '怪兽', desc: '像怪兽一样的动物' },
  3:  { label: '两栖', desc: '两栖动物和水边生活的多栖动物' },
  4:  { label: '虫', desc: '看起来像虫子的精灵' },
  5:  { label: '飞行', desc: '会飞的精灵' },
  6:  { label: '陆上', desc: '生活在陆地上的精灵' },
  7:  { label: '妖精', desc: '可爱的小动物' },
  8:  { label: '植物', desc: '看起来像植物的精灵' },
  9:  { label: '人型', desc: '看起来像人的精灵' },
  10: { label: '软体', desc: '看起来软软的精灵' },
  11: { label: '矿物', desc: '身体由矿物组成的精灵' },
  12: { label: '不定形', desc: '没有固定形态的精灵' },
  13: { label: '鱼', desc: '看起来像鱼的精灵' },
  14: { label: '龙', desc: '看起来像龙的精灵' },
  15: { label: '机械', desc: '身体由机械组成的精灵' },
}

export function getEggGroupLabel(id: number): string {
  return EGG_GROUP_META[id]?.label || `蛋组${id}`
}

export function formatEggGroups(ids: number[]): string {
  if (!ids?.length) return '暂无蛋组数据'
  return ids.map(getEggGroupLabel).join(' / ')
}

export interface SearchResult {
  matchType: 'exact' | 'fuzzy' | 'multi' | 'not_found'
  pet?: any
  candidates?: any[]
}

function petName(p: any): string {
  return p?.localized?.zh?.name || p?.name || '???'
}

function petType(p: any): string {
  const parts: string[] = []
  const mt = p?.main_type?.localized?.zh
  if (mt) parts.push(mt)
  const st = p?.sub_type?.localized?.zh
  if (st) parts.push(st)
  return parts.join(' / ') || '未知'
}

function fmtDur(s: number): string {
  if (!s || s <= 0) return '暂无数据'
  if (s % 86400 === 0) return `${s / 86400} 天`
  const h = s / 3600
  return h === Math.floor(h) ? `${h} 小时` : `${h.toFixed(1)} 小时`
}
function wt(v: number | null | undefined): number | null {
  return v != null ? Math.round(v / 1000 * 10) / 10 : null
}

function ht(v: number | null | undefined): number | null {
  return v != null ? Math.round(v) / 100 : null
}

function fmtRange(lo: number | null, hi: number | null, u: string): string {
  if (lo == null && hi == null) return '暂无数据'
  if (lo != null && hi != null) return lo === hi ? `${lo}${u}` : `${lo}-${hi}${u}`
  return `${lo ?? hi}${u}`
}

function num(value: any): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: any, digits = 2): string {
  const parsed = num(value)
  if (parsed == null) return ''
  return String(Number(parsed.toFixed(digits)))
}

function assetPetId(petId: any): number | null {
  const n = Number(petId)
  if (isNaN(n)) return null
  return n >= 3000 ? n : n + 3000
}

function petIconUrl(petId: any): string {
  const aid = assetPetId(petId)
  return aid ? `https://game.gtimg.cn/images/rocom/rocodata/jingling/${aid}/icon.png` : ''
}

function petImageUrl(petId: any): string {
  const aid = assetPetId(petId)
  return aid ? `https://game.gtimg.cn/images/rocom/rocodata/jingling/${aid}/image.png` : ''
}

export class EggService {
  private pets: any[] = []
  private byId: Map<number, any> = new Map()
  private byZh: Map<string, any> = new Map()
  private byEn: Map<string, any> = new Map()

  constructor(dataDir: string) {
    this.load(dataDir)
  }

  private load(dataDir: string) {
    const filePath = path.join(dataDir, 'Pets.json')
    if (!fs.existsSync(filePath)) {
      logger.error(`Pets.json 不存在: ${filePath}`)
      return
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      this.pets = Array.isArray(raw) ? raw : []
      for (const p of this.pets) {
        this.byId.set(p.id, p)
        const zh = p.localized?.zh?.name
        if (zh) this.byZh.set(zh, p)
        const en = p.name?.toLowerCase()
        if (en) this.byEn.set(en, p)
      }
      logger.info(`加载 ${this.pets.length} 只精灵`)
    } catch (e) {
      logger.error(`加载 Pets.json 失败: ${e}`)
    }
  }

  getEggGroups(pet: any): number[] {
    return pet?.breeding_profile?.egg_groups || []
  }

  search(keyword: string): SearchResult {
    const kw = keyword.trim()
    if (!kw) return { matchType: 'not_found' }
    if (this.byZh.has(kw)) return { matchType: 'exact', pet: this.byZh.get(kw) }
    const pid = Number(kw)
    if (!isNaN(pid) && this.byId.has(pid)) return { matchType: 'exact', pet: this.byId.get(pid) }
    if (this.byEn.has(kw.toLowerCase())) return { matchType: 'exact', pet: this.byEn.get(kw.toLowerCase()) }
    const kwLower = kw.toLowerCase()
    const hits = this.pets.filter(p => {
      const zh = p.localized?.zh?.name || ''
      const en = p.name || ''
      return zh.toLowerCase().includes(kwLower) || en.toLowerCase().includes(kwLower)
    })
    if (hits.length === 1) return { matchType: 'fuzzy', pet: hits[0] }
    if (hits.length > 1) return { matchType: 'multi', candidates: hits.slice(0, 20) }
    return { matchType: 'not_found' }
  }

  searchBySize(height?: number, weight?: number): { perfect: any[]; range: any[] } {
    const perfect: any[] = [], range: any[] = []
    for (const p of this.pets) {
      const br = p.breeding || {}
      let hMatch: string | null = null, wMatch: string | null = null
      if (height != null) {
        const hLo = br.height_low, hHi = br.height_high
        if (hLo != null && hHi != null) {
          if (hLo <= height && height <= hHi) hMatch = 'perfect'
          else if (hLo * 0.85 <= height && height <= hHi * 1.15) hMatch = 'range'
          else hMatch = 'none'
        } else hMatch = 'none'
      }
      if (weight != null) {
        const wLo = br.weight_low, wHi = br.weight_high
        if (wLo != null && wHi != null) {
          const wKgLo = wLo / 1000, wKgHi = wHi / 1000
          if (wKgLo <= weight && weight <= wKgHi) wMatch = 'perfect'
          else if (wKgLo * 0.85 <= weight && weight <= wKgHi * 1.15) wMatch = 'range'
          else wMatch = 'none'
        } else wMatch = 'none'
      }
      if (height != null && weight != null) {
        if (hMatch === 'perfect' && wMatch === 'perfect') perfect.push(p)
        else if (hMatch !== 'none' && wMatch !== 'none') range.push(p)
      } else if (height != null) {
        if (hMatch === 'perfect') perfect.push(p)
        else if (hMatch === 'range') range.push(p)
      } else if (weight != null) {
        if (wMatch === 'perfect') perfect.push(p)
        else if (wMatch === 'range') range.push(p)
      }
    }
    return { perfect: perfect.slice(0, 20), range: range.slice(0, 20) }
  }

  private formatMatchSummary(probability?: any, matchCount?: any): string {
    const parts: string[] = []
    if (probability != null) parts.push(`匹配率 ${formatNumber(probability)}%`)
    if (matchCount != null) parts.push(`命中次数 ${formatNumber(matchCount, 0)}`)
    return parts.join(' / ')
  }

  private calcLocalMatchInfo(
    queryHeight?: number,
    queryWeight?: number,
    heightMin?: number | null,
    heightMax?: number | null,
    weightMin?: number | null,
    weightMax?: number | null,
  ): { probability: number | null; matchCount: number | null } {
    const scores: number[] = []
    if (queryHeight != null) {
      const score = this.rangeMatchScore(ht(queryHeight), heightMin, heightMax)
      if (score != null) scores.push(score)
    }
    if (queryWeight != null) {
      const score = this.rangeMatchScore(queryWeight, weightMin, weightMax)
      if (score != null) scores.push(score)
    }
    if (!scores.length) return { probability: null, matchCount: null }
    return {
      probability: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      matchCount: scores.length,
    }
  }

  private rangeMatchScore(value: any, low: any, high: any): number | null {
    const valueNum = num(value)
    const lowNum = num(low)
    const highNum = num(high)
    if (valueNum == null || lowNum == null || highNum == null) return null
    if (lowNum <= valueNum && valueNum <= highNum) return 100

    let tolerance: number
    let distance: number
    if (valueNum < lowNum) {
      tolerance = Math.max(lowNum * 0.15, 0.0001)
      distance = lowNum - valueNum
    } else {
      tolerance = Math.max(highNum * 0.15, 0.0001)
      distance = valueNum - highNum
    }
    if (distance > tolerance) return 0
    return Math.max(0, 100 * (1 - distance / tolerance))
  }

  private formatPetCard(pet: any, queryHeight?: number, queryWeight?: number) {
    const br = pet?.breeding || {}
    const eggGroups = this.getEggGroups(pet)
    const heightMin = ht(br.height_low)
    const heightMax = ht(br.height_high)
    const weightMin = wt(br.weight_low)
    const weightMax = wt(br.weight_high)
    const { probability, matchCount } = this.calcLocalMatchInfo(
      queryHeight,
      queryWeight,
      heightMin,
      heightMax,
      weightMin,
      weightMax,
    )

    return {
      id: pet?.id,
      name: petName(pet),
      icon: petIconUrl(pet?.id),
      image: petImageUrl(pet?.id),
      type_label: petType(pet),
      egg_group_ids: eggGroups,
      egg_groups_label: formatEggGroups(eggGroups),
      height_min: heightMin,
      height_max: heightMax,
      height_label: fmtRange(heightMin, heightMax, 'm'),
      weight_min: weightMin,
      weight_max: weightMax,
      weight_label: fmtRange(weightMin, weightMax, 'kg'),
      probability,
      match_count: matchCount,
      match_info_label: this.formatMatchSummary(probability, matchCount),
    }
  }

  private formatSizeApiCard(item: any) {
    const probability = num(item?.probability)
    const matchCount = num(item?.matchCount)
    const heightMin = num(item?.diameterMin)
    const heightMax = num(item?.diameterMax)
    const weightMin = num(item?.weightMin)
    const weightMax = num(item?.weightMax)

    return {
      id: item?.petId || '-',
      name: item?.pet || '未知精灵',
      icon: item?.petIcon || petIconUrl(item?.petId),
      image: item?.petImage || petImageUrl(item?.petId),
      type_label: '后端未提供',
      egg_group_ids: [],
      egg_groups_label: '后端未提供',
      height_min: heightMin,
      height_max: heightMax,
      height_label: fmtRange(heightMin, heightMax, 'm'),
      weight_min: weightMin,
      weight_max: weightMax,
      weight_label: fmtRange(weightMin, weightMax, 'kg'),
      probability,
      match_count: matchCount,
      match_info_label: this.formatMatchSummary(probability, matchCount),
    }
  }

  private formatEggSearchCard(item: any) {
    const eggGroups = Array.isArray(item?.egg_groups)
      ? item.egg_groups
        .map((group: any) => group?.official_name || group?.display_name || `蛋组${group?.group_id}`)
        .filter(Boolean)
      : []
    const heightRange = Array.isArray(item?.height_range_m) ? item.height_range_m : []
    const weightRange = Array.isArray(item?.weight_range_kg) ? item.weight_range_kg : []
    const typeLabel = Array.isArray(item?.unit_type) && item.unit_type.length
      ? item.unit_type.join(' / ')
      : '未知'

    return {
      id: item?.id || '-',
      name: item?.name || '未知精灵',
      icon: item?.pet_icon_url || petIconUrl(item?.id),
      image: item?.pet_img_url || petImageUrl(item?.id),
      type_label: typeLabel,
      egg_group_ids: Array.isArray(item?.egg_groups)
        ? item.egg_groups.map((group: any) => Number(group?.group_id)).filter((value: number) => Number.isFinite(value))
        : [],
      egg_groups_label: eggGroups.length ? eggGroups.join(' / ') : '暂无蛋组数据',
      height_min: num(heightRange[0]),
      height_max: num(heightRange[1]),
      height_label: fmtRange(num(heightRange[0]), num(heightRange[1]), 'm'),
      weight_min: num(weightRange[0]),
      weight_max: num(weightRange[1]),
      weight_label: fmtRange(num(weightRange[0]), num(weightRange[1]), 'kg'),
      probability: null,
      match_count: null,
      match_info_label: '',
    }
  }

  private formatEggSearchTextLine(item: any) {
    const card = this.formatEggSearchCard(item)
    return `${card.name} (#${card.id}) — ${card.height_label} / ${card.weight_label} · ${card.egg_groups_label}`
  }

  private mergeCardsByName(perfect: any[], ranged: any[]): [any[], any[]] {
    const perfectMap = new Map<string, any>()
    const rangedMap = new Map<string, any>()
    const keyOf = (item: any) => String(item?.name || item?.id || '').replace(/\s+/g, '')
    const add = (target: Map<string, any>, item: any) => {
      const key = keyOf(item)
      if (!key) return
      target.set(key, target.has(key) ? this.mergeSizeCard(target.get(key), item) : item)
    }

    for (const item of perfect) add(perfectMap, item)
    for (const item of ranged) {
      const key = keyOf(item)
      if (key && perfectMap.has(key)) {
        perfectMap.set(key, this.mergeSizeCard(perfectMap.get(key), item))
      } else {
        add(rangedMap, item)
      }
    }
    return [[...perfectMap.values()], [...rangedMap.values()]]
  }

  private mergeSizeCard(left: any, right: any) {
    const unique = (values: any[]) => [...new Set(values.filter(value => value != null && value !== '').map(value => String(value)))]
    const ids = unique([...String(left?.id || '').split('/'), ...String(right?.id || '').split('/')]
      .map(value => value.trim().replace(/^#/, '')))
    const eggGroupIds = unique([...(left?.egg_group_ids || []), ...(right?.egg_group_ids || [])]).map(Number)
    const probabilityValues = [num(left?.probability), num(right?.probability)].filter(value => value != null) as number[]
    const matchCountValues = [num(left?.match_count), num(right?.match_count)].filter(value => value != null) as number[]
    const heightMin = this.minValue(left?.height_min, right?.height_min)
    const heightMax = this.maxValue(left?.height_max, right?.height_max)
    const weightMin = this.minValue(left?.weight_min, right?.weight_min)
    const weightMax = this.maxValue(left?.weight_max, right?.weight_max)
    const probability = probabilityValues.length ? probabilityValues.reduce((sum, value) => sum + value, 0) : null
    const matchCount = matchCountValues.length ? matchCountValues.reduce((sum, value) => sum + value, 0) : null

    return {
      ...left,
      id: ids.join('/'),
      egg_group_ids: eggGroupIds,
      egg_groups_label: eggGroupIds.length ? formatEggGroups(eggGroupIds) : unique([left?.egg_groups_label, right?.egg_groups_label]).join(' / ') || left?.egg_groups_label,
      probability,
      match_count: matchCount,
      match_info_label: this.formatMatchSummary(probability, matchCount),
      height_min: heightMin,
      height_max: heightMax,
      height_label: fmtRange(heightMin, heightMax, 'm'),
      weight_min: weightMin,
      weight_max: weightMax,
      weight_label: fmtRange(weightMin, weightMax, 'kg'),
    }
  }

  private minValue(...values: any[]): number | null {
    const numbers = values.map(num).filter(value => value != null) as number[]
    return numbers.length ? Math.min(...numbers) : null
  }

  private maxValue(...values: any[]): number | null {
    const numbers = values.map(num).filter(value => value != null) as number[]
    return numbers.length ? Math.max(...numbers) : null
  }

  getCompatiblePets(pet: any): any[] {
    const groups = new Set(this.getEggGroups(pet))
    if (!groups.size || groups.has(1)) return []
    return this.pets.filter(o => {
      if (o.id === pet.id) return false
      const og = new Set(this.getEggGroups(o))
      if (!og.size || og.has(1)) return false
      for (const g of groups) if (og.has(g)) return true
      return false
    })
  }

  getBreedingParents(pet: any): any[] {
    const eggGroups = new Set(this.getEggGroups(pet))
    if (!eggGroups.size || eggGroups.has(1)) return []
    return this.pets.filter(o => {
      if (o.id === pet.id) return false
      const og = new Set(this.getEggGroups(o))
      if (!og.size || og.has(1)) return false
      for (const g of eggGroups) if (og.has(g)) return true
      return false
    })
  }

  evaluatePair(a: any, b: any) {
    const ga = new Set(this.getEggGroups(a)), gb = new Set(this.getEggGroups(b))
    const shared = [...ga].filter(g => gb.has(g)).sort()
    const reasons: string[] = []
    if (!ga.size) reasons.push(`${petName(a)} 暂无蛋组数据`)
    if (!gb.size) reasons.push(`${petName(b)} 暂无蛋组数据`)
    if (ga.has(1)) reasons.push(`${petName(a)} 属于「未发现」蛋组`)
    if (gb.has(1)) reasons.push(`${petName(b)} 属于「未发现」蛋组`)
    if (!shared.length && !reasons.length) reasons.push('蛋组不相同，无法配种')
    const br = a.breeding || {}
    return {
      compatible: !reasons.length && shared.length > 0,
      reasons,
      shared_egg_groups: shared,
      shared_egg_group_labels: shared.map(getEggGroupLabel),
      hatch_label: fmtDur(br.hatch_data),
      weight_label: fmtRange(wt(br.weight_low), wt(br.weight_high), 'kg'),
      height_label: fmtRange(br.height_low, br.height_high, 'cm'),
    }
  }
  // ─── 文本构建 ───

  buildSizeSearchText(height?: number, weight?: number, results?: { perfect: any[]; range: any[] }, heightDisplay?: string): string {
    const cond: string[] = []
    if (height != null) cond.push(`身高=${heightDisplay || fmtRange(ht(height), ht(height), 'm')}`)
    if (weight != null) cond.push(`体重=${weight}kg`)
    const condStr = cond.join(' + ')
    if (!results || (!results.perfect.length && !results.range.length)) return `❌ 未找到符合 ${condStr} 的精灵。`
    const lines: string[] = []
    if (results.perfect.length) {
      lines.push(`✅ 完美匹配 ${condStr} 的精灵（共 ${results.perfect.length} 只）：`)
      results.perfect.slice(0, 10).forEach((p, i) => {
        const br = p.breeding || {}
        lines.push(`  ${i + 1}. ${petName(p)} (#${p.id}) — ${fmtRange(ht(br.height_low), ht(br.height_high), 'm')} / ${fmtRange(wt(br.weight_low), wt(br.weight_high), 'kg')} · ${formatEggGroups(this.getEggGroups(p))}`)
      })
    }
    if (results.range.length) {
      if (lines.length) lines.push('')
      lines.push(`🔍 范围匹配 ${condStr} 的精灵（共 ${results.range.length} 只，容差±15%）：`)
      results.range.slice(0, 10).forEach((p, i) => {
        const br = p.breeding || {}
        lines.push(`  ${i + 1}. ${petName(p)} (#${p.id}) — ${fmtRange(ht(br.height_low), ht(br.height_high), 'm')} / ${fmtRange(wt(br.weight_low), wt(br.weight_high), 'kg')} · ${formatEggGroups(this.getEggGroups(p))}`)
      })
    }
    return lines.join('\n')
  }

  buildSizeSearchTextFromApi(height?: number, weight?: number, results?: any, heightDisplay?: string): string {
    const cond: string[] = []
    if (height != null) cond.push(`身高=${heightDisplay || fmtRange(ht(height), ht(height), 'm')}`)
    if (weight != null) cond.push(`体重=${weight}kg`)
    const condStr = cond.join(' + ') || '当前条件'
    const exact = results?.exactResults || []
    const candidates = results?.candidates || []
    if (!exact.length && !candidates.length) return `❌ 未找到符合 ${condStr} 的精灵。`
    const lines: string[] = []
    if (exact.length) {
      lines.push(`✅ 完美匹配 ${condStr} 的精灵（共 ${exact.length} 只）：`)
      exact.slice(0, 10).forEach((item: any, i: number) => {
        const card = this.formatSizeApiCard(item)
        lines.push(`  ${i + 1}. ${card.name} (#${card.id}) — ${card.height_label} / ${card.weight_label}`)
      })
    }
    if (candidates.length) {
      if (lines.length) lines.push('')
      lines.push(`🔍 范围匹配 ${condStr} 的精灵（共 ${candidates.length} 只）：`)
      candidates.slice(0, 10).forEach((item: any, i: number) => {
        const card = this.formatSizeApiCard(item)
        lines.push(`  ${i + 1}. ${card.name} (#${card.id}) — ${card.height_label} / ${card.weight_label}`)
      })
    }
    return lines.join('\n')
  }

  buildEggSearchText(heightMeters?: number, weight?: number, results?: any, heightDisplay?: string): string {
    const cond: string[] = []
    if (heightMeters != null) cond.push(`身高=${heightDisplay || `${formatNumber(heightMeters)}m`}`)
    if (weight != null) cond.push(`体重=${weight}kg`)
    const condStr = cond.join(' + ') || '当前条件'
    const items = Array.isArray(results?.items) ? results.items : []
    if (!items.length) return `❌ 未找到符合 ${condStr} 的精灵。`

    const total = results?.total ?? items.length
    const lines = [`✅ 符合 ${condStr} 的精灵（共 ${total} 只）：`]
    items.slice(0, 10).forEach((item: any, index: number) => {
      lines.push(`  ${index + 1}. ${this.formatEggSearchTextLine(item)}`)
    })
    if (results?.has_more) {
      lines.push(`  ... 还有更多结果，可尝试更精确的尺寸或等待后续分页支持。`)
    }
    return lines.join('\n')
  }

  buildSearchText(pet: any): string {
    const egs = this.getEggGroups(pet)
    const compat = this.getCompatiblePets(pet)
    const lines = [
      `🥚 ${petName(pet)} (#${pet.id})`,
      `属性：${petType(pet)}`,
      `蛋组：${formatEggGroups(egs)}`,
      `可配种精灵数：${compat.length}`,
    ]
    if (egs.includes(1)) lines.push('⚠️ 该精灵属于「未发现」蛋组，无法配种。')
    return lines.join('\n')
  }

  buildCandidatesText(keyword: string, candidates: any[]): string {
    const lines = [`🔍 「${keyword}」匹配到 ${candidates.length} 只精灵，请精确输入：`]
    candidates.slice(0, 10).forEach((p, i) => {
      lines.push(`  ${i + 1}. ${petName(p)} (#${p.id}) — ${petType(p)} · ${formatEggGroups(this.getEggGroups(p))}`)
    })
    if (candidates.length > 10) lines.push(`  ... 还有 ${candidates.length - 10} 个结果`)
    return lines.join('\n')
  }

  buildWantPetText(pet: any): string {
    const zh = petName(pet)
    const egs = this.getEggGroups(pet)
    const lines = [`🥚 想要孵出「${zh}」：`, `蛋组：${formatEggGroups(egs)}`]
    if (egs.includes(1)) {
      lines.push('⚠️ 该精灵属于「未发现」蛋组，无法通过配种获得。')
      return lines.join('\n')
    }
    lines.push(`\n📌 母体必须是「${zh}」（孵蛋结果跟随母体）`)
    const fathers = this.getBreedingParents(pet)
    if (fathers.length) {
      lines.push(`\n🔗 可选父体（共 ${fathers.length} 只）：`)
      fathers.slice(0, 15).forEach((f, i) => {
        lines.push(`  ${i + 1}. ${petName(f)} — ${formatEggGroups(this.getEggGroups(f))}`)
      })
      if (fathers.length > 15) lines.push(`  ... 还有 ${fathers.length - 15} 只`)
    } else {
      lines.push('\n❌ 未找到可配种的父体精灵。')
    }
    return lines.join('\n')
  }

  buildPairText(a: any, b: any): string {
    const ev = this.evaluatePair(a, b)
    const ma = petName(a), fa = petName(b)
    if (ev.compatible) {
      return `✅ 父体 ${fa} × 母体 ${ma} 可以配种！\n共享蛋组：${ev.shared_egg_group_labels.join(' / ')}\n孵出结果：${ma}（跟随母体）\n孵化时长：${ev.hatch_label}`
    }
    return `❌ ${fa} × ${ma} 无法配种。\n原因：${ev.reasons.join('；')}`
  }

  // ─── 渲染数据构建 ───

  buildSearchData(pet: any) {
    const egs = this.getEggGroups(pet)
    const compat = this.getCompatiblePets(pet)
    const gmap: Record<number, any[]> = {}
    for (const gid of egs) if (gid !== 1) gmap[gid] = []
    for (const c of compat) {
      for (const gid of egs) {
        if (gid !== 1 && this.getEggGroups(c).includes(gid)) {
          gmap[gid] = gmap[gid] || []
          gmap[gid].push(c)
        }
      }
    }
    const sections = egs.map(gid => {
      const meta = EGG_GROUP_META[gid]
      const members = gmap[gid] || []
      return {
        id: gid,
        label: meta?.label || `蛋组${gid}`,
        desc: meta?.desc || '',
        count: members.length,
        members: members.slice(0, 30).map(m => ({
          name: petName(m), id: m.id,
          type_label: petType(m),
          egg_groups_label: formatEggGroups(this.getEggGroups(m)),
        })),
        has_more: members.length > 30,
        total: members.length,
      }
    })
    const br = pet.breeding || {}
    const bp = pet.breeding_profile || {}
    const eggDetails = this.buildEggDetails(br)
    return {
      pet_name: petName(pet), pet_id: pet.id,
      pet_icon: petIconUrl(pet.id), pet_image: petImageUrl(pet.id),
      type_label: petType(pet),
      egg_groups_label: formatEggGroups(egs),
      egg_groups: egs,
      egg_group_labels: Object.fromEntries(egs.map(gid => [gid, getEggGroupLabel(gid)])),
      male_rate: bp.male_rate ?? null,
      female_rate: bp.female_rate ?? null,
      hatch_label: fmtDur(br.hatch_data),
      weight_label: fmtRange(wt(br.weight_low), wt(br.weight_high), 'kg'),
      height_label: fmtRange(br.height_low, br.height_high, 'cm'),
      total_compatible: compat.length,
      is_undiscovered: egs.includes(1),
      egg_group_sections: sections,
      total_stats: ['base_hp', 'base_phy_atk', 'base_mag_atk', 'base_phy_def', 'base_mag_def', 'base_spd']
        .reduce((sum, k) => sum + (pet[k] || 0), 0),
      egg_details: eggDetails,
      commandHint: '洛克查蛋 <名称> | 洛克查蛋 身高25 体重1.5 | 洛克配种 <父> <母>',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildPairData(a: any, b: any) {
    const ev = this.evaluatePair(a, b)
    const makePetCard = (p: any) => ({
      name: petName(p), id: p.id,
      type_label: petType(p),
      egg_groups_label: formatEggGroups(this.getEggGroups(p)),
    })
    return {
      mother: makePetCard(a),
      father: makePetCard(b),
      ...ev,
      commandHint: '默认前父后母，孵蛋结果跟随母体 | 洛克配种 <精灵名> 查怎么孵',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildWantPetData(pet: any) {
    const fathers = this.getBreedingParents(pet)
    const bp = pet.breeding_profile || {}
    const eggGroups = this.getEggGroups(pet)
    return {
      target: this.formatPetCard(pet),
      egg_groups_label: formatEggGroups(eggGroups),
      female_rate: bp.female_rate ?? null,
      male_rate: bp.male_rate ?? null,
      is_undiscovered: eggGroups.includes(1),
      fathers: fathers.slice(0, 30).map(p => this.formatPetCard(p)),
      father_count: fathers.length,
      commandHint: '洛克配种 <父体> <母体> 查看详细结果',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildCandidatesRenderData(keyword: string, candidates: any[]) {
    return {
      keyword,
      count: candidates.length,
      candidates: candidates.map(p => this.formatPetCard(p)),
      commandHint: '请使用更精确的名称重新查询',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildSizeSearchData(height?: number, weight?: number, results?: { perfect: any[]; range: any[] }, heightDisplay?: string) {
    const conditions: string[] = []
    if (height != null) conditions.push(`身高 ${heightDisplay || fmtRange(ht(height), ht(height), 'm')}`)
    if (weight != null) conditions.push(`体重 ${weight} kg`)
    const [perfect, ranged] = this.mergeCardsByName(
      (results?.perfect || []).map(p => this.formatPetCard(p, height, weight)),
      (results?.range || []).map(p => this.formatPetCard(p, height, weight)),
    )
    return {
      query_label: conditions.join(' / ') || '尺寸反查',
      perfect_matches: perfect,
      range_matches: ranged,
      total_count: perfect.length + ranged.length,
      has_results: !!(perfect.length || ranged.length),
      commandHint: '洛克查蛋 <精灵名> | 洛克查蛋 身高25 体重1.5',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildSizeSearchDataFromApi(height?: number, weight?: number, results?: any, heightDisplay?: string) {
    const conditions: string[] = []
    if (height != null) conditions.push(`身高 ${heightDisplay || fmtRange(ht(height), ht(height), 'm')}`)
    if (weight != null) conditions.push(`体重 ${weight} kg`)
    const [perfect, ranged] = this.mergeCardsByName(
      (results?.exactResults || []).map((item: any) => this.formatSizeApiCard(item)),
      (results?.candidates || []).map((item: any) => this.formatSizeApiCard(item)),
    )
    const searchMode = results?.searchMode || ''
    const queryLabel = `${conditions.join(' / ') || '尺寸反查'}${searchMode ? ` · 模式 ${searchMode}` : ''}`
    return {
      query_label: queryLabel,
      perfect_matches: perfect,
      range_matches: ranged,
      total_count: perfect.length + ranged.length,
      has_results: !!(perfect.length || ranged.length),
      commandHint: '洛克查蛋 <精灵名> | 洛克查蛋 0.18m 1.5kg | 洛克查蛋 0.18',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  buildEggSearchData(heightMeters?: number, weight?: number, results?: any, heightDisplay?: string) {
    const conditions: string[] = []
    if (heightMeters != null) conditions.push(`身高 ${heightDisplay || `${formatNumber(heightMeters)} m`}`)
    if (weight != null) conditions.push(`体重 ${weight} kg`)
    const cards = (Array.isArray(results?.items) ? results.items : []).map((item: any) => this.formatEggSearchCard(item))
    const pageNo = num(results?.page_no)
    const totalPages = num(results?.total_pages)
    const pageLabel = pageNo && totalPages ? ` · 第 ${pageNo}/${totalPages} 页` : ''

    return {
      query_label: `${conditions.join(' / ') || '孵蛋反查'}${pageLabel}`,
      perfect_matches: cards,
      range_matches: [],
      total_count: results?.total ?? cards.length,
      has_results: cards.length > 0,
      commandHint: '洛克查蛋 <精灵名> | 洛克查蛋 0.18m 1.5kg | 洛克配种 <父体> <母体>',
      copyright: 'Koishi & WeGame 洛克王国插件',
    }
  }

  private buildEggDetails(breeding: any) {
    if (!breeding) return { has_data: false }
    const baseProb = breeding.egg_base_glass_prob_array
    const addProb = breeding.egg_add_glass_prob_array
    const preciousMap: Record<number, string> = {
      1: '迪莫蛋', 2: '星辰蛋', 3: '彩虹蛋', 4: '梦幻蛋', 5: '传说蛋', 6: '神秘蛋', 7: '特殊蛋',
    }
    const variants = (breeding.variants || []).map((v: any) => ({
      id: v.id, name: v.name || '',
      hatch_label: fmtDur(v.hatch_data),
      weight_label: fmtRange(wt(v.weight_low), wt(v.weight_high), 'kg'),
      height_label: fmtRange(v.height_low, v.height_high, 'cm'),
      precious_egg_type: v.precious_egg_type,
      precious_egg_label: preciousMap[v.precious_egg_type] || '普通蛋',
      base_prob_str: v.egg_base_glass_prob_array?.length === 2
        ? `${v.egg_base_glass_prob_array[0]}/${v.egg_base_glass_prob_array[1]}` : '暂无',
    }))
    return {
      has_data: true,
      base_prob_str: baseProb?.length === 2 ? `${baseProb[0]}/${baseProb[1]}` : '暂无数据',
      base_prob_pct: baseProb?.length === 2 ? (baseProb[0] / baseProb[1]) * 100 : null,
      add_prob_str: addProb?.length === 2 ? `${addProb[0]}/${addProb[1]}` : '暂无数据',
      add_prob_pct: addProb?.length === 2 ? (addProb[0] / addProb[1]) * 100 : null,
      is_contact_add_glass: breeding.is_contact_add_glass_prob,
      is_contact_add_shining: breeding.is_contact_add_shining_prob,
      precious_egg_type: breeding.precious_egg_type,
      precious_egg_label: preciousMap[breeding.precious_egg_type] || '普通蛋',
      variants,
      variant_count: variants.length,
    }
  }
}
