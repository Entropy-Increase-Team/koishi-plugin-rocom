const CHINA_TIMEZONE = 'Asia/Shanghai'
const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVITY_THEMES = ['gold', 'green', 'brown']
const LOOKBACK_DAYS = 10
const MAX_LOOKAHEAD_DAYS = 50
const TRAILING_DAYS_AFTER_LAST_ACTIVITY = 3
const MIN_LOOKAHEAD_DAYS = 7

const chinaDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIMEZONE,
  month: '2-digit',
  day: '2-digit',
})

const chinaDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIMEZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const chinaDatePartsFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

type ActivityReward = {
  kind: string
  name: string
}

type ActivityItem = {
  id: string
  name: string
  desc: string
  description: string
  cover: string
  start_ts: number
  end_ts: number
  start: string
  end: string
  statusText: string
  statusClass: string
  is_unlimited: boolean
  is_perm: boolean
  rewards: ActivityReward[]
  rewards_text: string
  sort: number
  time_label: string
  hide_start?: boolean
  left_pct?: number
  width_pct?: number
  theme?: string
}

function trimText(value: unknown): string {
  return String(value ?? '').trim()
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatDateText(timestampMs: number, withTime = false): string {
  const numeric = Number(timestampMs)
  if (!Number.isFinite(numeric) || numeric <= 0) return '--'

  const formatter = withTime ? chinaDateTimeFormatter : chinaDateFormatter
  return formatter.format(new Date(numeric)).replace(/\//g, '.')
}

function getChinaDateParts(date = new Date()): Record<string, number> {
  const parts: Record<string, number> = {}
  for (const item of chinaDatePartsFormatter.formatToParts(date)) {
    if (item.type !== 'literal') parts[item.type] = Number(item.value)
  }
  return parts
}

function chinaDateToTimestampMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

function parseChinaDateText(value = '', endOfDay = false): number {
  const text = trimText(value)
  if (!text) return 0

  const localMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch
    const hasTime = hour !== undefined
    return chinaDateToTimestampMs(
      Number(year),
      Number(month),
      Number(day),
      hasTime ? Number(hour) : endOfDay ? 23 : 0,
      hasTime ? Number(minute) : endOfDay ? 59 : 0,
      hasTime ? Number(second || 0) : endOfDay ? 59 : 0,
    )
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseActivityTimestampMs(value: unknown, fallbackDate = '', endOfDay = false): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10000000000 ? numeric : numeric * 1000
  }

  return parseChinaDateText(trimText(value) || fallbackDate, endOfDay)
}

function extractActivitySource(payload: any): any[] {
  if (!isPlainObject(payload)) return []

  for (const key of ['activityCalendar', 'calendar', 'otherActivities', 'other_activities', 'activities', 'list', 'items']) {
    if (Array.isArray(payload[key])) return payload[key]
  }

  if (isPlainObject(payload.data)) return extractActivitySource(payload.data)
  return []
}

function rewardName(item: unknown): string {
  if (isPlainObject(item)) {
    return trimText(item.name || item.goods_name || item.pet_name || item.title)
  }
  return trimText(item)
}

function extractRewards(activity: any): ActivityReward[] {
  const rewards: ActivityReward[] = []

  for (const [kind, key] of [
    ['prop', 'get_props'],
    ['prop', 'get_extra_props'],
    ['pet', 'get_pets'],
    ['reward', 'rewards'],
  ] as const) {
    const value = Array.isArray(activity?.[key]) ? activity[key] : []
    for (const item of value) {
      const name = rewardName(item)
      if (name) rewards.push({ kind, name })
    }
  }

  return rewards
}

function buildRewardText(rewards: ActivityReward[]): string {
  return rewards.length
    ? rewards.slice(0, 6).map(item => item.name).join('、')
    : '暂无奖励信息'
}

function buildActivityTimeLabel(activity: ActivityItem): string {
  if (activity.is_perm) return `${activity.start} 开启`
  if (activity.hide_start) return `截止 ${activity.end}`
  return `${activity.start} - ${activity.end}`
}

function packLanes(items: ActivityItem[]): ActivityItem[][] {
  const lanes: ActivityItem[][] = []

  for (const item of items) {
    const lane = lanes.find(current => item.start_ts >= current[current.length - 1].end_ts + DAY_MS)
    if (lane) {
      lane.push(item)
    } else {
      lanes.push([item])
    }
  }

  return lanes
}

export class ActivitiesService {
  extractActivities(payload: any): ActivityItem[] {
    const source = extractActivitySource(payload)
    const nowMs = Date.now()

    return source
      .filter(item => isPlainObject(item) && !item.is_deleted)
      .map((item) => {
        let startTs = parseActivityTimestampMs(
          item.start_time || item.startAt || item.start_at || item.start_ts,
          item.start_date || '',
        )
        let endTs = parseActivityTimestampMs(
          item.end_time || item.endAt || item.end_at || item.end_ts,
          item.end_date || '',
          true,
        )
        const isUnlimited = Boolean(item.is_unlimited)

        if (!startTs && !endTs && !isUnlimited) return null
        if (isUnlimited && !endTs) {
          endTs = startTs ? startTs + 365 * DAY_MS : nowMs + 365 * DAY_MS
        }
        if (!startTs) startTs = nowMs
        if (!endTs || endTs <= startTs) endTs = startTs + DAY_MS

        const isPermanent = isUnlimited || endTs - startTs >= 300 * DAY_MS
        const rewards = extractRewards(item)
        let statusText = '进行中'
        let statusClass = 'active'

        if (nowMs < startTs) {
          statusText = '未开始'
          statusClass = 'upcoming'
        } else if (nowMs > endTs && !isUnlimited) {
          statusText = '已结束'
          statusClass = 'ended'
        } else if (isPermanent) {
          statusText = '常驻'
          statusClass = 'permanent'
        }

        return {
          id: trimText(item._id || item.id),
          name: trimText(item.name || item.title) || '未命名活动',
          desc: trimText(item.description || item.desc) || '活动',
          description: trimText(item.description || item.desc),
          cover: trimText(item.cover_url || item.cover || item.pic),
          start_ts: startTs,
          end_ts: endTs,
          start: formatDateText(startTs, true),
          end: formatDateText(endTs, true),
          statusText,
          statusClass,
          is_unlimited: isUnlimited,
          is_perm: isPermanent,
          rewards,
          rewards_text: buildRewardText(rewards),
          sort: Number(item.sort) || 999,
          time_label: formatDateText(startTs) === formatDateText(endTs)
            ? formatDateText(startTs)
            : `${formatDateText(startTs)} ~ ${formatDateText(endTs)}`,
        }
      })
      .filter((item): item is ActivityItem => !!item)
      .sort((a, b) => Number(a.is_perm) - Number(b.is_perm) || a.start_ts - b.start_ts || a.sort - b.sort)
  }

  buildRenderData(payload: any) {
    const activities = this.extractActivities(payload)
    const now = new Date()
    const nowMs = now.getTime()
    const today = getChinaDateParts(now)
    const todayMidnightMs = chinaDateToTimestampMs(today.year, today.month, today.day)
    const minTs = todayMidnightMs - LOOKBACK_DAYS * DAY_MS
    const defaultMaxTs = todayMidnightMs + MAX_LOOKAHEAD_DAYS * DAY_MS
    const minFutureMaxTs = todayMidnightMs + MIN_LOOKAHEAD_DAYS * DAY_MS
    const lastActivityEndTs = activities
      .filter(activity => !activity.is_perm)
      .reduce((max, activity) => Math.max(max, activity.end_ts), 0)
    const maxTs = lastActivityEndTs
      ? Math.min(defaultMaxTs, Math.max(minFutureMaxTs, lastActivityEndTs + TRAILING_DAYS_AFTER_LAST_ACTIVITY * DAY_MS))
      : defaultMaxTs
    const totalDuration = Math.max(maxTs - minTs, 1)
    const normalItems: ActivityItem[] = []
    const permanentItems: ActivityItem[] = []
    const keyDates = new Set<number>()

    for (const activity of activities) {
      const item: ActivityItem = { ...activity }
      let leftPct = (item.start_ts - minTs) / totalDuration * 100
      let rightPct = (item.end_ts - minTs) / totalDuration * 100

      if (item.is_perm) rightPct = 100

      leftPct = clamp(leftPct, 0, 100)
      rightPct = clamp(rightPct, 0, 100)

      let widthPct = Math.max(12.5, rightPct - leftPct)
      if (leftPct + widthPct > 100) {
        leftPct = Math.max(0, 100 - widthPct)
      }

      item.left_pct = Number(leftPct.toFixed(3))
      item.width_pct = Number(widthPct.toFixed(3))
      item.hide_start = item.start_ts < minTs
      item.time_label = buildActivityTimeLabel(item)

      if (item.is_perm) {
        permanentItems.push(item)
      } else {
        normalItems.push(item)
        if (minTs <= item.start_ts && item.start_ts <= maxTs) keyDates.add(item.start_ts)
      }
    }

    const lanes = [...packLanes(normalItems), ...packLanes(permanentItems)]
      .map((lane, laneIndex) => lane.map((item, itemIndex) => ({
        ...item,
        theme: ACTIVITY_THEMES[(laneIndex + itemIndex) % ACTIVITY_THEMES.length],
      })))

    const axisDates: Array<{ label: string, left_pct: number }> = []
    let lastTs = 0
    for (const ts of [...keyDates].sort((a, b) => a - b)) {
      if (ts - lastTs < 4 * DAY_MS) continue
      lastTs = ts
      axisDates.push({
        label: formatDateText(ts),
        left_pct: Number(((ts - minTs) / totalDuration * 100).toFixed(3)),
      })
    }

    const nowPct = (nowMs - minTs) / totalDuration * 100
    const nowLine = nowPct >= 0 && nowPct <= 100
      ? { label: 'TODAY', left_pct: Number(nowPct.toFixed(3)) }
      : null

    return {
      title: '洛克活动日历',
      subtitle: `显示 ${formatDateText(nowMs)} 前 ${LOOKBACK_DAYS} 天至 ${formatDateText(maxTs)} 活动`,
      activity_count: activities.length,
      activities,
      lanes,
      axis_dates: axisDates,
      now_line: nowLine,
      empty: activities.length === 0,
      commandHint: '发送 洛克日历 / 洛克活动',
      copyright: 'Koishi & WeGame Roco Kingdom Plugin',
    }
  }

  buildFallbackText(payload: any): string {
    const activities = this.extractActivities(payload)
    if (!activities.length) {
      return ['洛克活动日历', '', '暂无进行中的活动。'].join('\n')
    }

    const lines = ['洛克活动日历', `当前共 ${activities.length} 个活动`, '']
    activities.forEach((activity, index) => {
      lines.push(`${index + 1}. ${activity.name}`)
      lines.push(`状态：${activity.statusText}`)
      lines.push(`时间：${activity.time_label}`)
      if (activity.description) lines.push(`说明：${activity.description}`)
      if (activity.rewards.length) lines.push(`奖励：${activity.rewards.map(item => item.name).join('、')}`)
      if (index !== activities.length - 1) lines.push('')
    })

    return lines.join('\n')
  }
}
