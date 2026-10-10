// Command-level review: node tests/command-review.cjs
// Registers every command module against a mocked Koishi context, invokes each
// command action with synthetic sessions/payloads, and reports unhandled errors.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
require.extensions['.ts'] = (module, filename) => {
  const relative = path.relative(root, filename).replaceAll('\\', '/')
  const source = fs.readFileSync(filename, 'utf8')
    + (relative === 'src/commands/query.ts' ? '\nexport const __review = { extractHomeEggStatus };' : '')
  module._compile(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}

const sec = iso => Date.parse(iso) / 1000

// ---------- fake koishi context ----------
function flattenContent(content) {
  if (Array.isArray(content)) return content.map(item => String(item)).join('')
  return String(content)
}
function makeDatabase() {
  const tables = { roleToken: [] }
  const matches = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value)
  return {
    get: async (table, query) => (tables[table] || []).filter(row => matches(row, query)),
    upsert: async (table, rows) => { (tables[table] = tables[table] || []).push(...rows) },
    remove: async (table, query) => {
      const rows = tables[table] || []
      const kept = rows.filter(row => !matches(row, query))
      tables[table] = kept
    },
  }
}

function createFakeCtx(baseDir) {
  const commands = new Map()
  const state = { sendLog: [] }
  const listeners = { dispose: [], ready: [] }
  const intervals = []
  const normalizePath = name => String(name).split(/\s+/)[0]
  const makeCommand = full => {
    const cmd = {
      path: full,
      _action: null,
      // 对齐 koishi：点号相对（洛克.QQ登录），无点号用 /（阵容码/解析）。
      subcommand(def) { return getOrCreate(full + (String(def).charCodeAt(0) === 46 ? '' : '/') + def) },
      alias(name) { commands.set(normalizePath(name), cmd); return cmd },
      userFields() { return cmd },
      option() { return cmd },
      usage() { return cmd },
      action(fn) { cmd._action = fn; return cmd },
    }
    return cmd
  }
  const getOrCreate = full => {
    const key = normalizePath(full)
    if (!commands.has(key)) commands.set(key, makeCommand(key))
    return commands.get(key)
  }
  return {
    commands,
    baseDir,
    command: name => getOrCreate(name),
    on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); return () => {} },
    setInterval: fn => { intervals.push(fn); return () => {} },
    setTimeout: fn => { fn(); return () => {} },
    sendLog: state.sendLog,
    bots: [{
      platform: 'qq',
      selfId: 'BOT',
      // h 元素数组用元素本身的 toString 拼接，便于断言 at-all 等标记。
      sendMessage: async (channelId, content) => { state.sendLog.push({ channelId, text: flattenContent(content) }); return ['m'] },
      sendPrivateMessage: async (userId, content) => { state.sendLog.push({ userId, text: flattenContent(content) }); return ['m'] },
    }],
    model: { extend: () => {} },
    database: makeDatabase(),
    listeners,
    intervals,
  }
}

// ---------- synthetic payloads ----------
function readDoc(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src/doc', name), 'utf8').replace(/^\uFEFF/, ''))
}

function liveMerchantPayload() {
  return {
    _source: 'live',
    goods: [
      { goods_id: 1, price: { real: { amount: 120 }, origin: { amount: 150 } }, limit_buy_num: 5 },
      { goods_id: 2, price: 66, limit_buy_num: 1 },
    ],
    goods_mapping: [
      { goods_id: 1, goods_name: '轮次甲', item_id: 11, item_kind: 'bag' },
      { goods_id: 2, goods_name: '全天乙', item_id: 21, item_kind: 'bag' },
    ],
  }
}

function legacyMerchantPayload() {
  return {
    _source: 'legacy',
    merchantActivities: [{
      name: '远行商人',
      start_date: '每日 08:00 / 12:00 / 16:00 / 20:00 刷新',
      get_props: [{ id: '1', name: '轮次甲', start_time: sec('2026-10-10T08:00:00+08:00'), end_time: sec('2026-10-10T12:00:00+08:00') }],
      products: [{ id: '2', name: '全天乙' }],
    }],
    random_goods: [
      { id: 1, goods_name: '轮次甲', item_id: 11, price: 0 },
      { id: 2, goods_name: '全天乙', item_id: 21, price: 0 },
    ],
  }
}

function homeInfoPayload() {
  const pending = Math.floor(Date.now() / 1000) + 5400
  return {
    home_info: {
      home_brief_info: { home_name: '测试小屋', home_level: 30 },
      cell_home_brief_info: {
        home_pets: [
          { home_pet_info: { pet_gid: 'g1', pet_cfg_id: 101, name: '甲', gender: 2 }, have_egg: true },
          { home_pet_info: { pet_gid: 'g2', pet_cfg_id: 102, name: '乙', gender: 1 }, predicted_egg_time: pending },
        ],
      },
    },
  }
}

function homeEggsPayload() {
  const pending = Math.floor(Date.now() / 1000) + 3600
  return {
    home_pets: [
      { home_pet_info: { pet_cfg_id: 101, name: '甲' }, have_egg: true },
      { home_pet_info: { pet_cfg_id: 102, name: '乙' }, predicted_egg_time: pending },
    ],
  }
}

function homePetDataPayload() {
  const pending = Math.floor(Date.now() / 1000) + 7200
  return {
    home_info: {
      home_brief_info: { home_name: '测试小屋' },
      cell_info: {
        home_pets: [
          { home_pet_info: { pet_gid: 'g1', pet_cfg_id: 101, name: '展示甲' }, have_egg: false, predicted_egg_time: pending },
          { home_pet_info: { pet_gid: 'g0', pet_cfg_id: 0, name: '守卫' }, is_guard: true },
        ],
      },
    },
    npc_pets: [
      { pet_gid: 'g1', status: 'ok', npc_pet: { pet: { base_conf_id: 101, name: '完全体甲', level: 88, gender: 2, weight: 35600, voice: 98, mutation_type: 1 } } },
    ],
  }
}

function petDataPayload() {
  return {
    player_info: { uin: '12345678', name: '测试玩家', level: 100, online: true, world_level: 60 },
    npc_pets: [
      { pet_gid: 'g1', status: 'ok', npc_pet: { ret_code: 0, pet: { base_conf_id: 101, name: '甲', level: 50, gender: 1, mutation_type: 0, voice: 40, weight: 12000 } } },
    ],
    npc_pet_ok_count: 1,
  }
}

function rolePayload() {
  return { role: { id: '12345678', role_name: '测试角色', nickname: '测试角色', level: 100 } }
}

// ---------- client mock（模式可切换：happy / null / garbage） ----------
function createClientMock() {
  const playerSearch = readDoc('player-search.json')
  const playerCard = readDoc('player-card.json')
  const state = { mode: 'happy', garbageIndex: 0 }
  // 注意：garbage 值不能带 qr_image，否则会触发登录命令的 115 秒轮询。
  const garbageValues = [undefined, {}, [], 'unexpected', { data: { result: null } }, null, { items: [] }]
  const fixtures = {
    getMerchantInfo: () => liveMerchantPayload(),
    getLegacyMerchantInfo: () => legacyMerchantPayload(),
    ingameMerchantInfo: () => legacyMerchantPayload(),
    ingameHomeInfo: () => homeInfoPayload(),
    ingameHomeEggs: () => homeEggsPayload(),
    ingameHomePetData: () => homePetDataPayload(),
    ingamePetData: () => petDataPayload(),
    ingamePlayerSearch: () => playerSearch,
    ingamePlayerCard: () => playerCard,
    getRole: () => rolePayload(),
    getEvaluation: () => ({ strength: 80, collection: 70, capture: 60, progression: 50 }),
    getPetSummary: () => ({ total: 10 }),
    getCollection: () => ({ collected: 5 }),
    getBattleOverview: () => ({ win: 1, lose: 0 }),
    getBattleList: () => ({ battles: [{ id: 'b1', name: '测试战斗', time: '2026-10-01' }] }),
    getIngameAccounts: () => ({ accounts: [{ id: '12345678', name: '测试角色', level: 100 }] }),
  }
  const base = {
    state,
    wikiAssetBaseUrl: 'https://example.invalid',
    getLastError: () => 'mock-last-error',
    getLastErrorBrief: () => 'mock-last-error',
  }
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return async () => {
        if (state.mode === 'null') return null
        if (state.mode === 'garbage') return garbageValues[(state.garbageIndex++) % garbageValues.length]
        const factory = fixtures[prop]
        return factory ? factory() : {}
      }
    },
  })
}

// ---------- deps ----------
function createDeps(ctx) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-command-review-'))
  const { UserManager, MerchantSubscriptionManager, HomeSubscriptionManager, AnnouncementSubscriptionManager } = require('../src/user.ts')
  const { EggService } = require('../src/egg-service.ts')
  const { WikiService } = require('../src/wiki-service.ts')
  const { MerchantCatalogService } = require('../src/merchant-catalog.ts')
  const { MerchantPriceLog } = require('../src/merchant-price-log.ts')
  const { Renderer } = require('../src/render.ts')

  const config = {
    apiBaseUrl: 'https://example.invalid',
    wegameApiKey: '',
    qqLoginDebugMode: false,
    adminUserIds: ['ADMIN'],
    autoRefreshEnabled: false,
    autoRefreshTime: ['00:00'],
    merchantSubscriptionEnabled: true,
    merchantSubscriptionItems: ['国王球'],
    merchantUiStyle: 'new',
    merchantPrivateSubscriptionEnabled: true,
    merchantCheckMode: 'interval',
    merchantCheckInterval: 300000,
    merchantCheckTimes: [],
    merchantTimezone: 'Asia/Shanghai',
    merchantAllDayOnceEnabled: true,
    subscriptionGroupAdminEnabled: true,
    subscriptionBotAdminEnabled: true,
    subscriptionBotAdminAuthority: 4,
    homeSubscriptionEnabled: true,
    homeSubscriptionIntervalMinutes: 5,
    announcementSubscriptionEnabled: true,
    announcementPollIntervalMinutes: 10,
    homeQueryWaitMs: 500,
    homeQueryPollIntervalMs: 300,
    homeQueryTimeoutMs: 2000,
    lowBandwidthMode: false,
    renderTimeout: 5000,
    imageCompressionEnabled: false,
    imageCompressionMinBytes: 262144,
    imageCompressionLevel: 9,
    atlasZipUrls: [],
    atlasGitUrl: '',
  }
  const client = createClientMock()
  const deps = {
    ctx,
    config,
    client,
    userMgr: new UserManager(dataDir),
    merchantSubMgr: new MerchantSubscriptionManager(dataDir),
    homeSubMgr: new HomeSubscriptionManager(dataDir),
    announcementSubMgr: new AnnouncementSubscriptionManager(dataDir),
    eggService: new EggService(path.join(root, 'src/render-templates/searcheggs')),
    renderer: new Renderer(root, { timeoutMs: 5000 }),
    wikiService: new WikiService(ctx, client),
    atlasService: {
      download: async () => { throw Error('图鉴下载在测试中禁用') },
      isReady: () => false,
      findMatch: () => ({ name: '', imagePath: '', candidates: [] }),
    },
    merchantCatalog: new MerchantCatalogService(path.join(dataDir, 'catalog.json'), async () => legacyMerchantPayload()),
    merchantPriceLog: new MerchantPriceLog(path.join(dataDir, 'prices.json')),
  }
  // 给测试用户写入角色 token，走通“已登录”链路
  return { deps, dataDir, config, client }
}

// ---------- harness ----------
function makeSession(overrides = {}) {
  const session = {
    platform: 'qq',
    selfId: 'BOT',
    userId: 'ADMIN',
    channelId: 'G1',
    guildId: 'G1',
    isDirect: false,
    user: { authority: 5 },
    content: '',
    sent: [],
    async send(content) { session.sent.push(String(content)) },
    async sendQueued(content) { session.sent.push(String(content)) },
  }
  return Object.assign(session, overrides)
}

const results = []
async function review(name, fn) {
  try {
    await fn()
    results.push({ name, pass: true })
    console.log('PASS', name)
  } catch (error) {
    results.push({ name, pass: false, error: `${error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : error}` })
    console.log('FAIL', name, '\n ', String(error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n  ') : error))
  }
}

async function invokeCommand(ctx, commandPath, args = [], sessionOverrides = {}, joinText = false) {
  const cmd = ctx.commands.get(commandPath)
  if (!cmd) throw Error(`command not registered: ${commandPath}`)
  if (typeof cmd._action !== 'function') throw Error(`command has no action: ${commandPath}`)
  const session = makeSession(sessionOverrides)
  const callArgs = joinText ? [args.join(' ')] : args
  const returned = await cmd._action({ session, args: callArgs, options: {}, command: cmd }, ...callArgs)
  return { session, returned }
}

// 要求命令要么返回文本，要么触发了发送，且过程无异常。
async function expectHealthy(ctx, commandPath, args = [], sessionOverrides = {}, joinText = false) {
  const { session, returned } = await invokeCommand(ctx, commandPath, args, sessionOverrides, joinText)
  const replied = typeof returned === 'string' && returned.trim().length > 0
  const sent = session.sent.length > 0
  if (!replied && !sent) throw Error(`no reply and nothing sent for ${commandPath} (returned=${JSON.stringify(returned)})`)
  return { returned, sent: session.sent }
}

;(async () => {
  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-command-review-ctx-'))
  const ctx = createFakeCtx(harnessDir)
  const { deps, client } = createDeps(ctx)

  // 已登录 token，便于走通需要凭证的命令
  await ctx.database.upsert('roleToken', [{ UserId: 'ADMIN', fwt: 'mock-fw-token', updated_at: Date.now() }])

  // 1) 全模块注册无异常
  await review('register/all-modules', async () => {
    require('../src/commands/account.ts').register(deps)
    require('../src/commands/query.ts').register(deps)
    require('../src/commands/merchant.ts').register(deps)
    require('../src/commands/wiki.ts').register(deps)
    require('../src/commands/egg.ts').register(deps)
    require('../src/commands/tools.ts').register(deps)
    require('../src/commands/admin.ts').register(deps)
    require('../src/commands/ranking.ts').register(deps)
    require('../src/commands/share-code.ts').register(deps)
    const withAction = [...ctx.commands.values()].filter(entry => typeof entry._action === 'function').length
    if (withAction < 40) throw Error(`too few actionable commands registered: ${withAction}`)
  })

  const commandPaths = [...ctx.commands.keys()].sort()
  console.log('registered commands:', ctx.commands.size)
  console.log(commandPaths.join(', '))

  // 2) 每条命令空参调用不崩溃（返回提示语或发送消息都算健康）
  await review('invoke/all-commands-no-args', async () => {
    const skipped = []
    for (const commandPath of commandPaths) {
      const cmd = ctx.commands.get(commandPath)
      if (typeof cmd._action !== 'function') { skipped.push(commandPath + '(no-action)'); continue }
      try {
        await expectHealthy(ctx, commandPath, [])
      } catch (error) {
        if (/no reply/.test(String(error.message))) {
          skipped.push(commandPath)
        } else {
          throw Error(`${commandPath}: ${error.message}`)
        }
      }
    }
    console.log('  (no textual output on empty args:', skipped.join(', ') || 'none', ')')
  })

  // 3) 关键数据命令带参数调用
  // 第三个元素为 true 时把参数合并成完整文本，模拟 koishi 对 [args:text] 的取值语义。
  const cases = [
    ['洛克.档案', [], false],
    ['洛克.玩家', ['12345678'], false],
    ['洛克.战绩', [1], false],
    ['洛克.背包', [], false],
    ['洛克.背包', ['异色', 1], false],
    ['洛克.阵容', [], false],
    ['洛克.交换大厅', [1], false],
    ['洛克.家园', ['12345678'], false],
    ['洛克.家园详情', ['12345678'], false],
    ['洛克.家园精灵', ['12345678'], false],
    ['洛克.家园状态', ['12345678'], false],
    ['洛克.商店', ['3009'], false],
    ['洛克.日历', [], false],
    ['洛克.公告', [1], false],
    ['洛克.最新公告', [], false],
    ['洛克.好友关系', ['12345678,87654321'], false],
    ['洛克.刷新面板', ['12345678'], false],
    ['洛克.精灵面板', ['甲', '12345678'], false],
    ['洛克.查蛋', ['喵喵'], false],
    ['洛克.查蛋', ['0.45', '35.6'], false],
    ['洛克.配种', ['火花', '喵喵'], false],
    ['洛克.wiki', ['火花'], true],
    ['洛克.技能', ['命中'], true],
    ['异色排行榜', ['50'], true],
    ['炫彩排行榜', [], true],
    ['远行商人', [], false],
    ['今日远行商人', [], false],
    ['商人商品', [], false],
    ['查看远行商人订阅', [], false],
    ['订阅远行商人', ['1', '1', '轮次甲'], true],
    ['订阅远行商人', ['@全体', '全部'], true],
    ['我的家园订阅', [], false],
    ['订阅家园生蛋', ['@全体', '12345678'], true],
    ['订阅家园菜园', ['12345678'], true],
    ['订阅家园灵感', ['12345678'], true],
    ['家园状态', ['12345678'], false],
    ['阵容码/解析', ['abcd'], true],
    ['查看阵容', ['59'], false],
    ['洛克.阵容', ['闪耀大赛', 1], true],
  ]
  for (const [commandPath, args, joinText] of cases) {
    if (!ctx.commands.has(commandPath)) continue
    await review(`case/${commandPath} ${JSON.stringify(args)}`, async () => {
      const { returned, sent } = await expectHealthy(ctx, commandPath, args, {}, joinText)
      const preview = (typeof returned === 'string' ? returned : (sent[0] ? String(sent[0]).slice(0, 60) : '')).replace(/\s+/g, ' ').slice(0, 70)
      console.log('   ->', preview)
    })
  }

  // 4) 私聊会话下的订阅命令
  for (const commandPath of ['订阅远行商人', '订阅家园生蛋', '我的家园订阅', '查看远行商人订阅']) {
    await review(`private/${commandPath}`, async () => {
      await expectHealthy(ctx, commandPath, [], { isDirect: true, guildId: undefined, channelId: 'PRIVATE' })
    })
  }

  // 5) 非管理员会话被权限拦截（应返回提示而不是异常）
  await review('permissions/non-admin-gets-hint', async () => {
    const { returned } = await invokeCommand(ctx, '订阅远行商人', ['国王球'], { userId: 'NOBODY', user: { authority: 1 } })
    if (!/仅限|管理员/.test(String(returned))) throw Error(`unexpected reply: ${returned}`)
  })

  // 9.5) 调度器重复触发去重：第二次触发不应产生新的推送
  await review('schedulers/fire-twice-dedup', async () => {
    client.state.mode = 'happy'
    const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))
    const before = ctx.sendLog.length
    for (const fn of ctx.intervals) fn()
    await settle()
    const firstBatch = ctx.sendLog.length - before
    for (const fn of ctx.intervals) fn()
    await settle()
    const secondBatch = ctx.sendLog.length - before - firstBatch
    console.log('   pushes: first fire =', firstBatch, ', second fire =', secondBatch)
    if (firstBatch <= 0) throw Error('first fire produced no push (subscription data missing?)')
    if (secondBatch > 0) throw Error(`second fire pushed ${secondBatch} messages (dedup broken)`)
    // 推送语义：商人订阅推送 + 家园蛋订阅推送（带 @全体）
    const texts = ctx.sendLog.slice(before, before + firstBatch).map(entry => entry.text).join('\n')
    if (!/远行商人/.test(texts)) throw Error('merchant push text missing')
    if (!/可收蛋|家园/.test(texts)) throw Error('home egg push text missing')
    if (!/type="all"/.test(texts)) throw Error('mention_all push missing <at type="all"/> marker')
  })

  // 9) dispose 监听器全部触发（模拟插件卸载，中止后台任务）
  await review('lifecycle/dispose-listeners', async () => {
    for (const fn of ctx.listeners.dispose || []) fn()
  })

  // 6) 换蛋广场处理器（community.ts，当前未在 index 接线，防止后续接线时踩坑）
  await review('community/handlers-healthy', async () => {
    const community = require('../src/commands/community.ts')
    const handlers = community.createCommunityHandlers(deps)
    const session = makeSession()
    const outputs = []
    outputs.push(await handlers.queryExchangeList({ session }, 1))
    outputs.push(await handlers.postExchange({ session }, '我有|想要|备注'))
    outputs.push(await handlers.queryMyPosts({ session }))
    outputs.push(await handlers.closePost({ session }, 'p1'))
    outputs.push(await handlers.reviewStatus({ session }, 'p1'))
    outputs.push(await handlers.subscribeEgg({ session }, '想要:上岸蛙'))
    outputs.push(await handlers.listSubscriptions({ session }))
    outputs.push(await handlers.queryEvents({ session }, 'sub1'))
    for (const output of outputs) {
      if (typeof output !== 'string' || !output.trim()) throw Error('handler returned empty output')
    }
  })

  // 7) 接口全部失败（null）：每条命令应返回错误提示而不是抛异常
  const actionablePaths = commandPaths.filter(p => typeof ctx.commands.get(p)?._action === 'function')
  for (const mode of ['null', 'garbage']) {
    await review(`adversarial/${mode}-client`, async () => {
      client.state.mode = mode
      try {
        const silent = []
        for (const commandPath of actionablePaths) {
          try {
            const { session, returned } = await invokeCommand(ctx, commandPath, [])
            const replied = typeof returned === 'string' && returned.trim().length > 0
            if (!replied && !session.sent.length) silent.push(commandPath)
          } catch (error) {
            throw Error(`${commandPath}: ${error.message}`)
          }
        }
        console.log('  (' + mode + ' mode silent commands:', silent.join(', ') || 'none', ')')
      } finally {
        client.state.mode = 'happy'
      }
    })
  }

  // 8) 订阅调度器触发（前置用例已写入订阅数据，这里走真实推送链路）
  await review('schedulers/intervals-registered', async () => {
    if (!ctx.intervals.length) throw Error('no subscription interval registered')
  })

  // 10) 边界参数
  const edgeCases = [
    ['订阅远行商人', ['99']],
    ['订阅远行商人', ['不存在的商品']],
    ['取消订阅远行商人', []],
    ['取消订阅家园', ['生蛋', '12345678']],
    ['取消订阅家园', ['全部']],
    ['洛克.商店', ['abc']],
    ['洛克.绑定UID', ['abc']],
    ['洛克.切换', [0]],
    ['洛克.解绑', [99]],
    ['异色排行榜', ['51']],
    ['异色排行榜', ['0']],
    ['阵容码/解析', ['']],
    ['阵容码/查询', ['%%%']],
    ['洛克.查蛋', []],
    ['洛克.配种', ['不存在的精灵']],
    ['洛克.好友关系', []],
    ['洛克.家园详情', ['123', '456']],
    ['洛克.导入', ['tgp', '']],
    ['查看阵容', ['abc']],
  ]
  for (const [commandPath, args] of edgeCases) {
    if (!ctx.commands.has(commandPath)) continue
    await review(`edge/${commandPath} ${JSON.stringify(args)}`, async () => {
      await expectHealthy(ctx, commandPath, args)
    })
  }

  const summary = { total: results.length, passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length }
  console.log(JSON.stringify(summary))
  fs.writeFileSync(path.join(root, 'docs/command-review-results.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), scope: 'command-level review with mocked context', commands: commandPaths, summary, results }, null, 2) + '\n')
  process.exitCode = summary.failed ? 1 : 0
})().catch(error => { console.error(error); process.exitCode = 1 })
