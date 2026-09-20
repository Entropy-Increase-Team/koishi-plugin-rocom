import { Logger } from 'koishi'
import fs from 'node:fs'
import path from 'node:path'

const logger = new Logger('rocom-user')

export interface Binding {
  binding_id: string
  login_type: string
  role_id: string
  nickname: string
  bind_time: number
  is_primary: boolean
}

export interface MerchantSubscription {
  group_id: string
  channel_id?: string
  platform?: string
  self_id?: string
  user_id?: string
  type?: string
  mention_all: boolean
  match_all?: boolean
  items: string[]
  last_push_round: string | null
  last_matched_items: string[]
  updated_by: string
}

export interface HomeSubscription {
  key: string
  kind: 'garden' | 'inspiration' | 'egg'
  uid: string
  channel_id?: string
  platform?: string
  self_id?: string
  notify_user_id?: string
  nickname?: string
  guild_id?: string
  user_id?: string
  updated_by: string
  notify_state: {
    first?: boolean
    all?: boolean
  }
  updated_at: number
  last_push_time?: number
}

class JsonStore<T> {
  private filePath: string
  private data: T

  constructor(dataDir: string, filename: string, defaultData: T) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, filename)
    this.data = this.load(defaultData)
  }

  private load(defaultData: T): T {
    if (fs.existsSync(this.filePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      } catch (e) {
        logger.error(`加载 ${this.filePath} 失败: ${e}`)
      }
    }
    return JSON.parse(JSON.stringify(defaultData))
  }

  save() {
    try {
      const tmp = this.filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch (e) {
      logger.error(`保存 ${this.filePath} 失败: ${e}`)
    }
  }

  get(): T { return this.data }
  set(data: T) { this.data = data; this.save() }
}

export class UserManager {
  private store: JsonStore<Record<string, Binding[]>>

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, 'rocom_bindings.json', {})
  }

  getUserBindings(userId: string): Binding[] {
    return [...(this.store.get()[userId] || [])]
  }

  getPrimaryBinding(userId: string): Binding | null {
    const bindings = this.getUserBindings(userId)
    return bindings.find(b => b.is_primary) || bindings[0] || null
  }

  saveUserBindings(userId: string, bindings: Binding[]) {
    const seen = new Set<string>()
    const cleaned = bindings
      .map((binding) => {
        const { framework_token: _frameworkToken, ...rest } = binding as Binding & { framework_token?: string }
        return rest
      })
      .filter((binding) => {
        const id = binding.binding_id || binding.role_id
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })

    if (cleaned.length > 0 && !cleaned.some(b => b.is_primary)) {
      cleaned[0].is_primary = true
    }

    const data = this.store.get()
    data[userId] = cleaned
    this.store.set(data)
  }

  addBinding(userId: string, binding: Binding) {
    const existing = this.getUserBindings(userId)
    existing.forEach(b => b.is_primary = false)
    binding.is_primary = true
    existing.push(binding)
    this.saveUserBindings(userId, existing)
  }

  deleteUserBinding(userId: string, index: number): Binding | null {
    const bindings = this.getUserBindings(userId)
    if (index < 1 || index > bindings.length) return null
    const removed = bindings.splice(index - 1, 1)[0]
    this.saveUserBindings(userId, bindings)
    return removed
  }

  switchPrimary(userId: string, index: number): boolean {
    const bindings = this.getUserBindings(userId)
    if (index < 1 || index > bindings.length) return false
    bindings.forEach((b, i) => b.is_primary = (i + 1 === index))
    this.saveUserBindings(userId, bindings)
    return true
  }

  removeBindingById(userId: string, bindingId: string): boolean {
    const data = this.store.get()
    const bindings = data[userId] || []
    const filtered = bindings.filter(b => b.binding_id !== bindingId)
    if (filtered.length < bindings.length) {
      data[userId] = filtered
      this.store.set(data)
      return true
    }
    return false
  }

  getAllUsersBindings(): Record<string, Binding[]> {
    return JSON.parse(JSON.stringify(this.store.get()))
  }
}

export class MerchantSubscriptionManager {
  private store: JsonStore<Record<string, MerchantSubscription>>

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, 'rocom_merchant_subscriptions.json', {})
  }

  upsert(key: string, sub: MerchantSubscription) {
    const data = this.store.get()
    data[key] = { ...sub }
    this.store.set(data)
  }

  get(key: string): MerchantSubscription | null {
    return this.store.get()[key] || null
  }

  delete(key: string): boolean {
    const data = this.store.get()
    if (!(key in data)) return false
    delete data[key]
    this.store.set(data)
    return true
  }

  getAll(): Record<string, MerchantSubscription> {
    return JSON.parse(JSON.stringify(this.store.get()))
  }
}

export class HomeSubscriptionManager {
  private store: JsonStore<Record<string, HomeSubscription>>

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, 'rocom_home_subscriptions.json', {})
  }

  upsert(key: string, sub: HomeSubscription) {
    const data = this.store.get()
    data[key] = { ...sub }
    this.store.set(data)
  }

  deleteMatching(target: { platform?: string, channelId?: string, userId?: string }, kind = '', uid = '') {
    const data = this.store.get()
    let deleted = 0
    for (const [key, sub] of Object.entries(data)) {
      const sameTarget = sub.platform === target.platform
        && (sub.channel_id || '') === (target.channelId || '')
        && (sub.user_id || '') === (target.userId || '')
      if (!sameTarget) continue
      if (kind && sub.kind !== kind) continue
      if (uid && sub.uid !== uid) continue
      delete data[key]
      deleted++
    }
    if (deleted) this.store.set(data)
    return deleted
  }

  getAll(): Record<string, HomeSubscription> {
    return JSON.parse(JSON.stringify(this.store.get()))
  }
}

export interface AnnouncementSubscription {
  key: string
  platform?: string
  self_id?: string
  channel_id?: string
  guild_id?: string
  user_id?: string
  updated_by: string
  last_id?: string
  since_ts?: number
  updated_at: number
}

export class AnnouncementSubscriptionManager {
  private store: JsonStore<Record<string, AnnouncementSubscription>>

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, 'rocom_announcement_subscriptions.json', {})
  }

  upsert(key: string, sub: AnnouncementSubscription) {
    const data = this.store.get()
    data[key] = { ...sub }
    this.store.set(data)
  }

  deleteMatching(target: { platform?: string, channelId?: string, userId?: string }) {
    const data = this.store.get()
    let deleted = 0
    for (const [key, sub] of Object.entries(data)) {
      const sameTarget = sub.platform === target.platform
        && (sub.channel_id || '') === (target.channelId || '')
        && (sub.user_id || '') === (target.userId || '')
      if (!sameTarget) continue
      delete data[key]
      deleted++
    }
    if (deleted) this.store.set(data)
    return deleted
  }

  getAll(): Record<string, AnnouncementSubscription> {
    return JSON.parse(JSON.stringify(this.store.get()))
  }
}
