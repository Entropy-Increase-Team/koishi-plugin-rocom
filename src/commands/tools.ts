import { Logger } from 'koishi'
import { PluginDeps } from '../types'
import { ActivitiesService } from '../activities-service'
import { sendImageWithFallback } from '../send-image'
import { sendScheduledImageWithFallback } from '../subscription-send'
import { canManageSubscription, isDirectSession } from '../permissions'
import { createRunner } from '../subscription-runner'
import { buildAnnouncementView, buildAnnouncementListView, announcementViewText } from '../announcement-service'

const logger = new Logger('rocom-tools')
const activitiesService = new ActivitiesService()

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

function formatDate(value: unknown): string {
  const text = trimText(value)
  if (!text) return '未知时间'
  const numeric = Number(text)
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10000000000 ? numeric : numeric * 1000)
    : new Date(text)
  if (Number.isNaN(date.getTime())) return text
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pageNumber(value: unknown, defaultValue = 1): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 1) return defaultValue
  return Math.min(50, Math.floor(num))
}

function firstArray(payload: any, keys: string[]): any[] {
  if (!payload || typeof payload !== 'object') return []
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  if (payload.data && typeof payload.data === 'object') return firstArray(payload.data, keys)
  return []
}

function announcementId(item: any): string {
  return trimText(item?.thread_id || item?.id)
}

function announcementTimestamp(item: any): number {
  for (const key of ['published_at_ts', 'publish_at_ts', 'created_at_ts']) {
    const value = Number(item?.[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  for (const key of ['publishAt', 'published_at', 'createdAt']) {
    const text = trimText(item?.[key])
    if (!text) continue
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000)
  }
  return 0
}

function announcementSubscriptionKey(session: any): string {
  const privateChat = isDirectSession(session)
  return [session?.platform || '', session?.channelId || 'private', privateChat ? (session?.userId || '') : '', 'announcement'].join(':')
}

// 上游 v3.2.0：轮询最新公告，向订阅会话推送新公告提醒。
async function checkAnnouncementSubscriptions(deps: PluginDeps, signal?: AbortSignal) {
  const { ctx, client, announcementSubMgr } = deps
  const subs = announcementSubMgr.getAll()
  const subEntries = Object.entries(subs)
  if (!subEntries.length) return { subscriptions: 0, pushed: 0 }

  if (signal?.aborted) return { subscriptions: 0, pushed: 0 }
  const latest = await client.getLatestAnnouncement(ctx, { category_id: 99 }, '', signal)
  if (signal?.aborted) return { subscriptions: 0, pushed: 0 }
  const item = latest?.detail || latest?.announcement || latest
  const latestId = announcementId(item)
  if (!latestId) return { subscriptions: subEntries.length, pushed: 0 }
  const latestTs = announcementTimestamp(item)

  const view = buildAnnouncementView(latest, deps.config.apiBaseUrl)
  let image: Buffer[] | null | undefined
  let pushed = 0
  for (const [key, sub] of subEntries) {
    if (signal?.aborted) break
    if (JSON.stringify(announcementSubMgr.getAll()[key]) !== JSON.stringify(sub)) continue
    if (latestId === String(sub.last_id || '')) continue
    if (latestTs && sub.since_ts && latestTs <= sub.since_ts) continue
    const message = announcementViewText(view)
    if (image === undefined) image = await deps.renderer.renderPages(ctx, 'announcement/detail', view, { signal })
    if (signal?.aborted) break
    try {
      const sent = await sendScheduledImageWithFallback(ctx, {
        platform: sub.platform,
        selfId: sub.self_id,
        channelId: sub.channel_id || sub.guild_id || sub.user_id || '',
        guildId: sub.guild_id || '',
        userId: sub.user_id || '',
      }, image, message, false, signal)
      if (!sent || signal?.aborted || JSON.stringify(announcementSubMgr.getAll()[key]) !== JSON.stringify(sub)) continue
    } catch (e) {
      logger.warn(`公告订阅推送失败: ${e}`)
      continue
    }
    pushed++
    announcementSubMgr.upsert(key, {
      ...sub,
      last_id: latestId,
      since_ts: latestTs || Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    })
  }
  return { subscriptions: subEntries.length, pushed }
}

function buildAnnouncementListText(data: any, page: number): string {
  const list = firstArray(data, ['list', 'items'])
  if (!list.length) return page > 1 ? '该页没有更多公告。' : '当前没有公告数据。'

  const lines = ['洛克公告']
  for (const [index, item] of list.entries()) {
    const title = trimText(item?.title) || '未命名公告'
    const summary = trimText(item?.summary)
    const id = announcementId(item)
    const stick = Number(item?.isStick) === 1 ? '[置顶]' : ''
    lines.push(`${index + 1}. ${stick}${title}${id ? ` #${id}` : ''}`)
    if (summary) lines.push(`   ${summary.length > 70 ? `${summary.slice(0, 67)}...` : summary}`)
    lines.push(`   ${formatDate(item?.publishAt || item?.published_at || item?.createdAt)}`)
  }

  const current = Number(data?.page) || page
  if (data?.has_more || data?.next_page) {
    lines.push(`当前第 ${current} 页，下一页：洛克.公告 ${data.next_page || current + 1}`)
  }
  lines.push('详情：洛克.公告详情 <公告ID>')
  return lines.join('\n')
}

export function register(deps: PluginDeps) {
  const { ctx, client, config, renderer } = deps
  const runner = createRunner(ctx)
  const sendDetail = async (session: any, data: any) => {
    const view = buildAnnouncementView(data, config.apiBaseUrl)
    const pages = await renderer.renderPages(ctx, 'announcement/detail', view)
    await sendImageWithFallback(session, pages, announcementViewText(view), 'announcement:detail', config)
  }

  ctx.command('洛克').subcommand('.日历 [mode:string]', '查看洛克活动日历')
    .alias('洛克日历')
    .action(async ({ session }, mode = '') => {
      const refresh = ['刷新', 'refresh', 'true', '1'].includes(String(mode || '').toLowerCase())
      const data = await client.getActivitiesInfo(ctx, refresh, session?.userId || '')
      if (!data) return `活动日历查询失败：${client.getLastErrorBrief()}`
      const fallback = activitiesService.buildFallbackText(data)
      if (!session?.send) return fallback

      const image = await renderer.renderHtml(ctx, 'activities', activitiesService.buildRenderData(data))
      await sendImageWithFallback(session, image, fallback, 'activities:calendar', config)
    })

  ctx.command('洛克').subcommand('.公告 [page:number]', '查看洛克公告列表')
    .alias('洛克公告')
    .action(async ({ session }, page = 1) => {
      const currentPage = pageNumber(page)
      const data = await client.getAnnouncementList(ctx, { category_id: 99, page: currentPage, limit: 10 }, session?.userId || '')
      if (!data) return `公告列表查询失败：${client.getLastErrorBrief()}`
      const pages = await renderer.renderPages(ctx, 'announcement/list', buildAnnouncementListView(data, currentPage))
      await sendImageWithFallback(session, pages, buildAnnouncementListText(data, currentPage), 'announcement:list', config)
    })

  ctx.command('洛克').subcommand('.最新公告', '查看最新洛克公告')
    .alias('洛克最新公告')
    .action(async ({ session }) => {
      const data = await client.getLatestAnnouncement(ctx, { category_id: 99 }, session?.userId || '')
      if (!data) return `最新公告查询失败：${client.getLastErrorBrief()}`
      await sendDetail(session, data)
    })

  ctx.command('洛克').subcommand('.公告详情 <threadId:string>', '查看公告详情')
    .alias('洛克公告详情')
    .action(async ({ session }, threadId) => {
      const id = trimText(threadId)
      if (!/^\d+$/.test(id)) return '请提供公告 ID。用法：洛克.公告详情 <公告ID>'
      const data = await client.getAnnouncementDetail(ctx, id, session?.userId || '')
      if (!data) return `公告详情查询失败：${client.getLastErrorBrief()}`
      await sendDetail(session, data)
    })

  ctx.command('订阅洛克公告', '订阅洛克王国新公告推送').userFields(['authority'])
    .action(async ({ session }) => {
      const privateChat = isDirectSession(session)
      if (!canManageSubscription(config, session)) return '此指令仅限群管理员或机器人管理员使用。'
      const key = announcementSubscriptionKey(session)
      // 以当前最新公告为基线，只推送之后的新公告。
      const latest = await client.getLatestAnnouncement(ctx, { category_id: 99 }, session?.userId || '')
      if (!latest) return '获取公告基线失败，请稍后重新订阅。'
      const item = latest?.detail || latest?.announcement || latest
      deps.announcementSubMgr.upsert(key, {
        key,
        platform: session?.platform || '',
        self_id: session?.selfId || session?.bot?.selfId || '',
        channel_id: session?.channelId || '',
        guild_id: session?.guildId || '',
        user_id: privateChat ? (session?.userId || '') : '',
        updated_by: session?.userId || '',
        last_id: announcementId(item),
        since_ts: announcementTimestamp(item) || Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      })
      return '已订阅洛克王国新公告推送，检测到新公告时会在当前会话提醒。'
    })

  ctx.command('取消订阅洛克公告', '取消洛克王国新公告推送').userFields(['authority'])
    .action(async ({ session }) => {
      const privateChat = isDirectSession(session)
      if (!canManageSubscription(config, session)) return '此指令仅限群管理员或机器人管理员使用。'
      const deleted = deps.announcementSubMgr.deleteMatching({
        platform: session?.platform || '',
        channelId: session?.channelId || '',
        userId: privateChat ? (session?.userId || '') : '',
      })
      return deleted ? '已取消洛克公告订阅。' : '当前会话没有洛克公告订阅。'
    })

  if (config.announcementSubscriptionEnabled) {
    ctx.setInterval(() => {
      runner(signal => checkAnnouncementSubscriptions(deps, signal)).catch(err => logger.warn(`公告订阅检查失败: ${err}`))
    }, Math.max(1, config.announcementPollIntervalMinutes || 10) * 60000)
  }

  ctx.command('洛克').subcommand('.同步配置', '手动同步 RoCom 远端配置')
    .alias('洛克同步配置')
    .action(async ({ session }) => {
      if (!config.adminUserIds.includes(session?.userId || '')) return '此指令仅限管理员使用。'
      const data = await client.syncConfig(ctx, session?.userId || '')
      if (!data) return `同步配置失败：${client.getLastErrorBrief()}`
      logger.info(`manual config sync requested by ${session?.userId || 'unknown'}`)
      const skipped = Array.isArray(data?.skipped_resources) ? data.skipped_resources.length : 0
      return skipped
        ? `配置同步完成，但有 ${skipped} 个资源跳过。`
        : '配置同步完成。'
    })
}
