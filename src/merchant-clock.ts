function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

export interface ClockParts {
  date: string
  hour: number
  minute: number
  second: number
}

// 统一时钟：默认上海时区失败时固定 +08:00，避免 UTC 服务器上商品日期/轮次错位。
export class MerchantClock {
  private formatter: Intl.DateTimeFormat
  private fixedOffset = false
  readonly zone: string

  constructor(requested = 'Asia/Shanghai') {
    const wanted = requested || 'Asia/Shanghai'
    let zone = wanted
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(0)
    } catch {
      if (wanted === 'Asia/Shanghai') {
        zone = 'UTC'
        this.fixedOffset = true
      } else {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      }
    }
    this.zone = this.fixedOffset ? 'UTC+08:00' : zone
    this.formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  parts(nowMs = Date.now()): ClockParts {
    const timestamp = nowMs + (this.fixedOffset ? 8 * 3600_000 : 0)
    const values: Record<string, string> = {}
    for (const part of this.formatter.formatToParts(timestamp)) {
      if (part.type !== 'literal') values[part.type] = part.value
    }
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    }
  }

  date(nowMs = Date.now()): string {
    return this.parts(nowMs).date
  }

  /** Boundaries in absolute time, including 23/25-hour DST days. */
  dayBounds(nowMs = Date.now()): { start: number, end: number } {
    const day = this.date(nowMs)
    const edge = (before: boolean) => {
      let low = before ? nowMs - 48 * 3600_000 : nowMs
      let high = before ? nowMs : nowMs + 48 * 3600_000
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2)
        if (before ? this.date(mid) < day : this.date(mid) === day) low = mid
        else high = mid
      }
      return high
    }
    return { start: edge(true), end: edge(false) }
  }

  minuteOfDay(nowMs = Date.now()): number {
    const p = this.parts(nowMs)
    return p.hour * 60 + p.minute
  }

  timeText(nowMs = Date.now()): string {
    const p = this.parts(nowMs)
    return `${pad(p.hour)}:${pad(p.minute)}`
  }

  // 下一个匹配给定 HH:MM 墙钟列表的时刻（毫秒），扫描精度 1 分钟。
  nextTimeFor(times: string[], nowMs = Date.now()): number | null {
    const targets = new Set(times.map(item => String(item || '').trim()).filter(Boolean))
    if (!targets.size) return null
    let cursor = Math.floor(nowMs / 60000) * 60000 + 60000
    for (let i = 0; i < 60 * 24 * 8; i++) {
      if (targets.has(this.timeText(cursor))) return cursor
      cursor += 60000
    }
    return null
  }
}
