import { Logger } from 'koishi'
import { PluginDeps } from '../types'

const logger = new Logger('rocom-community')

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

function formatPostTime(value: unknown): string {
  const text = trimText(value)
  if (!text) return '未知时间'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pageNumber(value: unknown, defaultValue = 1): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 1) return defaultValue
  return Math.min(50, Math.floor(num))
}

function normalizeItems(payload: any): any[] {
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.posts)) return payload.posts
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  return []
}

function postId(item: any): string {
  return trimText(item?.post_id || item?.id || item?.postId)
}

function buildExchangeListText(data: any, pageNo: number): string {
  const items = normalizeItems(data)
  if (!items.length) return pageNo > 1 ? '该页没有更多换蛋帖了。' : '当前换蛋广场暂无帖子。'

  const lines = ['换蛋广场']
  for (const [index, item] of items.entries()) {
    const pinned = trimText(item?.pinned_until) ? '[置顶]' : ''
    const roleId = trimText(item?.id) || '-'
    const have = trimText(item?.have_text) || '未填写'
    const want = trimText(item?.want_text) || '未填写'
    const note = trimText(item?.want_note)
    const remark = trimText(item?.remark)
    const id = postId(item)

    lines.push(`${index + 1}. ${pinned}[${id || roleId}] 我有：${have} -> 想要：${want}`)
    if (note) lines.push(`   补充：${note}`)
    if (remark) lines.push(`   备注：${remark}`)
    lines.push(`   学号：${roleId} | ${formatPostTime(item?.created_at)}`)
  }

  const total = Number(data?.total)
  const totalPages = Number(data?.total_pages)
  const current = Number(data?.page_no) || pageNo
  if (Number.isFinite(totalPages) && totalPages > 1) {
    lines.push(`第 ${current}/${totalPages} 页，共 ${Number.isFinite(total) ? total : items.length} 条`)
  }
  lines.push('翻页：换蛋广场 <页码>')
  return lines.join('\n')
}

function statusLabel(value: string): string {
  const map: Record<string, string> = {
    active: '生效中',
    closed: '已关闭',
    deleted: '已删除',
  }
  return map[value] || value || '未知'
}

function reviewLabel(value: string): string {
  const map: Record<string, string> = {
    pending: '待审核',
    manual_pending: '人工审核中',
    approved: '已通过',
    rejected: '已拒绝',
  }
  return map[value] || value || '未知'
}

function buildMyPostsText(data: any): string {
  const items = normalizeItems(data)
  if (!items.length) return '你当前没有换蛋帖。'

  const lines = ['我的换蛋帖']
  for (const [index, item] of items.entries()) {
    const have = trimText(item?.have_text) || '未填写'
    const want = trimText(item?.want_text) || '未填写'
    const id = postId(item)
    lines.push(`${index + 1}. [${id || '-'}] 我有：${have} -> 想要：${want}`)
    lines.push(`   状态：${statusLabel(item?.status)} | 审核：${reviewLabel(item?.review_status)} | ${formatPostTime(item?.created_at)}`)
  }
  lines.push('关闭帖子：关闭换蛋帖 <帖子ID> [traded/cancel]')
  return lines.join('\n')
}

function parsePostArgs(raw: string) {
  const text = trimText(raw)
  const match = text.match(/^(\d{4,20})\s+(.+)$/)
  if (!match) {
    throw new Error('格式：发布换蛋帖 <学号> <我有>|<想要>|[补充]|[备注]')
  }

  const parts = match[2].split(/[|｜]/).map(part => trimText(part)).filter(Boolean)
  if (parts.length < 2) {
    throw new Error('请用 | 分隔“我有”和“想要”，例如：发布换蛋帖 470557585 雪怪果实|上岸蛙|固执|全天在线')
  }

  return {
    id: match[1],
    have_text: parts[0],
    want_text: parts[1],
    want_note: parts[2] || '',
    remark: parts.slice(3).join(' | '),
  }
}

function parseSubscribeFilters(raw: string): Record<string, string> {
  const filters: Record<string, string> = {}
  const keyMap: Record<string, string> = {
    '想要': 'want_text',
    '我有': 'have_text',
    '补充': 'want_note',
    '学号': 'id',
    '搜索': 'q',
  }

  for (const token of trimText(raw).split(/\s+/).filter(Boolean)) {
    const match = token.match(/^(.+?)[:：](.+)$/)
    if (match) {
      const key = keyMap[trimText(match[1])] || trimText(match[1])
      const value = trimText(match[2])
      if (key && value) filters[key] = value
      continue
    }

    filters.want_text = filters.want_text ? `${filters.want_text} ${token}` : token
  }

  return filters
}

function buildSubscriptionsText(data: any): string {
  const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : []
  if (!subscriptions.length) return '当前没有换蛋订阅。'

  const lines = ['换蛋订阅列表']
  subscriptions.forEach((subscription: any, index: number) => {
    const id = trimText(subscription?.subscription_id)
    const filters = subscription?.filters && typeof subscription.filters === 'object'
      ? Object.entries(subscription.filters).map(([key, value]) => `${key}=${value}`).join('、')
      : '无筛选'
    lines.push(`${index + 1}. [${id || '-'}] ${filters}`)
    lines.push(`   状态：${subscription?.status || '未知'} | ${formatPostTime(subscription?.updated_at || subscription?.created_at)}`)
  })
  return lines.join('\n')
}

function buildEventsText(data: any): string {
  const items = Array.isArray(data?.items) ? data.items : []
  if (!items.length) return `暂未拉取到新的换蛋事件。next_event_id=${data?.next_event_id ?? 0}`

  const lines = [`换蛋订阅事件 next_event_id=${data?.next_event_id ?? '-'}`]
  for (const item of items) {
    const post = item?.post || {}
    lines.push(`[${item?.event_id ?? '-'}] ${formatPostTime(item?.created_at)} 我有：${trimText(post?.have_text) || '未填写'} -> 想要：${trimText(post?.want_text) || '未填写'}`)
    if (post?.want_note) lines.push(`   补充：${post.want_note}`)
    if (postId(post)) lines.push(`   帖子ID：${postId(post)}`)
  }
  if (data?.has_more) lines.push('还有更多事件，可继续使用 next_event_id 拉取。')
  return lines.join('\n')
}

function ensureGroupAdmin(session: any, adminUserIds: string[]): string {
  if (!session?.guildId) return ''
  if (adminUserIds.includes(session?.userId || '')) return ''
  return '群聊中仅 Bot 管理员可以管理换蛋订阅。'
}

export function createCommunityHandlers(deps: PluginDeps) {
  const { ctx, client, config } = deps

  const queryExchangeList = async ({ session }: any, page = 1) => {
    const pageNo = pageNumber(page)
    const data = await client.getEggExchanges(ctx, { page_no: pageNo, page_size: 10 }, session?.userId || '')
    if (!data) return `换蛋广场查询失败：${client.getLastErrorBrief()}`
    return buildExchangeListText(data, pageNo)
  }

  const postExchange = async ({ session }: any, args = '') => {
    try {
      const payload = parsePostArgs(args)
      const data = await client.postEggExchange(ctx, payload, session?.userId || '')
      if (!data) return `发布换蛋帖失败：${client.getLastErrorBrief()}`

      const id = trimText(data?.post_id || data?.id || data?.post?.post_id)
      const similarPosts = Array.isArray(data?.similar_posts) ? data.similar_posts : []
      const lines = [
        '换蛋帖发布成功，帖子已进入审核。',
        `学号：${payload.id}`,
        `我有：${payload.have_text}`,
        `想要：${payload.want_text}`,
      ]
      if (payload.want_note) lines.push(`补充：${payload.want_note}`)
      if (payload.remark) lines.push(`备注：${payload.remark}`)
      if (id) lines.push(`帖子ID：${id}`)
      if (similarPosts.length) {
        lines.push('相似帖子：')
        similarPosts.slice(0, 3).forEach((post: any) => {
          lines.push(`  [${postId(post) || '-'}] 我有：${trimText(post?.have_text)} -> 想要：${trimText(post?.want_text)}`)
        })
      }
      return lines.join('\n')
    } catch (error) {
      logger.warn(`发布换蛋帖失败: ${error}`)
      return `发布换蛋帖失败：${(error as Error)?.message || error}`
    }
  }

  const queryMyPosts = async ({ session }: any) => {
    const data = await client.getMyEggExchanges(ctx, { page_no: 1, page_size: 20 }, session?.userId || '')
    if (!data) return `查询我的换蛋帖失败：${client.getLastErrorBrief()}`
    return buildMyPostsText(data)
  }

  const closePost = async ({ session }: any, postIdArg: string, reason = 'cancel') => {
    const id = trimText(postIdArg)
    if (!id) return '请提供帖子 ID。用法：关闭换蛋帖 <帖子ID> [traded/cancel]'
    const normalizedReason = reason === 'traded' ? 'traded' : 'cancel'
    const data = await client.closeEggExchange(ctx, id, normalizedReason, session?.userId || '')
    if (!data) return `关闭换蛋帖失败：${client.getLastErrorBrief()}`
    return `换蛋帖 ${id} 已关闭，原因：${normalizedReason === 'traded' ? '成交关闭' : '取消关闭'}。`
  }

  const reviewStatus = async ({ session }: any, postIdArg: string) => {
    const id = trimText(postIdArg)
    if (!id) return '请提供帖子 ID。用法：换蛋审核 <帖子ID>'
    const data = await client.getEggExchangeReviewStatus(ctx, id, session?.userId || '')
    if (!data) return `查询换蛋审核状态失败：${client.getLastErrorBrief()}`
    const post = data?.post || data
    return [
      `帖子ID：${id}`,
      `状态：${statusLabel(post?.status)}`,
      `审核：${reviewLabel(post?.review_status)}`,
      post?.review_reason ? `原因：${post.review_reason}` : '',
    ].filter(Boolean).join('\n')
  }

  const subscribeEgg = async ({ session }: any, filtersText = '') => {
    const adminError = ensureGroupAdmin(session, config.adminUserIds)
    if (adminError) return adminError

    const filters = parseSubscribeFilters(filtersText)
    if (!Object.keys(filters).length) {
      return '用法：订阅换蛋 想要:上岸蛙 补充:固执\n支持筛选键：想要、我有、补充、学号、搜索'
    }

    const data = await client.createEggExchangeSubscription(ctx, filters, session?.userId || '')
    if (!data) return `订阅换蛋失败：${client.getLastErrorBrief()}`
    const subscription = data?.subscription || data
    const id = trimText(subscription?.subscription_id)
    const filterText = Object.entries(filters).map(([key, value]) => `${key}=${value}`).join('、')
    return [
      '换蛋订阅创建成功。',
      `筛选条件：${filterText}`,
      id ? `订阅ID：${id}` : '',
      '可使用“换蛋事件 <订阅ID>”手动拉取新通过帖子。',
    ].filter(Boolean).join('\n')
  }

  const listSubscriptions = async ({ session }: any) => {
    const data = await client.getEggExchangeSubscriptions(ctx, session?.userId || '')
    if (!data) return `查询换蛋订阅失败：${client.getLastErrorBrief()}`
    return buildSubscriptionsText(data)
  }

  const unsubscribeEgg = async ({ session }: any, subscriptionId = '') => {
    const adminError = ensureGroupAdmin(session, config.adminUserIds)
    if (adminError) return adminError

    const id = trimText(subscriptionId)
    if (id) {
      const ok = await client.deleteEggExchangeSubscription(ctx, id, session?.userId || '')
      return ok ? `已取消换蛋订阅 ${id}。` : `取消换蛋订阅失败：${client.getLastErrorBrief()}`
    }

    const data = await client.getEggExchangeSubscriptions(ctx, session?.userId || '')
    if (!data) return `查询换蛋订阅失败：${client.getLastErrorBrief()}`
    const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : []
    if (!subscriptions.length) return '当前没有换蛋订阅。'

    let deleted = 0
    for (const subscription of subscriptions) {
      const subId = trimText(subscription?.subscription_id)
      if (!subId) continue
      const ok = await client.deleteEggExchangeSubscription(ctx, subId, session?.userId || '')
      if (ok) deleted++
    }
    return deleted ? `已取消 ${deleted} 个换蛋订阅。` : '没有成功取消任何换蛋订阅。'
  }

  const queryEvents = async ({ session }: any, subscriptionId: string, afterEventId = '') => {
    const id = trimText(subscriptionId)
    if (!id) return '请提供订阅 ID。用法：换蛋事件 <订阅ID> [after_event_id]'
    const data = await client.getEggExchangeEvents(ctx, id, afterEventId, 20, session?.userId || '')
    if (!data) return `拉取换蛋事件失败：${client.getLastErrorBrief()}`
    return buildEventsText(data)
  }

  return {
    queryExchangeList,
    postExchange,
    queryMyPosts,
    closePost,
    reviewStatus,
    subscribeEgg,
    listSubscriptions,
    unsubscribeEgg,
    queryEvents,
  }
}
