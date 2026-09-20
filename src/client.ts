import { Context, Logger } from 'koishi'

import { delay, withDeadline } from './async-control'

const logger = new Logger('rocom-client')

// ingame 异步任务状态分类（来自服务端 /ingame/tasks/{task_id} 返回的 status 字段）
const INGAME_PENDING_STATUSES = ['queued', 'pending', 'running', 'processing', 'accepted']
const INGAME_FAILED_STATUSES = ['failed', 'error', 'timeout', 'cancelled', 'canceled']
const INGAME_COMPLETED_STATUSES = ['done', 'success', 'succeeded', 'completed', 'finished']

export type JsonObject = Record<string, unknown>

export const isObject = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

// 每剥离一层 envelope 时继承 goods_mapping，避免只改商品渲染后拿不到名称/图标（上游 v4.1.0）。
export function inheritGoodsMapping<T extends JsonObject>(
  parent: JsonObject,
  child: T,
): T & { _goods_mapping?: unknown } {
  const mapping = child._goods_mapping ?? child.goods_mapping
    ?? parent._goods_mapping ?? parent.goods_mapping
  return mapping === undefined ? { ...child } : { ...child, _goods_mapping: mapping }
}

/** 传给 ingame 请求的可选授权上下文：指定 UID 查询时透传凭证，不自动替换为主账号。 */
export interface IngameAuthContext {
  fwToken?: string
  userIdentifier?: string
}

export interface IngameTaskPollOptions {
  /** 服务端同步等待毫秒（long-poll），这段时间内服务端会尽量直接返回结果而不入队 */
  waitMs?: number
  /** 进入排队后轮询任务状态的间隔毫秒 */
  intervalMs?: number
  /** 进入排队后等待任务完成的总超时毫秒 */
  timeoutMs?: number
  /** 任务进入排队（拿到 task_id）时回调一次，可用于向用户发送“排队中”提示 */
  onQueued?: (taskId: string) => void | Promise<void>
  /** 取消信号；插件卸载或调用方放弃时用于中止在途请求与轮询 */
  signal?: AbortSignal
}

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

  // HTTP/任务 envelope 的 goods_mapping 复制到业务对象，供商品名称与图标解析。
  private attachGoodsMapping(resp: unknown, data: unknown): any {
    if (isObject(resp) && isObject(data)) return inheritGoodsMapping(resp, data)
    return data
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
    options?: { silentFailureDetails?: boolean, signal?: AbortSignal },
  ) {
    try {
      const resp: any = await ctx.http.get(`${this.baseUrl}${path}`, {
        headers,
        params,
        timeout: this.timeout,
        signal: options?.signal,
      })
      if (resp?.code !== 0) {
        this.setLastError(resp?.message || '接口返回异常')
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        if (!options?.silentFailureDetails) {
          this.logRequestFailureDetails('GET', path, headers, params, undefined, resp)
        }
        return null
      }
      return this.attachGoodsMapping(resp, resp?.data ?? {})
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

  private async post(ctx: Context, path: string, headers: Record<string, string>, json?: any, params?: Record<string, any>, signal?: AbortSignal) {
    try {
      const resp: any = await ctx.http.post(`${this.baseUrl}${path}`, json, {
        headers,
        params,
        timeout: this.timeout,
        signal,
      })
      if (resp?.code !== 0) {
        this.setLastError(resp?.message || '接口返回异常')
        logger.warn(path + ' error: ' + (resp?.message || 'unknown'))
        this.logRequestFailureDetails('POST', path, headers, params, json, resp)
        return null
      }
      return this.attachGoodsMapping(resp, resp?.data ?? {})
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
      return this.attachGoodsMapping(resp, resp?.data ?? {})
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
      signal?: AbortSignal
    } = {},
  ): Promise<{ status: number | null, data: any }> {
    const acceptedStatuses = options.acceptedStatuses || [200]
    try {
      const response: any = await (ctx.http as any)(method, `${this.baseUrl}${path}`, {
        headers,
        params: options.params,
        data: options.json,
        timeout: Math.max(this.timeout, Number(options.json?.wait_ms ?? options.params?.wait_ms ?? 0) + 2000),
        signal: options.signal,
        validateStatus: () => true,
      })
      const rawStatus = Number(response?.status)
      const status = Number.isFinite(rawStatus) ? rawStatus : null
      const body = response?.data !== undefined ? response.data : response
      if (body?.code !== undefined && body.code !== 0) {
        const rawMessage = body.message || body.msg || '接口返回异常'
        const message = status !== null && !acceptedStatuses.includes(status)
          ? `HTTP ${status}: ${rawMessage}`
          : rawMessage
        this.setLastError(message)
        if (!options.silentFailureDetails) {
          this.logRequestFailureDetails(method, path, headers, options.params, options.json, body)
        }
        return { status: null, data: null }
      }
      const data = body?.code !== undefined ? this.attachGoodsMapping(body, body.data ?? {}) : (body ?? {})
      if (status === null || !acceptedStatuses.includes(status)) {
        this.setLastError(status === null ? 'HTTP 响应缺少状态码' : `HTTP ${status}`)
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
    options: { acceptedStatuses?: number[], auth?: IngameAuthContext, signal?: AbortSignal } = {},
  ): Promise<{ status: number | null, data: any, usedApiKey: boolean }> {
    const acceptedStatuses = options.acceptedStatuses || [200, 202]
    const auth = options.auth || {}
    const requestOnce = async (includeApiKey: boolean, silentFailureDetails: boolean) => {
      const headers = this.wegameHeaders(auth.fwToken || '', auth.userIdentifier || '', '', '', includeApiKey)
      let result = await this.requestWithStatus(ctx, 'POST', path, headers, {
        json: payload,
        acceptedStatuses,
        silentFailureDetails,
        signal: options.signal,
      })
      if (result.status === null && !options.signal?.aborted) {
        result = await this.requestWithStatus(ctx, 'GET', path, headers, {
          params: payload,
          acceptedStatuses,
          silentFailureDetails,
          signal: options.signal,
        })
      }
      return result
    }

    let result = await requestOnce(false, Boolean(this.apiKey))
    if (result.status !== null) return { ...result, usedApiKey: false }

    if (!options.signal?.aborted && this.shouldRetryIngameWithApiKey(this.getLastError())) {
      result = await requestOnce(true, false)
      if (result.status !== null) return { ...result, usedApiKey: true }
    }

    return { status: null, data: null, usedApiKey: false }
  }

  private async getIngameTask(
    ctx: Context,
    taskId: string,
    includeApiKey = true,
    auth: IngameAuthContext = {},
    signal?: AbortSignal,
  ) {
    return this.requestWithStatus(
      ctx,
      'GET',
      `/api/v1/games/rocom/ingame/tasks/${taskId}`,
      this.wegameHeaders(auth.fwToken || '', auth.userIdentifier || '', '', '', includeApiKey),
      { acceptedStatuses: [200, 202], signal },
    )
  }

  private static normalizeTaskStatus(value: any): string {
    return String(value ?? '').trim().toLowerCase()
  }

  private static extractTaskId(payload: any): string {
    return String(payload?.task_id || payload?.taskId || payload?.taskID || '').trim()
  }

  // 判断一份 payload 是否为“已完成的业务结果”（而非排队占位）。
  // 家园接口完成时返回 rows/home_info；玩家、商店完成时返回 source/title/rows；
  // 家园详情（pet/data）完成时返回 npc_pets/npc_pet；
  // v4.1 玩家嵌套结构返回 player_info/player_card_brief_info，实时商人返回 goods/shop/meta。
  private static isCompletedGatewayPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false
    if (Array.isArray(payload.rows)) return true
    if (payload.home_info !== undefined) return true
    if (Array.isArray(payload.npc_pets)) return true
    if (payload.npc_pet && typeof payload.npc_pet === 'object') return true
    if (payload.player_info && typeof payload.player_info === 'object') return true
    if (payload.player_card_brief_info && typeof payload.player_card_brief_info === 'object') return true
    if (Array.isArray(payload.goods)) return true
    if (payload.shop && typeof payload.shop === 'object') return true
    if (payload.meta && typeof payload.meta === 'object' && Array.isArray(payload.goods)) return true
    return false
  }

  private static inspectIngamePayload(payload: any, depth = 0, completed = false): { value?: any, pending?: boolean, error?: string } {
    if (!isObject(payload) || depth > 6) return { error: '任务返回结构无法解析' }
    const state = RocomClient.normalizeTaskStatus(payload.status)
    if (INGAME_FAILED_STATUSES.includes(state)) return { error: RocomClient.taskErrorMessage(payload, state) }
    if (INGAME_PENDING_STATUSES.includes(state)) return { pending: true }
    if (state && !INGAME_COMPLETED_STATUSES.includes(state)) return { error: 'Ingame 任务状态异常：' + state }
    completed ||= INGAME_COMPLETED_STATUSES.includes(state)
    if (RocomClient.isCompletedGatewayPayload(payload)) return { value: payload }
    for (const key of ['result', 'data']) {
      if (isObject(payload[key])) return RocomClient.inspectIngamePayload(inheritGoodsMapping(payload, payload[key] as JsonObject), depth + 1, completed)
    }
    if (completed) return { error: '任务已完成但未返回可解析结果' }
    if (state) return { error: 'Ingame 任务状态异常：' + state }
    if (RocomClient.extractTaskId(payload)) return { pending: true }
    return { value: payload }
  }

  private static taskErrorMessage(payload: any, fallbackStatus = ''): string {
    const candidates = [
      payload?.message, payload?.error, payload?.error_message, payload?.reason,
      payload?.result?.message, payload?.result?.error, payload?.result?.error_message,
      payload?.data?.message, payload?.data?.error,
    ]
    for (const candidate of candidates) {
      const text = String(candidate ?? '').trim()
      if (text && text.toLowerCase() !== 'failed') return text
    }
    return String(payload?.status || fallbackStatus || '').trim() || '任务执行失败'
  }

  // 排队等候轮询：把 ingame 接口提交后返回的 202（task_id/status=queued）轮询到出结果或超时。
  // 入参 first 是首请求拿到的 { status, data, usedApiKey }。
  private async pollIngameTask(
    ctx: Context,
    first: { status: number | null, data: any, usedApiKey: boolean },
    options: IngameTaskPollOptions,
    labels: { queuedNoTaskId: string, stillQueued: (taskId: string) => string },
    auth: IngameAuthContext = {},
  ): Promise<any> {
    if (first.status === null || options.signal?.aborted) return null
    const initial = RocomClient.inspectIngamePayload(first.data)
    if (initial.error) { this.setLastError(initial.error); return null }
    const taskId = RocomClient.extractTaskId(first.data)
    if (!initial.pending && initial.value !== undefined && first.status !== 202) return initial.value
    if (!taskId) { this.setLastError(labels.queuedNoTaskId); return null }
    try {
      return await withDeadline(Math.max(1, Number(options.timeoutMs) || 180000), options.signal, async signal => {
        if (options.onQueued) {
          try { await options.onQueued(taskId) } catch (error) { logger.warn('排队提示失败: ' + error) }
        }
        while (!signal.aborted) {
          await delay(Math.max(300, Number(options.intervalMs) || 3000), signal)
          const task = await this.getIngameTask(ctx, taskId, first.usedApiKey, auth, signal)
          signal.throwIfAborted()
          if (task.status === null) return null
          const result = RocomClient.inspectIngamePayload(task.data)
          if (result.error) { this.setLastError(result.error); return null }
          if (!result.pending && result.value !== undefined && task.status !== 202) return result.value
        }
        return null
      })
    } catch {
      this.setLastError(options.signal?.aborted ? '查询已取消' : labels.stillQueued(taskId))
      return null
    }
  }

  private async queuedQuery(
    ctx: Context, path: string, payload: Record<string, any>,
    options: IngameTaskPollOptions & { auth?: IngameAuthContext },
    labels: { queuedNoTaskId: string, stillQueued: (id: string) => string },
  ) {
    try {
      return await withDeadline(Number(options.timeoutMs) || 180000, options.signal, async signal => {
        const first = await this.requestIngameWithFallback(ctx, path, payload, { auth: options.auth, signal })
        signal.throwIfAborted()
        return this.pollIngameTask(ctx, first, { ...options, signal }, labels, options.auth)
      })
    } catch {
      this.setLastError(options.signal?.aborted ? '查询已取消' : '查询等待超时，请稍后重试')
      return null
    }
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
      || (data.player_info && typeof data.player_info === 'object')
      || (data.player_card_brief_info && typeof data.player_card_brief_info === 'object')
    )
  }

  async ingamePlayerSearch(
    ctx: Context,
    uid: string,
    options: IngameTaskPollOptions & { auth?: IngameAuthContext } = {},
  ) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid && !options.auth?.fwToken) {
      this.setLastError('UID 不能为空')
      return null
    }

    const path = '/api/v1/games/rocom/ingame/player/search'
    const payload = { ...(sanitizedUid ? { uid: sanitizedUid } : {}), wait_ms: Number(options.waitMs) || 5000 }
    return this.queuedQuery(ctx, path, payload, options, {
      queuedNoTaskId: '玩家搜索任务已入队，但未返回 task_id',
      stillQueued: (taskId) => `玩家搜索任务仍在排队，请稍后重试（task_id: ${taskId}）`,
    })
  }

  // 玩家名片（上游 v4.1.0）：需要补充收集数/名片图时按需查询。
  async ingamePlayerCard(
    ctx: Context,
    uid: string,
    options: IngameTaskPollOptions & { auth?: IngameAuthContext, source?: string } = {},
  ) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid && !options.auth?.fwToken) {
      this.setLastError('UID 不能为空')
      return null
    }

    const path = '/api/v1/games/rocom/ingame/player/card'
    const payload: Record<string, any> = {
      ...(sanitizedUid ? { uid: sanitizedUid } : {}),
      wait_ms: Number(options.waitMs) || 5000,
      source: options.source || 'friend',
    }
    return this.queuedQuery(ctx, path, payload, options, {
      queuedNoTaskId: '玩家名片任务已入队，但未返回 task_id',
      stillQueued: (taskId) => `玩家名片任务仍在排队，请稍后重试（task_id: ${taskId}）`,
    })
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

  // 远行商人：优先实时 ingame 接口，失败/协议无法识别时回退旧 merchant/info。
  // 成功的空商品列表（goods: []）视为有效结果，不触发回退。
  async getMerchantInfo(
    ctx: Context,
    refresh = false,
    options: IngameTaskPollOptions & { auth?: IngameAuthContext } = {},
  ) {
    const live = await this.ingameMerchantInfo(ctx, null, options)
    if (live && typeof live === 'object' && (
      Array.isArray(live.goods)
      || Array.isArray(live.merchantActivities)
      || Array.isArray(live.merchant_activities)
    )) {
      return { ...live, _source: 'live' as const }
    }

    if (options.signal?.aborted) return null
    const legacy = await this.get(
      ctx,
      '/api/v1/games/rocom/merchant/info',
      this.wegameHeaders(options.auth?.fwToken, options.auth?.userIdentifier),
      {
        refresh: refresh ? 'true' : 'false',
        random_goods: 'all',
      },
      { signal: options.signal },
    )
    if (legacy && typeof legacy === 'object') {
      logger.warn('[Rocom] ingame/merchant/info 不可用，已回退 merchant/info')
      return { ...legacy, _source: 'legacy' as const }
    }
    return null
  }

  async queryPetSize(
    ctx: Context,
    diameter: number,
    weight: number,
    pool = 'magic',
    pageNo = 1,
    pageSize = 30,
    userIdentifier = '',
  ) {
    const params = this.scopedParams({
      diameter,
      weight,
      pool: pool || 'magic',
      include_display_only: 'false',
      page_no: Math.max(Number(pageNo) || 1, 1),
      page_size: Math.min(Math.max(Number(pageSize) || 30, 1), 100),
    }, userIdentifier)
    return this.get(
      ctx,
      '/api/v1/games/rocom/wiki/pet-size/query',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      params,
    )
  }

  // 后端查蛋（上游 v3.8.0）：按展示身高/体重查询，参数名是 height/weight。
  async searchEggBySize(
    ctx: Context,
    heightMeters: number,
    weightKg: number,
    pageNo = 1,
    pageSize = 30,
    userIdentifier = '',
  ) {
    const params = this.scopedParams({
      height: heightMeters,
      weight: weightKg,
      page_no: Math.max(Number(pageNo) || 1, 1),
      page_size: Math.min(Math.max(Number(pageSize) || 30, 1), 100),
    }, userIdentifier)
    return this.get(
      ctx,
      '/api/v1/games/rocom/egg/search',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      params,
    )
  }

  // 异色/炫彩收集排行榜（上游 v3.9.0）。
  async getPetCollectionRanking(
    ctx: Context,
    rankType: 'shining' | 'glass',
    limit = 10,
    uid = '',
    options: { userIdentifier?: string } = {},
  ) {
    if (!['shining', 'glass'].includes(rankType)) {
      this.setLastError('无效榜单类型')
      return null
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      this.setLastError('无效数量')
      return null
    }
    const params: Record<string, any> = { limit, resolve_names: '1' }
    if (uid) params.uid = this.sanitizeUid(uid)
    return this.get(
      ctx,
      `/api/v1/games/rocom/ingame/player/card/pet-stats/rankings/${rankType}`,
      this.wegameHeaders('', options.userIdentifier || '', 'bot', 'koishi'),
      this.scopedParams(params, options.userIdentifier || ''),
    )
  }

  // 阵容分享码解析与历史查询（上游 v3.9.0）。
  async parseShareCode(ctx: Context, shareCode: string, userIdentifier = '') {
    const code = String(shareCode || '').trim()
    if (!code) {
      this.setLastError('分享码不能为空')
      return null
    }
    return this.post(
      ctx,
      '/api/v1/games/rocom/tools/share-code/parse',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      { share_code: code },
      this.scopedParams({}, userIdentifier),
    )
  }

  async getShareCodeRecords(
    ctx: Context,
    options: { shareCode?: string, hash?: string, pageNo?: number, pageSize?: number, modeId?: number, magicId?: number } = {},
    userIdentifier = '',
  ) {
    const params: Record<string, any> = {
      page_no: Math.max(Number(options.pageNo) || 1, 1),
      page_size: Math.min(Math.max(Number(options.pageSize) || 20, 1), 100),
    }
    if (options.shareCode) params.share_code = String(options.shareCode).trim()
    if (options.hash) params.hash = String(options.hash).trim()
    if (options.modeId !== undefined) params.mode_id = options.modeId
    if (options.magicId !== undefined) params.magic_id = options.magicId
    return this.get(
      ctx,
      '/api/v1/games/rocom/tools/share-code/records',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
    )
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
    signal?: AbortSignal,
  ) {
    return this.get(
      ctx,
      '/api/v1/games/rocom/announcement/latest',
      this.wegameHeaders('', userIdentifier, 'bot', 'koishi'),
      this.scopedParams(params, userIdentifier),
      { signal },
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

  async ingameHomeInfo(ctx: Context, uid: string, options: IngameTaskPollOptions & { auth?: IngameAuthContext } = {}) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid && !options.auth?.fwToken) {
      this.setLastError('UID 不能为空')
      return null
    }

    const waitMs = Number(options.waitMs) || 5000
    const path = '/api/v1/games/rocom/ingame/home/info'
    const payload: Record<string, any> = { wait_ms: waitMs }
    if (sanitizedUid) payload.uid = sanitizedUid
    return this.queuedQuery(ctx, path, payload, options, {
      queuedNoTaskId: '家园查询任务已入队，但未返回 task_id',
      stillQueued: (taskId) => `家园查询任务仍在排队，请稍后重试（task_id: ${taskId}）`,
    })
  }

  // 远行商人实时接口（上游 v4.1.0）：优先 ingame live，返回 goods/shop/meta 或任务轮询结果。
  // 未指定商店时不传 shop_id；调用方负责在新接口不可用时回退旧 merchant/info。
  async ingameMerchantInfo(
    ctx: Context,
    shopId?: string | number | null,
    options: IngameTaskPollOptions & { auth?: IngameAuthContext } = {},
  ) {
    const waitMs = Number(options.waitMs) || 5000
    const payload: Record<string, any> = { wait_ms: waitMs }
    if (shopId !== undefined && shopId !== null && String(shopId) !== '') payload.shop_id = shopId

    return this.queuedQuery(ctx, '/api/v1/games/rocom/ingame/merchant/info', payload, options, {
      queuedNoTaskId: '远行商人任务已入队，但未返回 task_id',
      stillQueued: (taskId) => `远行商人任务仍在排队，请稍后重试（task_id: ${taskId}）`,
    })
  }

  // 家园详情：批量或单只查询家园摆放精灵的完整 ingame 数据（上游 v3.6.1）。
  // UID 参数名为 target_uin；单只查询需同时提供 pet_gid 和 npc_id。
  async ingamePetData(
    ctx: Context,
    uid: string,
    extras: { petGid?: string | number, npcId?: string | number } = {},
    options: IngameTaskPollOptions & { auth?: IngameAuthContext } = {},
  ) {
    const sanitizedUid = this.sanitizeUid(uid)
    if (!sanitizedUid && !options.auth?.fwToken) {
      this.setLastError('UID 不能为空')
      return null
    }

    const waitMs = Number(options.waitMs) || 20000
    const payload: Record<string, any> = { wait_ms: waitMs }
    if (sanitizedUid) payload.target_uin = sanitizedUid
    if (extras.petGid !== undefined && extras.petGid !== null && String(extras.petGid) !== '') payload.pet_gid = extras.petGid
    if (extras.npcId !== undefined && extras.npcId !== null && String(extras.npcId) !== '') payload.npc_id = extras.npcId

    const path = '/api/v1/games/rocom/ingame/pet/data'
    return this.queuedQuery(ctx, path, payload, options, {
      queuedNoTaskId: '家园详情任务已入队，但未返回 task_id',
      stillQueued: (taskId) => `家园详情任务仍在排队，请稍后重试（task_id: ${taskId}）`,
    })
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

  // ===== 新版 RoCom Wiki API（上游 v3.6.0）=====

  private wikiPagedParams(q = '', pageNo = 1, pageSize = 10, filters: Record<string, any> = {}) {
    const params: Record<string, any> = {
      page_no: Math.max(Number(pageNo) || 1, 1),
      page_size: Math.min(Math.max(Number(pageSize) || 10, 1), 100),
    }
    if (q) params.q = q
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params[key] = value
    }
    return params
  }

  async listWikiPets(ctx: Context, q = '', pageNo = 1, pageSize = 10, filters: Record<string, any> = {}) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/pets', this.wegameHeaders(), this.wikiPagedParams(q, pageNo, pageSize, filters))
  }

  async getWikiPet(ctx: Context, petId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/pets/${petId}`, this.wegameHeaders())
  }

  async getWikiPetProfile(ctx: Context, petId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/pets/${petId}/profile`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiPetSkills(ctx: Context, petId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/pets/${petId}/skills`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiPetFamily(ctx: Context, petId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/pets/${petId}/family`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiPetHandbook(ctx: Context, petId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/pets/${petId}/handbook`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async listWikiSkills(ctx: Context, q = '', pageNo = 1, pageSize = 10, filters: Record<string, any> = {}) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/skills', this.wegameHeaders(), this.wikiPagedParams(q, pageNo, pageSize, filters))
  }

  async getWikiSkill(ctx: Context, skillId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/skills/${skillId}`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiSkillPets(ctx: Context, skillId: string | number) {
    return this.get(ctx, `/api/v1/games/rocom/wiki/skills/${skillId}/pets`, this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiCatalogs(ctx: Context) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/catalogs', this.wegameHeaders())
  }

  async getWikiOptions(ctx: Context) {
    return this.get(ctx, '/api/v1/games/rocom/wiki/options', this.wegameHeaders(), undefined, { silentFailureDetails: true })
  }

  async getWikiPath(ctx: Context, path: string, params: Record<string, any> = {}) {
    const trimmed = String(path || '').trim()
    if (!trimmed.startsWith('/api/v1/games/rocom/wiki/')) {
      this.setLastError('非法 Wiki 路径')
      return null
    }
    return this.get(ctx, trimmed, this.wegameHeaders(), params)
  }

  async listWikiCatalogItems(ctx: Context, path: string, q = '', pageNo = 1, pageSize = 10, search = true) {
    const params = this.wikiPagedParams(search ? q : '', pageNo, pageSize)
    return this.getWikiPath(ctx, path, params)
  }

  get wikiAssetBaseUrl() {
    return this.baseUrl
  }
}
