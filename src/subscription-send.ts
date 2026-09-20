import { Context, h, Logger } from 'koishi'
import { detectImageMime } from './send-image'

const logger = new Logger('rocom-subscription-send')

export interface SubscriptionTarget {
  platform?: string
  channelId?: string
  guildId?: string
  userId?: string
  selfId?: string
}

function findBot(ctx: Context, platform = '', selfId = ''): any {
  if (!ctx.bots?.length) return null
  if (selfId) {
    const exact = ctx.bots.find((bot: any) => String(bot.selfId) === String(selfId)
      && (!platform || bot.platform === platform))
    return exact || null
  }
  const candidates = platform ? ctx.bots.filter((bot: any) => bot.platform === platform) : ctx.bots
  if (!candidates.length) return null
  // 缺少 self_id 的旧订阅只在对应平台恰有一个 Bot 时兼容，避免误发其他 Bot。
  if (candidates.length > 1) {
    logger.warn(`平台 ${platform || '(unknown)'} 存在多个 Bot 且订阅缺少 self_id，跳过发送`)
    return null
  }
  return candidates[0]
}

export function sentMessageIds(value: unknown): boolean {
  return Array.isArray(value) && value.some(id => typeof id === 'string' && id.trim().length > 0)
}

export async function sendScheduledMessage(ctx: Context, target: SubscriptionTarget, message: any, signal?: AbortSignal) {
  if (signal?.aborted) return false
  const platform = target.platform || ''
  const channelId = target.channelId || target.guildId || ''
  const userId = target.userId || ''
  const bot = findBot(ctx, platform, target.selfId)

  if (!bot) {
    logger.warn('no available bot, skip scheduled push')
    return false
  }

  try {
    if (userId && !target.guildId) {
      if (typeof bot.sendPrivateMessage === 'function') {
        return sentMessageIds(await bot.sendPrivateMessage(userId, message)) && !signal?.aborted
      }
      if (typeof bot.sendMessage === 'function') {
        return sentMessageIds(await bot.sendMessage(userId, message)) && !signal?.aborted
      }
    }

    if (channelId && typeof bot.sendMessage === 'function') {
      return sentMessageIds(await bot.sendMessage(channelId, message, target.guildId || undefined)) && !signal?.aborted
    }
  } catch (err) {
    logger.warn(`scheduled push failed: ${err}`)
    return false
  }

  logger.warn(`scheduled push target is incomplete: ${JSON.stringify(target)}`)
  return false
}

export async function sendScheduledImageWithFallback(
  ctx: Context,
  target: SubscriptionTarget,
  image: Buffer | Buffer[] | null,
  fallbackText: string,
  mentionAll = false,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return false
  if (Array.isArray(image)) {
    if (!image.length) return sendScheduledImageWithFallback(ctx, target, null, fallbackText, mentionAll, signal)
    for (let i = 0; i < image.length; i++) {
      const segment = h.image(image[i], detectImageMime(image[i]))
      const content = mentionAll && i === 0 ? h('message', {}, h('at', { type: 'all' }), segment) : segment
      if (!await sendScheduledMessage(ctx, target, content, signal)) {
        // One complete text fallback replaces the remaining image pages.
        return sendScheduledMessage(ctx, target, h.text(fallbackText), signal)
      }
    }
    return true
  }
  const buildContent = (body: any) =>
    mentionAll ? h('message', {}, h('at', { type: 'all' }), h.text('\n'), body) : body

  if (!image) {
    return sendScheduledMessage(ctx, target, buildContent(h.text(fallbackText)), signal)
  }

  const imageSegment = h.image(image, detectImageMime(image))
  const sent = await sendScheduledMessage(ctx, target, buildContent(imageSegment), signal)
  if (sent) return true
  return sendScheduledMessage(ctx, target, buildContent(h.text(fallbackText)), signal)
}
