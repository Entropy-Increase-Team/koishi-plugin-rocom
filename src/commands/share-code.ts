import { PluginDeps } from '../types'
import { sendImageWithFallback } from '../send-image'
import {
  buildShareCodeText,
  buildShareCodeView,
  extractShareCode,
} from '../share-code-service'

export function register(deps: PluginDeps) {
  const { ctx, client, renderer, config } = deps
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  const send = async (session: any, template: string, data: any, fallback: string) => {
    const image = await renderer.renderPages(ctx, template, data)
    await sendImageWithFallback(session, image, fallback, `share-code:${template}`, config)
  }

  const command = ctx.command('阵容码', '阵容分享码工具')

  command.subcommand('解析 <input:text>', '解析分享码或链接')
    .alias('阵容码解析')
    .action(async ({ session }, input) => {
      if (!session) return
      let code = ''
      try {
        code = extractShareCode(input || '')
      } catch (error) {
        return (error as Error).message
      }
      if (!code) return '请提供分享码或包含 shareData 的链接。用法：阵容码 解析 <分享码或链接>'

      const payload = await client.parseShareCode(ctx, code, session.userId!)
      if (!payload) return `分享码解析失败：${client.getLastErrorBrief()}`
      const data = buildShareCodeView(payload, 'parse', undefined, baseUrl)
      if (!data.teams.length) return '分享码中没有可展示的精灵数据。'
      await send(session, 'share-code-team', data, buildShareCodeText(data))
    })

  command.subcommand('查询 <input:text>', '查询分享码历史记录')
    .alias('阵容码查询')
    .action(async ({ session }, input) => {
      if (!session) return
      let code = ''
      try {
        code = extractShareCode(input || '')
      } catch (error) {
        return (error as Error).message
      }
      if (!code) return '请提供分享码。用法：阵容码 查询 <分享码>'

      const res = await client.getShareCodeRecords(
        ctx,
        { shareCode: code, pageNo: 1, pageSize: 1 },
        session.userId!,
      )
      if (!res) return `分享码记录查询失败：${client.getLastErrorBrief()}`

      const record = Array.isArray(res.items) ? res.items[0] : null
      if (!record) return '未找到该分享码的解析记录，请先使用：阵容码 解析 <分享码或链接>'

      let data = buildShareCodeView(record, 'record', record, baseUrl)
      if (!data.teams.length) {
        const parsed = await client.parseShareCode(ctx, code, session.userId!)
        if (parsed) data = buildShareCodeView(parsed, 'record', record, baseUrl)
      }
      if (!data.teams.length) return '已找到分享码记录，但无法还原阵容详情，请稍后重试。'
      await send(session, 'share-code-team', data, buildShareCodeText(data))
    })
}
