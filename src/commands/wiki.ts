import { PluginDeps } from '../types'

const WIKI_CLOSED_MESSAGE = '该功能暂时关闭'

export function register(deps: PluginDeps) {
  const { ctx } = deps

  ctx.command('洛克').subcommand('.wiki <name:text>', '查询精灵 wiki')
    .alias('洛克wiki')
    .action(() => WIKI_CLOSED_MESSAGE)

  ctx.command('洛克').subcommand('.技能 <name:text>', '查询技能 wiki')
    .alias('洛克技能')
    .action(() => WIKI_CLOSED_MESSAGE)
}
