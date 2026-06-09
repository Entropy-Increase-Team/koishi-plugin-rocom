import { Logger } from 'koishi'
import { PluginDeps } from '../types'

const logger = new Logger('rocom-tools')

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

function stripHtml(value: unknown): string {
  return trimText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function rewardNames(item: any): string {
  const values: string[] = []
  for (const key of ['get_props', 'get_extra_props', 'get_pets', 'rewards']) {
    const list = Array.isArray(item?.[key]) ? item[key] : []
    for (const reward of list) {
      const name = trimText(reward?.name || reward?.goods_name || reward?.pet_name || reward?.title || reward)
      if (name) values.push(name)
    }
  }
  return values.length ? values.slice(0, 6).join('、') : ''
}

function buildActivitiesText(data: any): string {
  const activities = firstArray(data, ['otherActivities', 'other_activities', 'activityCalendar', 'calendar', 'activities', 'items', 'list'])
  if (!activities.length) return '当前没有活动日历数据。'

  const lines = ['洛克活动日历']
  for (const [index, activity] of activities.slice(0, 12).entries()) {
    const name = trimText(activity?.name || activity?.title) || '未命名活动'
    const desc = trimText(activity?.description || activity?.desc)
    const start = formatDate(activity?.start_time || activity?.startAt || activity?.start_at || activity?.start_date)
    const end = formatDate(activity?.end_time || activity?.endAt || activity?.end_at || activity?.end_date)
    const rewards = rewardNames(activity)
    lines.push(`${index + 1}. ${name}`)
    lines.push(`   时间：${start} - ${end}`)
    if (desc) lines.push(`   说明：${desc.length > 60 ? `${desc.slice(0, 57)}...` : desc}`)
    if (rewards) lines.push(`   奖励：${rewards}`)
  }
  if (activities.length > 12) lines.push(`还有 ${activities.length - 12} 个活动未展示。`)
  return lines.join('\n')
}

function announcementId(item: any): string {
  return trimText(item?.thread_id || item?.id)
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

function buildAnnouncementDetailText(data: any): string {
  const item = data?.detail || data?.announcement || data
  if (!item || typeof item !== 'object') return '公告详情为空。'

  const title = trimText(item?.title) || '未命名公告'
  const id = announcementId(item)
  const summary = trimText(item?.summary)
  const content = stripHtml(item?.content?.text || item?.text || item?.content)
  const lines = [
    `公告详情${id ? ` #${id}` : ''}`,
    title,
    `发布时间：${formatDate(item?.publishAt || item?.published_at || item?.createdAt)}`,
  ]
  if (summary) lines.push(`摘要：${summary}`)
  if (content) {
    lines.push('')
    lines.push(content.length > 900 ? `${content.slice(0, 900)}...` : content)
  }
  const images = Array.isArray(item?.content?.indexes)
    ? item.content.indexes.flatMap((entry: any) => Array.isArray(entry?.imageUrl) ? entry.imageUrl : [])
    : []
  if (images.length) {
    lines.push('')
    lines.push(`图片资源：${images.slice(0, 3).join('\n')}`)
  }
  return lines.join('\n')
}

export function register(deps: PluginDeps) {
  const { ctx, client, config } = deps

  ctx.command('洛克').subcommand('.日历 [mode:string]', '查看洛克活动日历')
    .alias('洛克日历')
    .action(async ({ session }, mode = '') => {
      const refresh = ['刷新', 'refresh', 'true', '1'].includes(String(mode || '').toLowerCase())
      const data = await client.getActivitiesInfo(ctx, refresh, session?.userId || '')
      if (!data) return `活动日历查询失败：${client.getLastErrorBrief()}`
      return buildActivitiesText(data)
    })

  ctx.command('洛克').subcommand('.公告 [page:number]', '查看洛克公告列表')
    .alias('洛克公告')
    .action(async ({ session }, page = 1) => {
      const currentPage = pageNumber(page)
      const data = await client.getAnnouncementList(ctx, { category_id: 99, page: currentPage, limit: 10 }, session?.userId || '')
      if (!data) return `公告列表查询失败：${client.getLastErrorBrief()}`
      return buildAnnouncementListText(data, currentPage)
    })

  ctx.command('洛克').subcommand('.最新公告', '查看最新洛克公告')
    .alias('洛克最新公告')
    .action(async ({ session }) => {
      const data = await client.getLatestAnnouncement(ctx, { category_id: 99 }, session?.userId || '')
      if (!data) return `最新公告查询失败：${client.getLastErrorBrief()}`
      return buildAnnouncementDetailText(data)
    })

  ctx.command('洛克').subcommand('.公告详情 <threadId:string>', '查看公告详情')
    .alias('洛克公告详情')
    .action(async ({ session }, threadId) => {
      const id = trimText(threadId)
      if (!/^\d+$/.test(id)) return '请提供公告 ID。用法：洛克.公告详情 <公告ID>'
      const data = await client.getAnnouncementDetail(ctx, id, session?.userId || '')
      if (!data) return `公告详情查询失败：${client.getLastErrorBrief()}`
      return buildAnnouncementDetailText(data)
    })

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
