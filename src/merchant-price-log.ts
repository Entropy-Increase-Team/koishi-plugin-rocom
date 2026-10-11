import { Logger } from 'koishi'
import fs from 'node:fs'
import path from 'node:path'

const logger = new Logger('rocom-merchant')

// 实时接口只返回当前轮次的商品价格，轮次一过就拿不到了；
// 旧接口 random_goods[].price 恒为 0。把每轮观察到的实时价格按 goods_id + 轮次
// 记下来，供当天后续轮次补价。按游戏内自然日（Asia/Shanghai）分桶，跨天自动清空。

const chinaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function merchantPriceDateKey(date = new Date()): string {
  return chinaDateFormatter.format(date)
}

export interface MerchantPriceSnapshot {
  price: number
  origin_price: number
  buy_limit_num: number
  at: string
}

export interface MerchantPriceEntry {
  goods_id: number
  name: string
  item_id: number
  item_num: number
  buy_limit_num: number
  by_round: Record<string, MerchantPriceSnapshot>
  price: number
  origin_price: number
  round: number
}

export interface MerchantPriceLogItem {
  goods_id: number
  name: string
  goods_name?: string
  item_id?: unknown
  item_num?: unknown
  buy_limit_num?: unknown
  limit_buy_num?: unknown
  price?: unknown
  origin_price?: unknown
}

export interface MerchantPriceLookup {
  goods_id: number
  name: string
  price: number
  origin_price: number
  buy_limit_num: number
  item_id: number
  item_num: number
  round: number
}

interface PriceLogState {
  date: string
  updated_at: string
  items: Record<string, MerchantPriceEntry>
}

function toPositiveNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function toWholeNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

export class MerchantPriceLog {
  private state: PriceLogState | null = null

  constructor(private filePath: string) {}

  /** 读盘；日期不是今天就当作已清空（游戏内自然日滚动）。 */
  load(now = new Date()): PriceLogState {
    const today = merchantPriceDateKey(now)

    if (this.state && this.state.date === today) return this.state

    let raw: any = null
    try {
      if (fs.existsSync(this.filePath)) {
        raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      }
    } catch (error) {
      logger.warn(`读取远行商人价格记录失败: ${error}`)
    }

    if (!raw || typeof raw !== 'object' || raw.date !== today) {
      this.state = { date: today, updated_at: '', items: {} }
      if (raw && raw.date !== today) this.save(now)
      return this.state
    }

    this.state = {
      date: today,
      updated_at: trimText(raw.updated_at),
      items: raw.items && typeof raw.items === 'object' ? raw.items : {},
    }
    return this.state
  }

  save(now = new Date()) {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const payload = {
        date: this.state?.date || merchantPriceDateKey(now),
        updated_at: new Date().toISOString(),
        items: this.state?.items || {},
      }
      this.state = payload
      const tempPath = `${this.filePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8')
      fs.renameSync(tempPath, this.filePath)
    } catch (error) {
      logger.warn(`写入远行商人价格记录失败: ${error}`)
    }
  }

  /** 记录一批实时商品（价格 <= 0 的跳过，避免把无效值写进去）。 */
  record(goods: MerchantPriceLogItem[], options: { now?: Date, round?: number } = {}): boolean {
    const now = options.now instanceof Date ? options.now : new Date()
    const state = this.load(now)
    const round = toWholeNumber(options.round)
    let changed = false

    for (const item of Array.isArray(goods) ? goods : []) {
      const goodsId = toWholeNumber(item?.goods_id)
      const price = toPositiveNumber(item?.price)
      if (!goodsId || price <= 0) continue

      const key = String(goodsId)
      const entry: MerchantPriceEntry = state.items[key] || {
        goods_id: goodsId,
        name: trimText(item?.goods_name),
        item_id: toWholeNumber(item?.item_id),
        item_num: toWholeNumber(item?.item_num) || 1,
        buy_limit_num: toWholeNumber(item?.buy_limit_num ?? item?.limit_buy_num),
        by_round: {},
        price: 0,
        origin_price: 0,
        round: 0,
      }

      if (!entry.name && item?.goods_name) entry.name = trimText(item.goods_name)
      if (!entry.item_id && item?.item_id) entry.item_id = toWholeNumber(item.item_id)
      if (!entry.item_num && item?.item_num) entry.item_num = toWholeNumber(item.item_num) || 1
      const limitNum = toWholeNumber(item?.buy_limit_num ?? item?.limit_buy_num)
      if (!entry.buy_limit_num && limitNum) entry.buy_limit_num = limitNum

      const snapshot: MerchantPriceSnapshot = {
        price,
        origin_price: toPositiveNumber(item?.origin_price) || price,
        buy_limit_num: limitNum || entry.buy_limit_num || 0,
        at: now.toISOString(),
      }

      entry.by_round[String(round)] = snapshot
      // 顶层存最近一次观察到的价格，供没有轮次命中的商品兜底。
      entry.price = snapshot.price
      entry.origin_price = snapshot.origin_price
      entry.round = round || entry.round
      state.items[key] = entry
      changed = true
    }

    if (changed) this.save(now)
    return changed
  }

  /** 按 goods_id（优先同名轮次）查当天记录，查不到再退回商品名。 */
  lookup(goodsId: unknown, name = '', round = 0, now = new Date()): MerchantPriceLookup | null {
    const items = this.load(now).items || {}

    const fromEntry = (entry: MerchantPriceEntry | undefined): MerchantPriceLookup | null => {
      if (!entry) return null
      const byRound = entry.by_round || {}
      const matched = byRound[String(toWholeNumber(round))]
      const source = matched || { price: entry.price, origin_price: entry.origin_price, buy_limit_num: entry.buy_limit_num, at: '' }
      const price = toPositiveNumber(source?.price)
      if (price <= 0) return null

      return {
        goods_id: toWholeNumber(entry.goods_id),
        name: trimText(entry.name),
        price,
        origin_price: toPositiveNumber(source?.origin_price) || price,
        buy_limit_num: toWholeNumber(source?.buy_limit_num) || toWholeNumber(entry.buy_limit_num),
        item_id: toWholeNumber(entry.item_id),
        item_num: toWholeNumber(entry.item_num) || 1,
        round: toWholeNumber(round) || toWholeNumber(entry.round),
      }
    }

    const normalizedId = toWholeNumber(goodsId)
    if (normalizedId > 0) {
      const direct = fromEntry(items[String(normalizedId)])
      if (direct) return direct
    }

    const normalizedName = trimText(name)
    if (!normalizedName) return null

    for (const entry of Object.values(items)) {
      if (trimText(entry?.name) === normalizedName) {
        const found = fromEntry(entry)
        if (found) return found
      }
    }

    return null
  }

  /** 调试 / 测试用：当前记录快照。 */
  snapshot() {
    return JSON.parse(JSON.stringify(this.load()))
  }

  clear(now = new Date()) {
    this.state = { date: merchantPriceDateKey(now), updated_at: '', items: {} }
    this.save(now)
  }
}
