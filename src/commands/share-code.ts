import { PluginDeps } from '../types'
import { sendImageWithFallback } from '../send-image'
import {
  buildShareCodeClassicView,
  buildShareCodeText,
  buildShareCodeView,
  extractShareCode,
  type ClassicNatureInfo,
  type ShareCodeClassicAssets,
} from '../share-code-service'

export function register(deps: PluginDeps) {
  const { ctx, client, renderer, config } = deps
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  const send = async (session: any, template: string, data: any, fallback: string) => {
    const image = await renderer.renderPages(ctx, template, data)
    await sendImageWithFallback(session, image, fallback, `share-code:${template}`, config)
  }

  // 上游 WeGame rocom：信笺风模板（share-code-classic）的本地素材与 Wiki 性格映射。
  const useClassic = config.shareCodeUiStyle !== 'panel'
  const classicAssets = (): ShareCodeClassicAssets => {
    const root = 'render-templates/share-code-classic/assets'
    const assetUrl = (rel: string) => deps.renderer.resourceUrl(`${root}/${rel}`)
    return {
      frame: assetUrl('立绘背景框.png'),
      logo: assetUrl('eit-logo.png'),
      rocoIcon: assetUrl('roco_icon.png'),
      star: assetUrl('img_xingxingdi.png'),
      wax: assetUrl('火漆印.png'),
      typeIcon: name => assetUrl(`宠物属性/${name}.png`),
      bloodIcon: element => assetUrl(`血脉/${element}.png`),
    }
  }
  const classicNatureLookup = async (id: string): Promise<ClassicNatureInfo> => {
    try {
      const payload = await deps.wikiService.getOptionsPayload()
      const item = (payload?.pet?.natures || []).find((entry: any) => String(entry?.id ?? '') === id)
      if (!item) return {}
      return { name: String(item.name || ''), up: String(item.up || ''), down: String(item.down || ''), summary: String(item.summary || '') }
    } catch {
      return {}
    }
  }
  // 性格 id 全量缓存，避免每只精灵各查一次。
  const classicNatureMap = new Map<string, ClassicNatureInfo & { summary?: string }>()
  const classicLookup = async (id: string) => {
    if (!classicNatureMap.has(id)) classicNatureMap.set(id, await classicNatureLookup(id))
    return classicNatureMap.get(id) || {}
  }
  const sendShareView = async (session: any, view: any) => {
    const fallback = buildShareCodeText(view)
    if (!useClassic) {
      await send(session, 'share-code-team', view, fallback)
      return
    }
    const ids = (view.teams || []).map((team: any) => String(team.personality?.id ?? ''))
    await Promise.all(ids.map(id => classicLookup(id)))
    const classic = buildShareCodeClassicView(view, classicAssets(), id2 => classicNatureMap.get(id2) || {})
    await send(session, 'share-code-classic', classic, fallback)
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
      await sendShareView(session, data)
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
      await sendShareView(session, data)
    })
}
