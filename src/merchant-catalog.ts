import { Logger } from 'koishi'
import fs from 'node:fs'
import path from 'node:path'

const logger = new Logger('rocom-merchant')

// 上游 WeGame rocom：把后端商品池（merchant/info?random_goods=all）归一成带序号的目录，
// 供「商人商品」列表展示与「订阅远行商人 1 3 5」按序号订阅使用。

// 商品池变化很慢，内存缓存 6 小时，避免订阅轮询反复拉全量。
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000

// 「全物品订阅」的写法。
export const MERCHANT_ALL_ALIASES = new Set(['全部', '全物品', '全部物品', '所有', '所有物品', 'all', '*'])

export interface MerchantCatalogItem {
  index: number
  name: string
  goods_id: number
  item_id: number
  item_num: number
}

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

function toWholeNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

export function isAllAlias(token = ''): boolean {
  return MERCHANT_ALL_ALIASES.has(trimText(token).toLowerCase())
}

/**
 * 把后端商品池归一成带序号的目录。
 *
 * 序号只取后端返回的顺序（index = 位置 + 1），解析订阅时立刻换成商品名落盘，
 * 所以后端调整目录顺序不会影响已有订阅。
 */
export function buildMerchantCatalog(randomGoods: unknown): MerchantCatalogItem[] {
  const items: MerchantCatalogItem[] = []
  const seen = new Set<string>()

  for (const raw of Array.isArray(randomGoods) ? randomGoods : []) {
    const name = trimText((raw as any)?.goods_name)
    if (!name || seen.has(name)) continue
    seen.add(name)

    items.push({
      index: items.length + 1,
      name,
      goods_id: toWholeNumber((raw as any)?.id),
      item_id: toWholeNumber((raw as any)?.item_id),
      item_num: toWholeNumber((raw as any)?.item_num) || 1,
    })
  }

  return items
}

/**
 * 解析用户输入：序号 / 商品名 / 全部。
 *
 * - 纯数字按序号查目录，命中后换成规范名
 * - 目录里没有的文字按原样保留（后端随时会加新商品），同时记进 unrecognizedNames 供提示
 * - 目录为空（离线）时不报未识别，避免误伤
 */
export function resolveMerchantSelection(input: unknown, catalog: MerchantCatalogItem[]) {
  const list = Array.isArray(input) ? input : [input]
  const items = Array.isArray(catalog) ? catalog : []

  const names: string[] = []
  const seen = new Set<string>()
  const unknownIndexes: string[] = []
  const unrecognizedNames: string[] = []
  let all = false

  const pushName = (value: unknown) => {
    const text = trimText(value)
    if (!text || seen.has(text)) return
    seen.add(text)
    names.push(text)
  }

  for (const raw of list) {
    const token = trimText(raw)
    if (!token) continue

    if (isAllAlias(token)) {
      all = true
      continue
    }

    if (/^\d+$/.test(token)) {
      const hit = items.find(item => item.index === Number(token))
      if (hit) pushName(hit.name)
      else unknownIndexes.push(token)
      continue
    }

    const hit = items.find(item => trimText(item.name) === token)
    if (hit) {
      pushName(hit.name)
      continue
    }

    pushName(token)
    if (items.length > 0) unrecognizedNames.push(token)
  }

  return { all, names, unknownIndexes, unrecognizedNames }
}

/** 把订阅的商品名回显成「序号.名称」，方便用户对照商品列表。 */
export function describeMerchantItems(names: unknown, catalog: MerchantCatalogItem[]): string {
  const indexByName = new Map<string, number>()
  for (const item of Array.isArray(catalog) ? catalog : []) {
    const name = trimText(item?.name)
    if (name) indexByName.set(name, item.index)
  }

  return (Array.isArray(names) ? names : [])
    .map((raw) => {
      const name = trimText(raw)
      if (!name) return ''
      const index = indexByName.get(name) || 0
      return index > 0 ? `${index}.${name}` : name
    })
    .filter(Boolean)
    .join('、')
}

export class MerchantCatalogService {
  private memory: { at: number, items: MerchantCatalogItem[] } | null = null

  constructor(
    private filePath: string,
    private fetchRandomGoods: () => Promise<any>,
  ) {}

  /** 同步读磁盘缓存，供命令在离线时兜底。 */
  loadCachedCatalog(): MerchantCatalogItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      const items = Array.isArray(raw?.items) ? raw.items : []
      return items.filter((item: any) => trimText(item?.name))
    } catch {
      return []
    }
  }

  writeCache(items: MerchantCatalogItem[]): boolean {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const payload = {
        updated_at: new Date().toISOString(),
        source: 'merchant/info?random_goods=all',
        items,
      }

      const tempPath = `${this.filePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8')
      fs.renameSync(tempPath, this.filePath)
      return true
    } catch (error) {
      logger.warn(`写入远行商人商品目录失败: ${error}`)
      return false
    }
  }

  /**
   * 取商品目录：内存缓存 → 后端全量商品池 → 磁盘缓存。
   * 全链路失败时返回上一次的目录（可能为空），由调用方决定怎么提示。
   */
  async getCatalog(options: { refresh?: boolean } = {}): Promise<MerchantCatalogItem[]> {
    const now = Date.now()
    const cached = this.memory

    if (!options.refresh && cached && cached.items.length > 0 && now - cached.at < CATALOG_TTL_MS) {
      return JSON.parse(JSON.stringify(cached.items))
    }

    try {
      const payload = await this.fetchRandomGoods()
      const items = buildMerchantCatalog(payload?.random_goods)

      if (items.length > 0) {
        this.memory = { at: now, items }
        this.writeCache(items)
        return JSON.parse(JSON.stringify(items))
      }

      logger.warn('远行商人商品目录为空，沿用本地缓存')
    } catch (error) {
      logger.warn(`拉取远行商人商品目录失败: ${error}`)
    }

    const disk = this.loadCachedCatalog()
    if (disk.length > 0) {
      this.memory = { at: now, items: disk }
      return JSON.parse(JSON.stringify(disk))
    }

    return cached?.items ? JSON.parse(JSON.stringify(cached.items)) : []
  }
}
