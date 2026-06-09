import { Context, Logger } from 'koishi'

const logger = new Logger('rocom-client')

export class RocomClient {
  private baseUrl: string
  private apiKey: string
  private timeout: number
  private lastError = '接口异常'
  private lastErrorBrief = '接口异常'

  constructor(baseUrl: string, apiKey: string, timeout = 15000) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.timeout = timeout
  }

  private sanitizeUid(uid: string): string {
    if (!uid) return ''
    return uid.trim().replace(/[^a-zA-Z0-9_\- \u4e00-\u9fa5]/g, '').trim()
  }

  private wegameHeaders(
    fwToken = '',
    userIdentifier = '',
    clientType = '',
    clientId = '',
    includeApiKey = true,
  ): Record<string, string> {
    const headers: Record<string, string> = {}
    if (includeApiKey && this.apiKey) headers['X-API-Key'] = this.apiKey
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

  private simplifyErrorMessage(message: string): string {
    const raw = String(message || '').replace(/\s+/g, ' ').trim()
    if (!raw) return '接口异常'

    if (/ETIMEDOUT|request timeout|timeout/i.test(raw)) {
      return '请求超时，请稍后重试'
    }
    if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error/i.test(raw)) {
      return '网络连接异常，请稍后重试'
    }
    if (/底层凭证已失效|WeGame 凭证已失效|凭证已失效|token expired|framework token/i.test(raw)) {
      return '登录凭证已失效，请重新登录'
    }
    if (/HTTP\s*5\d\d/i.test(raw)) {
      return '服务暂时不可用，请稍后重试'
    }
    if (/HTTP\s*401/i.test(raw)) {
      return '登录状态失效，请重新登录'
    }
    if (/API[\s_-]*Key/i.test(raw) && /未声明|默认拒绝访问|not declared|not allowed/i.test(raw)) {
      return '接口权限受限，请稍后重试'
    }
    if (/HTTP\s*403/i.test(raw) && !/凭证|登录|token/i.test(raw)) {
      return '权限不足，暂时无法访问该接口'
    }

    const stripped = raw
      .replace(/^HTTP\s*\d+\s*:\s*/i, '')
      .replace(/^(Error|RequestError)\s*:\s*/i, '')
      .trim()
    if (!stripped) return '接口异常'
    return stripped.length > 120 ? `${stripped.slice(0, 117)}...` : stripped
  }

  private shouldRetryIngameWithApiKey(errorMessage: string): boolean {
    if (!this.apiKey) return false
    const message = String(errorMessage || '').trim()
    if (!message) return true

    if (/未声明\s*API\s*Key\s*权限|默认拒绝访问|API\s*Key.*not declared|API\s*Key.*not allowed/i.test(message)) {
      return false
    }

    if (/缺少\s*API\s*Key|API\s*Key.*required|missing\s+api\s*key/i.test(message)) {
      return true
    }

    if (/请提供有效的认证凭证|有效的?认证凭证|valid\s+credentials?\s+required|X-API-Key|Authorization\s*:\s*Bearer|X-Anonymous-Token/i.test(message)) {
      return true
    }

    if (/HTTP\s*(401|403)/i.test(message)) {
      return true
    }

    return false
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
    logger.warn(`${method} ${path} detailed failure\n${this.stringifyForLog(details)}`)
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
        this.setLastError(resp?.message || '接口返回异常')
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        if (!options?.silentFailureDetails) {
          this.logRequestFailureDetails('GET', path, headers, params, undefined, resp)
        }
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      this.setLastError(message)
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
        this.setLastError(resp?.message || '接口返回异常')
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        this.logRequestFailureDetails('POST', path, headers, params, json, resp)
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      this.setLastError(message)
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

  private scopedParams(params: Record<string, any> = {}, userIdentifier = ''): Record<string, any> {
    const result = { ...params }
    if (userIdentifier) result.user_identifier = this.sanitizeUid(userIdentifier)
    return result
  }

  private async delete(ctx: Context, path: string, headers: Record<string, string>, params?: Record<string, any>) {
    try {
      const resp: any = await ctx.http("DELETE", `${this.baseUrl}${path}`, { headers, params, timeout: this.timeout })
      if (resp?.code !== 0) {
        this.setLastError(resp?.message || '接口返回异常')
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        this.logRequestFailureDetails('DELETE', path, headers, params, undefined, resp)
        return null
      }
      return resp?.data ?? {}
    } catch (e) {
      const message = this.formatHttpError(e)
      this.setLastError(message)
      this.logRequestFailureDetails('DELETE', path, headers, params, undefined, e)
      const err = e as any
      if (err?.response) {
        logger.warn('DELETE ' + path + ' failed: ' + message)
      } else {
        logger.error('DELETE ' + path + ' failed: ' + message)
      }
      return null
    }
  }

  // Login and binding APIs.
  private async requestWithStatus(
    ctx: Context,
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    options: {
      params?: Record<string, any>
      json?: any
      acceptedStatuses?: number[]
      silentFailureDetails?: boolean
    } = {},
  ): Promise<{ status: number | null, data: any }> {
    const acceptedStatuses = options.acceptedStatuses || [200]
    try {
      const response: any = await (ctx.http as any)(method, `${this.baseUrl}${path}`, {
        headers,
        params: options.params,
        data: options.json,
        timeout: this.timeout,
        validateStatus: () => true,
      })
      const status = Number(response?.status ?? response?.statusCode ?? 200)
      const body = response?.data !== undefined ? response.data : response
      if (body?.code !== undefined && body.code !== 0) {
        const rawMessage = body.message || body.msg || '接口返回异常'
        const message = !acceptedStatuses.includes(status)
          ? `HTTP ${status}: ${rawMessage}`
          : rawMessage
        this.setLastError(message)
        if (!options.silentFailureDetails) {
          this.logRequestFailureDetails(method, path, headers, options.params, options.json, body)
        }
        return { status: null, data: null }
      }
      const data = body?.code !== undefined ? (body.data ?? {}) : (body ?? {})
      if (!acceptedStatuses.includes(status)) {
        this.setLastError(`HTTP ${status}`)
        if (!options.silentFailureDetails) {
          this.logRequestFailureDetails(method, path, headers, options.params, options.json, response)
        }
        return { status: null, data: null }
      }
      return { status, data }
    } catch (e) {
      const message = this.formatHttpError(e)
      this.setLastError(message)
      if (!options.silentFailureDetails) {
        this.logRequestFailureDetails(method, path, headers, options.params, options.json, e)
      }
      return { status: null, data: null }
    }
  }

  private async requestIngameWithFallback(
    ctx: Context,
    path: string,
    payload: Record<string, any>,
    options: { acceptedStatuses?: number[] } = {},
  ): Promise<{ status: number | null, data: any, usedApiKey: boolean }> {
    const acceptedStatuses = options.acceptedStatuses || [200, 202]
    const requestOnce = async (includeApiKey: boolean, silentFailureDetails: boolean) => {
      const headers = this.wegameHeaders('', '', '', '', includeApiKey)
      let result = await this.requestWithStatus(ctx, 'POST', path, headers, {
        json: payload,
        acceptedStatuses,
        silentFailureDetails,
      })
      if (result.status === null) {
        result = await this.requestWithStatus(ctx, 'GET', path, headers, {
          params: payload,
          acceptedStatuses,
          silentFailureDetails,
        })
      }
      return result
    }

    let result = await requestOnce(false, Boolean(this.apiKey))
    if (result.status !== null) return { ...result, usedApiKey: false }

    if (this.shouldRetryIngameWithApiKey(this.getLastError())) {
      result = await requestOnce(true, false)
      if (result.status !== null) return { ...result, usedApiKey: true }
    }

    return { status: null, data: null, usedApiKey: false }
  }

  private async getIngameTask(ctx: Context, taskId: string, includeApiKey = true) {
    return this.requestWithStatus(
      ctx,
      'GET',
      `/api/v1/games/rocom/ingame/tasks/${taskId}`,
      this.wegameHeaders('', '', '', '', includeApiKey),
      { acceptedStatuses: [200, 202] },
    )
  }

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

  async getAccounts(ctx: Context, userIdentifier = '', accountType?: number) {
    const params: any = this.scopedParams({}, userIdentifier)
    if (accountType !== undefined) params.account_type = accountType
    return this.get(ctx, '/api/v1/games/rocom/accounts', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), params)
  }

  async bindUid(ctx: Context, uid: string, userIdentifier = '') {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!/^\d+$/.test(sanitizedUid)) {
      this.setLastError('UID 必须为纯数字')
      return null
    }
    const params = this.scopedParams({ client_type: 'bot', client_id: 'koishi' }, userIdentifier)
    return this.post(
      ctx,
      '/api/v1/games/rocom/uid/bind',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      { uid: sanitizedUid },
      params,
    )
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

  getLastError(defaultMessage = '接口异常') {
    return this.lastError || defaultMessage
  }

  getLastErrorBrief(defaultMessage = '接口异常') {
    return this.lastErrorBrief || defaultMessage
  }

  private setLastError(message: string) {
    this.lastError = message || '接口异常'
    this.lastErrorBrief = this.simplifyErrorMessage(message)
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
    if (!sanitizedUid) {
      this.setLastError('UID 不能为空')
      return null
    }

    const path = '/api/v1/games/rocom/ingame/player/search'
    const payload = { uid: sanitizedUid, wait_ms: 5000 }
    const { status, data, usedApiKey } = await this.requestIngameWithFallback(ctx, path, payload)
    if (status === 200 && data && this.isIngamePlayerPayload(data)) return data
    if (!data) return null
    if (this.isIngamePlayerPayload(data)) return data

    const taskId = data.task_id || data.taskId || data.taskID
    if (!taskId) {
      if (status === 202) this.setLastError('玩家搜索任务已入队，但未返回 task_id')
      return data
    }

    for (let i = 0; i < 8; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const task = await this.getIngameTask(ctx, taskId, usedApiKey)
      if (task.status === 200) return task.data
      if (task.status === null) return null
    }

    this.setLastError('Player search task is still queued, please retry later (task_id: ' + taskId + ')')
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

  async queryPetSize(ctx: Context, diameter: number, weight: number, sameRideEgg = false, userIdentifier = '') {
    const params: any = this.scopedParams({ diameter, weight }, userIdentifier)
    if (sameRideEgg) params.sameRideEgg = 1
    return this.get(ctx, '/api/v1/games/rocom/pet/size-query', this.wegameHeaders('', userIdentifier, 'bot', 'koishi'), params)
  }

  async getActivitiesInfo(ctx: Context, refresh = false, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/activities/info',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({ refresh: refresh ? 'true' : 'false' }, userIdentifier),
    )
  }

  async syncConfig(ctx: Context, userIdentifier = '') {
    return this.post(
      ctx,
      '/api/v1/games/rocom/config/sync',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      {},
      this.scopedParams({}, userIdentifier),
    )
  }

  async getAnnouncementList(
    ctx: Context,
    params: { category_id?: number | string, page?: number, limit?: number, order?: string } = {},
    userIdentifier = '',
  ) {
    return this.get(
      ctx,
      '/api/v1/games/rocom/announcement/list',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
  }

  async getLatestAnnouncement(
    ctx: Context,
    params: { category_id?: number | string, order?: string } = {},
    userIdentifier = '',
  ) {
    return this.get(
      ctx,
      '/api/v1/games/rocom/announcement/latest',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
  }

  async getAnnouncementDetail(ctx: Context, threadId: number | string, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/announcement/detail',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({ thread_id: threadId }, userIdentifier),
    )
  }

  async getEggSearch(
    ctx: Context,
    height: number,
    weight: number,
    pageNo = 1,
    pageSize = 20,
    userIdentifier = '',
  ) {
    return this.get(
      ctx,
      '/api/v1/games/rocom/egg/search',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({ height, weight, page_no: pageNo, page_size: pageSize }, userIdentifier),
    )
  }

  async getEggGroups(ctx: Context, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/egg/groups',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({}, userIdentifier),
    )
  }

  async getEggGroupPets(
    ctx: Context,
    groupIds: string | number[],
    matchMode: 'any' | 'all' = 'any',
    pageNo = 1,
    pageSize = 20,
    userIdentifier = '',
  ) {
    const normalizedGroupIds = Array.isArray(groupIds) ? groupIds.join(',') : String(groupIds || '')
    return this.get(
      ctx,
      '/api/v1/games/rocom/egg/group-pets',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({ group_ids: normalizedGroupIds, match_mode: matchMode, page_no: pageNo, page_size: pageSize }, userIdentifier),
    )
  }

  async getEggPetGroups(ctx: Context, query: string, limit = 20, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/egg/pet-groups',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({ q: query, limit }, userIdentifier),
    )
  }

  async getEggExchanges(ctx: Context, params: Record<string, any> = {}, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/community/egg-exchanges',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
  }

  async postEggExchange(ctx: Context, data: Record<string, any>, userIdentifier = '') {
    return this.post(
      ctx,
      '/api/v1/games/rocom/community/egg-exchanges',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      data,
      this.scopedParams({}, userIdentifier),
    )
  }

  async getMyEggExchanges(ctx: Context, params: Record<string, any> = {}, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/community/egg-exchanges/my',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
  }

  async getEggExchangeReviewStatus(ctx: Context, postId: string | number, userIdentifier = '') {
    return this.get(
      ctx,
      `/api/v1/games/rocom/community/egg-exchanges/${encodeURIComponent(String(postId))}/review-status`,
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({}, userIdentifier),
    )
  }

  async closeEggExchange(ctx: Context, postId: string | number, closeReason = 'cancel', userIdentifier = '') {
    return this.post(
      ctx,
      `/api/v1/games/rocom/community/egg-exchanges/${encodeURIComponent(String(postId))}/close`,
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      { close_reason: closeReason },
      this.scopedParams({}, userIdentifier),
    )
  }

  async createEggExchangeSubscription(ctx: Context, filters: Record<string, any>, userIdentifier = '') {
    return this.post(
      ctx,
      '/api/v1/games/rocom/community/egg-exchange-subscriptions',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      { filters },
      this.scopedParams({}, userIdentifier),
    )
  }

  async getEggExchangeSubscriptions(ctx: Context, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/community/egg-exchange-subscriptions',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({}, userIdentifier),
    )
  }

  async deleteEggExchangeSubscription(ctx: Context, subscriptionId: string | number, userIdentifier = '') {
    return this.delete(
      ctx,
      `/api/v1/games/rocom/community/egg-exchange-subscriptions/${encodeURIComponent(String(subscriptionId))}`,
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams({}, userIdentifier),
    )
  }

  async getEggExchangeEvents(
    ctx: Context,
    subscriptionId: string | number,
    afterEventId = '',
    limit = 50,
    userIdentifier = '',
  ) {
    const params: Record<string, any> = { subscription_id: subscriptionId, limit }
    if (afterEventId) params.after_event_id = afterEventId
    return this.get(
      ctx,
      '/api/v1/games/rocom/community/egg-exchange-events',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
  }

  async ingameHomeInfo(ctx: Context, uid: string, waitMs = 5000) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid) {
      this.setLastError('UID 不能为空')
      return null
    }

    const path = '/api/v1/games/rocom/ingame/home/info'
    const payload = { uid: sanitizedUid, wait_ms: waitMs }
    const { status, data, usedApiKey } = await this.requestIngameWithFallback(ctx, path, payload)
    if (status === 200 && data && !(data.task_id || data.taskId || data.taskID)) return data

    const taskId = data?.task_id || data?.taskId || data?.taskID
    if (!taskId) {
      if (status === 202) this.setLastError('家园查询任务已入队，但未返回 task_id')
      return null
    }

    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const task = await this.getIngameTask(ctx, taskId, usedApiKey)
      if (task.status === 200) return task.data
      if (task.status === null) return null
    }

    this.setLastError(`Home query task is still queued, please retry later (task_id: ${taskId})`)
    return null
  }

  async ingameMerchantInfo(ctx: Context, shopId: string | number) {
    const params = { shop_id: shopId }
    const { status, data } = await this.requestIngameWithFallback(
      ctx,
      '/api/v1/games/rocom/ingame/merchant/info',
      params,
    )
    return status === null ? null : data
  }

  async getFriendship(ctx: Context, fwToken: string, userIds: string, userIdentifier = '') {
    return this.get(
      ctx,
      '/api/v1/games/rocom/social/friendship',
      this.rocomHeaders(fwToken, userIdentifier),
      { user_ids: userIds },
    )
  }

  async getStudentState(ctx: Context, fwToken: string, accountType?: number, userIdentifier = '') {
    const params: any = {}
    if (accountType !== undefined) params.account_type = accountType
    return this.get(ctx, '/api/v1/games/rocom/activity/student-state', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  async getStudentPerks(ctx: Context, fwToken: string, area?: number, accountType?: number, userIdentifier = '') {
    const params: any = {}
    if (area !== undefined) params.area = area
    if (accountType !== undefined) params.account_type = accountType
    return this.get(ctx, '/api/v1/games/rocom/activity/perks', this.rocomHeaders(fwToken, userIdentifier), params)
  }

  async searchWikiPet(ctx: Context, query: string, limit = 10) {
    return this.get(ctx, '/api/v1/games/rocom/pet/list', this.wegameHeaders(), { q: query, page_size: limit })
  }

  async searchWikiSkill(ctx: Context, query: string, limit = 10) {
    return this.get(ctx, '/api/v1/games/rocom/pet/skill-users', this.wegameHeaders(), { skill: query, limit })
  }

  async getWikiPetDetail(ctx: Context, options: { id?: number, name?: string }) {
    const params: Record<string, any> = {}
    if (options.id !== undefined) params.id = options.id
    if (options.name) params.name = options.name
    return this.get(ctx, '/api/v1/games/rocom/pet/detail', this.wegameHeaders(), params)
  }
}
