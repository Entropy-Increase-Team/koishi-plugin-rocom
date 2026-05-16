import { Context, Logger, Schema } from 'koishi'
import fs from 'node:fs'
import { } from 'koishi-plugin-puppeteer'
import path from 'node:path'
import { RocomClient } from './client'
import { UserManager, MerchantSubscriptionManager, HomeSubscriptionManager } from './user'
import { EggService } from './egg-service'
import { Renderer } from './render'
import { PluginDeps } from './types'
import {
  migrateLegacyFrameworkTokens,
  migrateRoleTokensToUserId,
  setupRoleTokenModel,
} from './role-token'
import { register as registerAccount } from './commands/account'
import { register as registerQuery } from './commands/query'
import { register as registerMerchant } from './commands/merchant'
import { register as registerWiki } from './commands/wiki'
import { register as registerEgg } from './commands/egg'
import { register as registerAdmin } from './commands/admin'
import { sendImageWithFallback } from './send-image'

export const name = 'rocom'
export const inject = { required: ['puppeteer', 'database'] }

const logger = new Logger('rocom')

type MenuItem = {
  cmd: string
  desc: string
}

type MenuGroup = {
  groupTitle: string
  menuItems: MenuItem[]
}

const MENU_PAGE_TITLE = '洛克王国帮助菜单'
const MENU_PAGE_SUBTITLE = '输入对应命令可查看功能，部分数据查询需要先完成账号绑定。'

const MENU_GROUPS: MenuGroup[] = [
  {
    groupTitle: '账号管理',
    menuItems: [
      { cmd: '洛克.QQ登录', desc: 'QQ 扫码绑定账号' },
      { cmd: '洛克.微信登录', desc: '微信扫码绑定账号' },
      { cmd: '洛克.导入', desc: '导入 WeGame 凭证' },
      { cmd: '洛克.绑定列表', desc: '查看已绑定账号' },
      { cmd: '洛克.切换', desc: '切换主账号' },
      { cmd: '洛克.解绑', desc: '删除绑定账号' },
      { cmd: '洛克.刷新', desc: '刷新当前凭证' },
    ],
  },
  {
    groupTitle: '数据查询',
    menuItems: [
      { cmd: '洛克.档案', desc: '查看个人档案' },
      { cmd: '洛克.战绩', desc: '查看对战战绩' },
      { cmd: '洛克.背包', desc: '查看精灵背包' },
      { cmd: '洛克.阵容', desc: '查看阵容推荐' },
      { cmd: '查看阵容', desc: '查看阵容详情' },
      { cmd: '洛克.交换大厅', desc: '查看交换大厅' },
      { cmd: '洛克.玩家', desc: '查询 ingame 玩家资料' },
      { cmd: '洛克.家园', desc: '查询家园菜园' },
      { cmd: '洛克.商店', desc: '查询 ingame 商店' },
      { cmd: '洛克.好友关系', desc: '查询好友关系' },
      { cmd: '洛克.学生', desc: '查询学生认证与福利' },
    ],
  },
  {
    groupTitle: '订阅推送',
    menuItems: [
      { cmd: '远行商人', desc: '查看当前商品' },
      { cmd: '订阅远行商人', desc: '订阅商品提醒' },
      { cmd: '取消订阅远行商人', desc: '取消商人提醒' },
      { cmd: '订阅家园菜园', desc: '菜园成熟提醒' },
      { cmd: '订阅家园灵感', desc: '精灵灵感提醒' },
      { cmd: '取消订阅家园', desc: '取消家园订阅' },
    ],
  },
  {
    groupTitle: '百科与查蛋',
    menuItems: [
      { cmd: '洛克.wiki', desc: '精灵 Wiki 查询' },
      { cmd: '洛克.技能', desc: '技能 Wiki 查询' },
      { cmd: '洛克.查蛋', desc: '精灵查蛋 / 尺寸反查' },
      { cmd: '洛克.配种', desc: '配种查询' },
    ],
  },
]

function buildMenuRenderData() {
  return {
    pageTitle: MENU_PAGE_TITLE,
    pageSubtitle: MENU_PAGE_SUBTITLE,
    menuGroups: MENU_GROUPS,
  }
}

function buildMenuFallbackText() {
  const lines = [MENU_PAGE_TITLE, MENU_PAGE_SUBTITLE, '']
  for (const group of MENU_GROUPS) {
    lines.push(group.groupTitle)
    for (const item of group.menuItems) {
      lines.push(`  ${item.cmd} - ${item.desc}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export interface Config {
  apiBaseUrl: string
  wegameApiKey: string
  qqLoginDebugMode: boolean
  adminUserIds: string[]
  autoRefreshEnabled: boolean
  autoRefreshTime: string[]
  merchantSubscriptionEnabled: boolean
  merchantSubscriptionItems: string[]
  merchantPrivateSubscriptionEnabled: boolean
  merchantCheckInterval: number
  homeSubscriptionEnabled: boolean
  homeSubscriptionIntervalMinutes: number
  imageCompressionEnabled: boolean
  imageCompressionMinBytes: number
  imageCompressionLevel: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    apiBaseUrl: Schema.string().default('https://wegame.shallow.ink').description('API 基础地址'),
    wegameApiKey: Schema.string().default('').description('WeGame API Key（获取 key 查看 Github：https://github.com/Entropy-Increase-Team/koishi-plugin-rocom ）'),
    qqLoginDebugMode: Schema.boolean().default(false).description('QQ 扫码登录调试模式，仅调试时开启'),
    adminUserIds: Schema.array(String).default([]).description('管理员用户 ID 列表'),
    autoRefreshEnabled: Schema.boolean().default(false).description('启用自动刷新凭证'),
    autoRefreshTime: Schema.array(String).default(['00:00', '12:00']).description('自动刷新时间'),
  }).description('基础设置'),
  Schema.object({
    imageCompressionEnabled: Schema.boolean().default(true).description('发送图片前启用 PNG 无损压缩'),
    imageCompressionMinBytes: Schema.number().default(262144).description('触发压缩的最小图片大小，单位字节'),
    imageCompressionLevel: Schema.number().min(0).max(9).default(9).description('PNG zlib 压缩等级 0-9'),
  }).description('图片压缩设置'),
  Schema.object({
    merchantSubscriptionEnabled: Schema.boolean().default(true).description('启用远行商人订阅'),
    merchantSubscriptionItems: Schema.array(String).default(['国王球', '棱镜球', '炫彩精灵蛋']).description('默认订阅商品'),
    merchantCheckInterval: Schema.number().default(300000).description('商人检查间隔，单位毫秒'),
    merchantPrivateSubscriptionEnabled: Schema.boolean().default(true).description('允许个人私聊订阅远行商人推送'),
    homeSubscriptionEnabled: Schema.boolean().default(true).description('启用家园菜园和灵感订阅推送'),
    homeSubscriptionIntervalMinutes: Schema.number().default(5).description('家园订阅检查间隔，单位分钟'),
  }).description('订阅推送设置'),
])

export function apply(ctx: Context, config: Config) {
  setupRoleTokenModel(ctx)
  const client = new RocomClient(config.apiBaseUrl, config.wegameApiKey)
  const dataDir = path.join(ctx.baseDir, 'data', 'rocom')
  const userMgr = new UserManager(dataDir)
  const merchantSubMgr = new MerchantSubscriptionManager(dataDir)
  const homeSubMgr = new HomeSubscriptionManager(dataDir)
  const resPath = path.resolve(__dirname, '..')
  const renderer = new Renderer(resPath)
  const renderTemplateRoot = fs.existsSync(path.join(resPath, 'lib', 'render-templates'))
    ? path.join(resPath, 'lib', 'render-templates')
    : path.join(resPath, 'src', 'render-templates')
  const searcheggsDir = path.join(renderTemplateRoot, 'searcheggs')
  const eggService = new EggService(searcheggsDir)

  const deps: PluginDeps = { ctx, config, client, userMgr, merchantSubMgr, homeSubMgr, eggService, renderer }

  ctx.on('ready', () => {
    migrateRoleTokensToUserId(ctx).catch((err) => {
      logger.warn(`role token migration failed: ${err}`)
    })
    migrateLegacyFrameworkTokens(ctx, userMgr).catch((err) => {
      logger.warn(`legacy framework token migration failed: ${err}`)
    })
  })

  ctx.command('洛克', '洛克王国帮助菜单')
    .action(async ({ session }) => {
      if (!session?.send) return buildMenuFallbackText()
      const png = await renderer.renderHtml(ctx, 'menu', buildMenuRenderData())
      await sendImageWithFallback(session, png, buildMenuFallbackText(), 'menu:main', config)
    })

  registerAccount(deps)
  registerQuery(deps)
  registerMerchant(deps)
  registerWiki(deps)
  registerEgg(deps)
  registerAdmin(deps)
}
