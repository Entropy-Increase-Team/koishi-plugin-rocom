import { Context, Logger } from 'koishi'

const logger = new Logger('rocom-client')

export class RocomClient {
  private baseUrl: string
  private apiKey: string
  private timeout: number

  constructor(baseUrl: string, apiKey: string, timeout = 15000) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.timeout = timeout
  }

  private sanitizeUid(uid: string): string {
    if (!uid) return ''
    return uid.trim().replace(/[^a-zA-Z0-9_\- \u4e00-\u9fa5]/g, '').trim()
  }

  private wegameHeaders(fwToken = '', userIdentifier = '', clientType = '', clientId = ''): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.apiKey) headers['X-API-Key'] = this.apiKey
    if (fwToken) headers['X-Framework-Token'] = fwToken
    if (userIdentifier) headers['X-User-Identifier'] = this.sanitizeUid(userIdentifier)
    if (clientType) headers['X-Client-Type'] = clientType
    if (clientId) headers['X-Client-ID'] = clientId
    return headers
  }

  private rocomHeaders(fwToken: string, userIdentifier = ''): Record<string, string> {
    const headers: Record<string, string> = { 'X-Framework-Token': fwToken }
    if (this.apiKey) headers['X-API-Key'] = this.apiKey
    if (userIdentifier) headers['X-User-Identifier'] = this.sanitizeUid(userIdentifier)
    return headers
  }

  private formatHttpError(e: unknown): string {
    const err = e as any
    const response = err?.response
    if (response) {
      const body = response.data
      const bodyMessage =
        body && typeof body === 'object'
          ? body.message || body.msg || body.error || JSON.stringify(body)
          : body
      const prefix = response.status ? `HTTP ${response.status}` : 'HTTP error'
      return bodyMessage ? `${prefix}: ${bodyMessage}` : `${prefix}: ${response.statusText || err?.message || 'unknown'}`
    }
    return err?.message || String(e)
  }

  private isSensitiveLogKey(key: string): boolean {
    return /api[-_]?key|authorization|cookie|framework[-_]?token|password|secret|ticket|token/i.test(key)
  }

  private maskSensitiveValue(value: unknown): unknown {
    if (typeof value !== 'string') return value
    if (!value) return value
    if (value.length <= 8) return '***'
    return `${value.slice(0, 4)}...${value.slice(-4)}`
  }

  private sanitizeForLog(value: unknown, key = ''): unknown {
    if (this.isSensitiveLogKey(key)) return this.maskSensitiveValue(value)
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => this.sanitizeForLog(item))

    const result: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[entryKey] = this.sanitizeForLog(entryValue, entryKey)
    }
    return result
  }

  private headersForLog(headers: unknown): unknown {
    if (!headers || typeof headers !== 'object') return headers
    const iterableHeaders = headers as any
    if (typeof iterableHeaders.forEach === 'function') {
      const result: Record<string, unknown> = {}
      iterableHeaders.forEach((value: unknown, key: string) => {
        result[key] = this.sanitizeForLog(value, key)
      })
      return result
    }
    return this.sanitizeForLog(headers)
  }

  private stringifyForLog(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  private logRequestFailureDetails(
    method: string,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any> | undefined,
    body: unknown,
    errorOrResponse: unknown,
  ) {
    const err = errorOrResponse as any
    const response = err?.response
    const details = {
      request: {
        method,
        url: `${this.baseUrl}${path}`,
        path,
        params: this.sanitizeForLog(params),
        body: this.sanitizeForLog(body),
        headers: this.sanitizeForLog(headers),
        timeout: this.timeout,
      },
      response: response ? {
        status: response.status,
        statusText: response.statusText,
        headers: this.headersForLog(response.headers),
        body: this.sanitizeForLog(response.data),
      } : undefined,
      apiResponse: response ? undefined : this.sanitizeForLog(errorOrResponse),
      error: response || err?.message || err?.stack ? {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
      } : undefined,
    }
    console.warn(`[rocom-client] ${method} ${path} detailed failure\n${this.stringifyForLog(details)}`)
  }

  private async get(
    ctx: Context,
    path: string,
    headers: Record<string, string>,
    params?: Record<string, any>,
    options?: { silentFailureDetails?: boolean },
  ) {
    try {
      const resp: any = await ctx.http.get(`${this.baseUrl}${path}`, {
        headers,
        params,
        timeout: this.timeout,
      })
      if (resp?.code !== 0) {
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        if (!options?.silentFailureDetails) {
          this.logRequestFailureDetails('GET', path, headers, params, undefined, resp)
        }
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      if (!options?.silentFailureDetails) {
        this.logRequestFailureDetails('GET', path, headers, params, undefined, e)
      }
      const err = e as any
      if (err?.response) {
        logger.warn('GET ' + path + ' failed: ' + message)
      } else {
        logger.error('GET ' + path + ' failed: ' + message)
      }
      return null
    }
  }

  private async post(ctx: Context, path: string, headers: Record<string, string>, json?: any, params?: Record<string, any>) {
    try {
      const resp: any = await ctx.http.post(`${this.baseUrl}${path}`, json, {
        headers,
        params,
        timeout: this.timeout,
      })
      if (resp?.code !== 0) {
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        this.logRequestFailureDetails('POST', path, headers, params, json, resp)
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      this.logRequestFailureDetails('POST', path, headers, params, json, e)
      const err = e as any
      if (err?.response) {
        logger.warn('POST ' + path + ' failed: ' + message)
      } else {
        logger.error('POST ' + path + ' failed: ' + message)
      }
      return null
    }
  }

  private async delete(ctx: Context, path: string, headers: Record<string, string>) {
    try {
      const resp: any = await ctx.http("DELETE", `${this.baseUrl}${path}`, { headers, timeout: this.timeout })
      if (resp?.code !== 0) {
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        this.logRequestFailureDetails('DELETE', path, headers, undefined, undefined, resp)
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      this.logRequestFailureDetails('DELETE', path, headers, undefined, undefined, e)
      const err = e as any
      if (err?.response) {
        logger.warn('DELETE ' + path + ' failed: ' + message)
      } else {
        logger.error('DELETE ' + path + ' failed: ' + message)
      }
      return null
    }
  }

  // 登录与绑定相关接口
  async qqQrLogin(ctx: Context, userIdentifier: string) {
    const params: any = { client_type: 'bot', client_id: 'koishi', provider: 'rocom' }
    if (userIdentifier) params.user_identifier = this.sanitizeUid(userIdentifier)
    return this.get(ctx, '/api/v1/login/wegame/qr', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), params)
  }

  async qqQrStatus(ctx: Context, fwToken: string, userIdentifier: string) {
    const params: any = {}
    if (userIdentifier) params.user_identifier = this.sanitizeUid(userIdentifier)
    return this.get(ctx, '/api/v1/login/wegame/status', this.wegameHeaders(fwToken, userIdentifier, 'bot', 'koishi'), params)
  }

  async wechatQrLogin(ctx: Context, userIdentifier: string) {
    const params: any = { client_type: 'bot', client_id: 'koishi', provider: 'rocom' }
    if (userIdentifier) params.user_identifier = this.sanitizeUid(userIdentifier)
    return this.get(ctx, '/api/v1/login/wegame/wechat/qr', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), params)
  }

  async wechatQrStatus(ctx: Context, fwToken: string, userIdentifier: string) {
    const params: any = {}
    if (userIdentifier) params.user_identifier = this.sanitizeUid(userIdentifier)
    return this.get(ctx, '/api/v1/login/wegame/wechat/status', this.wegameHeaders(fwToken, userIdentifier, 'bot', 'koishi'), params)
  }

  async importToken(ctx: Context, tgpId: string, tgpTicket: string, userIdentifier: string) {
    const body: any = { tgp_id: tgpId, tgp_ticket: tgpTicket, provider: 'rocom', client_type: 'bot', client_id: 'koishi' }
    if (userIdentifier) body.user_identifier = this.sanitizeUid(userIdentifier)
    return this.post(ctx, '/api/v1/login/wegame/token', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), body)
  }

  async createBinding(ctx: Context, fwToken: string, userIdentifier: string) {
    const payload = { framework_token: fwToken, user_identifier: this.sanitizeUid(userIdentifier), client_type: 'bot', client_id: 'koishi' }
    return this.post(ctx, '/api/v1/user/bindings', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), payload)
  }

  async refreshBinding(ctx: Context, bindingId: string, userIdentifier: string) {
    return this.post(ctx, `/api/v1/user/bindings/${bindingId}/refresh`, this.wegameHeaders('', userIdentifier), {})
  }

  async deleteBinding(ctx: Context, bindingId: string, userIdentifier: string) {
    const res = await this.delete(ctx, `/api/v1/user/bindings/${bindingId}`, this.wegameHeaders('', userIdentifier))
    return res !== null
  }

  // 洛克王国游戏数据接口
  async getRole(ctx: Context, fwToken: string, accountType?: number, userIdentifier = '') {
    const params: any = {}
    if (accountType) params.account_type = accountType
    return this.get(ctx, '/api/v1/games/rocom/profile/role', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  async getEvaluation(ctx: Context, fwToken: string, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/profile/evaluation',
      this.rocomHeaders(fwToken, userIdentifier),
      undefined,
      { silentFailureDetails: true },
    )
  }

  async getPetSummary(ctx: Context, fwToken: string, userIdentifier = '') {
    return this.get(ctx, '/api/v1/games/rocom/profile/pet-summary', this.rocomHeaders(fwToken, userIdentifier))
  }

  async getCollection(ctx: Context, fwToken: string, userIdentifier = '') {
    return this.get(ctx, '/api/v1/games/rocom/profile/collection', this.rocomHeaders(fwToken, userIdentifier))
  }

  async getBattleOverview(ctx: Context, fwToken: string, userIdentifier = '') {
    return this.get(ctx, '/api/v1/games/rocom/profile/battle-overview', this.rocomHeaders(fwToken, userIdentifier))
  }

  async getBattleList(ctx: Context, fwToken: string, pageSize = 4, afterTime = '', userIdentifier = '') {
    const params: any = { page_size: pageSize }
    if (afterTime) params.after_time = afterTime
    return this.get(ctx, '/api/v1/games/rocom/battle/list', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  private isIngamePlayerPayload(data: any): boolean {
    if (!data || typeof data !== 'object') return false
    return Boolean(
      Array.isArray(data.rows)
      || Array.isArray(data.notes)
      || data.title
      || data.nickname
      || data.uid
    )
  }

  async ingamePlayerSearch(ctx: Context, uid: string) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid) return null

    const path = '/api/v1/games/rocom/ingame/player/search'
    const headers = this.wegameHeaders()
    const payload = { uid: sanitizedUid, wait_ms: 5000 }

    let data = await this.post(ctx, path, headers, payload)
    if (!data) {
      data = await this.get(ctx, path, headers, { uid: sanitizedUid, wait_ms: 5000 }, { silentFailureDetails: true })
    }
    if (!data) return null
    if (this.isIngamePlayerPayload(data)) return data

    const taskId = data.task_id || data.taskId || data.taskID
    if (!taskId) return data

    for (let i = 0; i < 8; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const taskData = await this.get(
        ctx,
        `/api/v1/games/rocom/ingame/tasks/${taskId}`,
        headers,
        undefined,
        { silentFailureDetails: true },
      )
      if (!taskData) return null
      if (this.isIngamePlayerPayload(taskData)) return taskData
    }

    return null
  }

  async getPets(ctx: Context, fwToken: string, petSubset = 0, pageNo = 1, pageSize = 10, userIdentifier = '') {
    const params = { pet_subset: petSubset, page_no: pageNo, page_size: pageSize }
    return this.get(ctx, '/api/v1/games/rocom/battle/pets', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  async getLineupList(ctx: Context, fwToken: string, pageNo = 1, category = '', userIdentifier = '') {
    const params: any = { page_no: pageNo }
    if (category) params.category = category
    return this.get(ctx, '/api/v1/games/rocom/lineup/list', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  async getExchangePosters(ctx: Context, fwToken: string, pageNo = 1, userIdentifier = '') {
    const params = { page_no: Math.max(pageNo, 1), refresh: 'false' }
    return this.get(ctx, '/api/v1/games/rocom/exchange/posters', this.wegameHeaders(fwToken, userIdentifier), params)
  }

  async getMerchantInfo(ctx: Context, refresh = false) {
    return this.get(ctx, '/api/v1/games/rocom/merchant/info', this.wegameHeaders(), { refresh: refresh ? 'true' : 'false' })
  }

  async queryPetSize(ctx: Context, diameter: number, weight: number) {
    return this.get(ctx, '/api/v1/games/rocom/pet/size-query', this.wegameHeaders(), { diameter, weight })
  }

  async searchWikiPet(ctx: Context, query: string, limit = 10) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/pet', this.wegameHeaders(), { q: query, limit })
  }

  async searchWikiSkill(ctx: Context, query: string, limit = 10) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/skill', this.wegameHeaders(), { q: query, limit })
  }
}
