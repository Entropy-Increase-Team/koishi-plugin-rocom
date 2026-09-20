import { PluginDeps } from '../types'
import { sendImageWithFallback } from '../send-image'
import { buildRankingText, buildRankingView, parseRankingArgs } from '../ranking-service'

export function register(deps: PluginDeps) {
  const { ctx, client, userMgr, renderer, config } = deps

  for (const [label, kind] of [['异色', 'shining'], ['炫彩', 'glass']] as const) {
    ctx.command(`${label}排行榜 [args:text]`, `查询${label}精灵收集排行榜`)
      .alias(`${label}榜`)
      .alias(`洛克${label}排行榜`)
      .action(async ({ session }, args = '') => {
        if (!session) return
        const primaryUid = String(userMgr.getPrimaryBinding(session.userId!)?.role_id || '')
        let parsed: { uid: string, limit: number }
        try {
          parsed = parseRankingArgs(args, primaryUid)
        } catch (error) {
          return (error as Error).message
        }

        const payload = await client.getPetCollectionRanking(
          ctx,
          kind,
          parsed.limit,
          parsed.uid,
          { userIdentifier: session.userId! },
        )
        if (payload === null) return `排行榜查询失败：${client.getLastErrorBrief()}`

        const data = buildRankingView(payload, kind, config.apiBaseUrl.replace(/\/$/, ''), parsed.uid)
        const image = await renderer.renderPages(ctx, 'pet-ranking', data, { maxPageHeight: 3500 })
        await sendImageWithFallback(session, image, buildRankingText(data), 'ranking', config)
      })
  }
}
