// Offline acceptance review: node tests/alignment-review.cjs
// Loads current TypeScript in memory; no production API, browser, or business-data writes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const template = require('art-template')
const root = path.resolve(__dirname, '..')
const extraExports = {
  'src/commands/query.ts': '\nexport const __review = { buildPlayerSearchRenderData, canManageGroupSubscription, buildShopRenderData, checkHomeSubscriptions };',
  'src/commands/merchant.ts': '\nexport const __review = { checkMerchantSubscriptions, canManageGroupSubscription, getSubscriptionTarget, buildConfiguredMerchantRenderPayload };',
  'src/commands/tools.ts': '\nexport const __review = { checkAnnouncementSubscriptions };',
}
require.extensions['.ts'] = (module, filename) => {
  const relative = path.relative(root, filename).replaceAll('\\', '/')
  const source = fs.readFileSync(filename, 'utf8') + (extraExports[relative] || '')
  module._compile(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}
const { RocomClient } = require('../src/client.ts')
const player = require('../src/player-service.ts')
const ranking = require('../src/ranking-service.ts')
const share = require('../src/share-code-service.ts')
const merchant = require('../src/merchant-service.ts')
const { MerchantClock } = require('../src/merchant-clock.ts')
const permissions = require('../src/permissions.ts')
const { EggService } = require('../src/egg-service.ts')
const { sizeVariantPayload } = require('../src/pet-size.ts')
const { sendScheduledMessage } = require('../src/subscription-send.ts')
const merchantCommands = require('../src/commands/merchant.ts')
const query = require('../src/commands/query.ts').__review
const { Renderer } = require('../src/render.ts')
const { createRunner } = require('../src/subscription-runner.ts')
const { buildAnnouncementView, announcementViewText } = require('../src/announcement-service.ts')
const tools = require('../src/commands/tools.ts')
const results = []
const test = async (name, fn) => {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS', name) }
  catch (error) {
    results.push({ name, pass: false, error: error.message })
    console.log('FAIL', name, '\n ', error.message.replaceAll('\n', ' '))
  }
}
const render = (name, data) => template.render(fs.readFileSync(path.join(root, 'src/render-templates', name), 'utf8'), {
  ...data, _res_path: 'file:///review-assets/', pluResPath: 'file:///review-assets/',
})
const config = {
  apiBaseUrl: 'https://example.invalid', adminUserIds: [],
  subscriptionGroupAdminEnabled: true, subscriptionBotAdminEnabled: true, subscriptionBotAdminAuthority: 4,
  merchantTimezone: 'Asia/Shanghai', merchantSubscriptionEnabled: true,
  merchantCheckMode: 'interval', merchantCheckInterval: 300000,
}
const labels = { queuedNoTaskId: 'missing task id', stillQueued: () => 'timeout' }

;(async () => {
  await test('rank/default-and-limit', () => {
    assert.deepEqual(ranking.parseRankingArgs('50', '123456'), { uid: '123456', limit: 50 })
    assert.throws(() => ranking.parseRankingArgs('123456 51'))
    assert.equal(ranking.parseRankingArgs('90071992547409931234').uid, '90071992547409931234')
  })
  await test('share/plus-and-two-percent-decodes', () => {
    assert.equal(share.extractShareCode('https://example.invalid/#shareData=ab%252Bcd%252F%253D'), 'ab+cd/=')
    assert.equal(share.extractShareCode('https://example.invalid/?shareData=ab+cd/='), 'ab+cd/=')
  })
  await test('share/record-and-placeholder-slots', () => {
    const record = { share_code: { teams: [{ pet: { id: 1, name: '甲' } }] } }
    const view = share.buildShareCodeView(record, 'record', record, config.apiBaseUrl)
    assert.equal(view.teams[0].skills.length, 4)
    assert.equal(view.teams[0].ivs.length, 3)
    assert.ok(share.parsedRecord(record))
    assert.ok(render('share-code-team/index.html', view).includes('甲'))
  })
  await test('merchant/free-price-and-zero-limit', () => {
    const items = merchant.normalizeLiveMerchant({ goods: [{ goods_id: 1, price: { real: { amount: 0 } }, limit_buy_num: 0 }],
      _goods_mapping: [{ goods_id: 1, goods_name: '测试商品' }] })
    assert.equal(items[0].name, '测试商品')
    assert.equal(items[0].price, 0)
    assert.equal(items[0].limit, 0)
  })
  await test('merchant/empty-live-does-not-fallback', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    client.ingameMerchantInfo = async () => ({ goods: [] })
    let calls = 0
    const result = await client.getMerchantInfo({ http: { get: async () => { calls++; return {} } } })
    assert.equal(calls, 0)
    assert.deepEqual(result.goods, [])
  })
  await test('clock/utc-process-shanghai-time', () => {
    assert.deepEqual(new MerchantClock().parts(Date.parse('2026-09-21T00:00:00Z')),
      { date: '2026-09-21', hour: 8, minute: 0, second: 0 })
  })
  await test('player/zero-false-and-relative-resource', () => {
    const p = player.parseIngamePlayerPayload({ player_info: { level: 0, online: false } }, '123')
    assert.equal(p.level, '0')
    assert.equal(player.playerField(p, 'online'), '否')
    assert.equal(player.resourceUrl('/img/a.png', config.apiBaseUrl), config.apiBaseUrl + '/img/a.png')
  })
  await test('task/normal-completion-and-mapping', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    const result = await client.pollIngameTask({}, { status: 200, usedApiKey: false,
      data: { status: 'completed', result: { goods: [] }, goods_mapping: [{ goods_id: 1 }] } }, {}, labels)
    assert.deepEqual(result._goods_mapping, [{ goods_id: 1 }])
  })
  await test('task/failed-state-must-not-return-business-data', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    const result = await client.pollIngameTask({}, { status: 200, usedApiKey: false,
      data: { status: 'failed', task_id: 'T', source: 'ingame', error: 'failed query' } }, {}, labels)
    assert.equal(result, null)
  })
  await test('task/queued-title-must-continue-polling', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    let polled = 0
    client.getIngameTask = async () => { polled++; return { status: 200, data: { status: 'completed', result: { goods: [] } } } }
    await client.pollIngameTask({}, { status: 202, usedApiKey: false,
      data: { status: 'queued', task_id: 'T', title: '排队中' } }, { intervalMs: 300, timeoutMs: 1000 }, labels)
    assert.equal(polled, 1)
  })
  await test('task/202-without-task-id-is-error', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    assert.equal(await client.pollIngameTask({}, { status: 202, data: { status: 'queued' }, usedApiKey: false }, {}, labels), null)
  })
  await test('task/nested-result-data-retains-mapping', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    const result = await client.pollIngameTask({}, { status: 200, usedApiKey: false,
      data: { status: 'completed', result: { data: { goods: [] } }, goods_mapping: [{ goods_id: 1 }] } }, {}, labels)
    assert.deepEqual(result.goods, [])
    assert.deepEqual(result._goods_mapping, [{ goods_id: 1 }])
  })
  await test('player/token-only-can-submit-request', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    let called = false
    client.requestIngameWithFallback = async () => { called = true; return { status: 200, usedApiKey: false, data: { player_info: { name: '甲' } } } }
    await client.ingamePlayerSearch({}, '', { auth: { fwToken: 'fake-review-token' } })
    assert.equal(called, true)
  })
  await test('player/legacy-rows-plus-card-retains-new-fields', () => {
    const merged = player.mergePlayerPayloads({ rows: [{ field: 'name', value: '甲' }] },
      { player_card_brief_info: { card_pet_info: { collected_shining_pet_count: 9 } } })
    assert.equal(player.playerField(player.parseIngamePlayerPayload(merged, '123'), 'collected_shining_pet_count', ''), '9')
  })
  await test('player/template-shows-collection-and-card', () => {
    const data = query.buildPlayerSearchRenderData({ player_info: { name: '甲' },
      player_card_brief_info: { card_pet_info: { collected_shining_pet_count: 9173, collected_glass_pet_count: 8264 } } },
      '123', 'https://example.invalid/test-card.png')
    const html = render('player-search/index.html', data)
    assert.ok(html.includes('9173') && html.includes('8264') && html.includes('test-card.png'))
  })
  await test('permissions/koishi-user-authority-is-read', () => {
    assert.equal(query.canManageGroupSubscription({ config }, { userId: 'U', user: { authority: 4 }, guildId: 'G' }), true)
  })
  await test('permissions/non-admin-role-not-substring-matched', () => {
    assert.equal(permissions.groupRoleFromSession({ event: { member: { roles: ['not-admin'] } } }), 'unknown')
  })
  await test('permissions/group-without-guild-not-treated-as-private', () => {
    const target = merchantCommands.__review.getSubscriptionTarget({ isDirect: false, platform: 'qq', channelId: 'G', userId: 'U' })
    assert.equal(target.privateChat, false)
  })
  await test('send/explicit-bot-must-send-group-message', async () => {
    let direct = 0, broadcast = 0
    const ctx = { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => { direct++; return ['m'] } }],
      broadcast: async () => { broadcast++; return ['other-bot-message'] } }
    await sendScheduledMessage(ctx, { platform: 'qq', selfId: 'B', guildId: 'G', channelId: 'G' }, 'review')
    assert.equal(direct, 1)
    assert.equal(broadcast, 0)
  })
  await test('send/empty-message-ids-must-not-mark-success', async () => {
    const ctx = { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => [] }], broadcast: async () => [] }
    assert.equal(await sendScheduledMessage(ctx, { platform: 'qq', selfId: 'B', channelId: 'G', guildId: 'G' }, 'review'), false)
  })
  const egg = Object.create(EggService.prototype)
  const eggPayload = { items: [{ id: 1, name: '测试精灵', height_range_m: [0.1, 0.3], weight_range_kg: [1, 3],
    match: { layer: 'strict' } }] }
  await test('egg/size-api-correct-threshold-and-text', () => {
    const data = egg.buildSizeSearchDataFromApi(18, 1, eggPayload)
    assert.equal(data.perfect_matches[0].size_variant_label, '小块头')
    assert.ok(egg.buildSizeSearchTextFromApi(18, 1, eggPayload).includes('小块头'))
  })
  await test('egg/template-shows-size-label', () => {
    assert.ok(render('searcheggs/size.html', egg.buildSizeSearchDataFromApi(18, 1, eggPayload)).includes('小块头'))
  })
  await test('egg/missing-range-does-not-become-zero', () => {
    assert.equal(sizeVariantPayload(0.05, null, 3).size_variant_label, '')
  })
  await test('egg/compatible-total-uses-backend-union-total', () => {
    const data = egg.buildSearchDataFromEggApi({ id: 1, name: '甲', egg_groups: [{ group_id: 2, name: '怪兽' }] }, {
      __all__: { total: 100 }, '2': { total: 100, items: [{ id: 2, name: '乙' }] },
    })
    assert.equal(data.total_compatible, 100)
  })
  await test('share/text-fallback-includes-talents', () => {
    const view = share.buildShareCodeView({ teams: [{ pet: { id: 1, name: '甲' }, ivs_detail: [{ id: 1, name: '测试天赋' }] }] }, 'parse')
    assert.ok(share.buildShareCodeText(view).includes('测试天赋'))
  })
  await test('merchant/disposal-stops-inflight-send', async () => {
    let disposed, interval, completeRequest, sends = 0
    const response = new Promise(resolve => { completeRequest = resolve })
    const ctx = {
      command: () => { const cmd = {}; for (const method of ['alias', 'action', 'subcommand', 'userFields']) cmd[method] = () => cmd; return cmd },
      on: (_, fn) => { disposed = fn }, setInterval: fn => { interval = fn }, setTimeout: fn => { fn() },
      bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => { sends++; return ['m'] } }],
      broadcast: async () => { throw Error('Unexpected broadcast') },
    }
    const deps = { ctx, config, client: { getMerchantInfo: async () => response }, renderer: { renderHtml: async () => null },
      merchantSubMgr: { getAll: () => ({ G: { group_id: 'G', channel_id: 'G', platform: 'qq', self_id: 'B', items: ['测试'], last_push_round: null } }), upsert: () => {} } }
    merchantCommands.register(deps)
    interval()
    disposed()
    completeRequest({ goods: [{ goods_id: 1, name: '测试', price: 1 }] })
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(sends, 0)
  })
  await test('render/deadline-includes-screenshot', async () => {
    let closed = false, finished = false, screenshotStarted = false
    const page = { setCacheEnabled: async () => {}, setViewport: async () => {}, goto: async () => {}, evaluate: async () => {},
      $: async () => null, screenshot: async () => { screenshotStarted = true; await new Promise(resolve => setTimeout(resolve, 700)); return Buffer.from('image') },
      close: async () => { closed = true } }
    const work = new Renderer(root).renderHtml({ puppeteer: { page: async () => page } }, 'player-search', {
      title: '测试', heroValue: '甲', heroSubvalue: '123', summaryCards: [], showSignature: false, sections: [], commandHint: '', copyright: '',
    }, { timeoutMs: 500 }).then(() => { finished = true })
    await new Promise(resolve => setTimeout(resolve, 650))
    const state = { closed, finished }
    await work
    assert.equal(screenshotStarted, true)
    assert.deepEqual(state, { closed: true, finished: true })
  })
  await test('task/failed-after-polling-never-returns-data', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    client.getIngameTask = async () => ({ status: 200, data: { status: 'failed', goods: [], error: 'denied' } })
    assert.equal(await client.pollIngameTask({}, { status: 202, usedApiKey: false, data: { task_id: 'T', status: 'queued' } },
      { intervalMs: 300, timeoutMs: 1000 }, labels), null)
    assert.ok(client.getLastError().includes('denied'))
  })
  await test('task/deadline-cancels-initial-submission', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    let signal
    client.requestIngameWithFallback = async (_ctx, _path, _payload, options) => {
      signal = options.signal
      return new Promise(() => {})
    }
    assert.equal(await client.ingamePlayerSearch({}, '123', { timeoutMs: 20 }), null)
    assert.equal(signal.aborted, true)
  })
  await test('task/completed-empty-result-is-error', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    assert.equal(await client.pollIngameTask({}, { status: 200, usedApiKey: false, data: { status: 'completed', result: {} } }, {}, labels), null)
  })
  await test('task/legacy-business-rows-are-not-unwrapped-as-task', async () => {
    const client = new RocomClient(config.apiBaseUrl, '')
    const data = { rows: [{ field: 'name', value: '甲' }], result: { error_code: 0 } }
    assert.deepEqual(await client.pollIngameTask({}, { status: 200, data, usedApiKey: false }, {}, labels), data)
  })
  await test('clock/dst-day-is-23-or-25-hours', () => {
    const clock = new MerchantClock('America/New_York')
    const spring = clock.dayBounds(Date.parse('2026-03-08T18:00:00Z'))
    const autumn = clock.dayBounds(Date.parse('2026-11-01T18:00:00Z'))
    assert.equal(spring.end - spring.start, 23 * 3600000)
    assert.equal(autumn.end - autumn.start, 25 * 3600000)
    assert.equal(clock.date(spring.start), '2026-03-08')
    assert.equal(clock.date(spring.end), '2026-03-09')
  })
  await test('clock/plugin-instances-use-own-zone', () => {
    const fixture = { goods: [{ goods_id: 1, name: '甲' }] }
    const now = new Date('2026-09-21T04:00:00Z')
    const sh = merchantCommands.__review.buildConfiguredMerchantRenderPayload({ config }, fixture, now)
    const utc = merchantCommands.__review.buildConfiguredMerchantRenderPayload({ config: { ...config, merchantTimezone: 'UTC' } }, fixture, now)
    const again = merchantCommands.__review.buildConfiguredMerchantRenderPayload({ config }, fixture, now)
    assert.equal(sh.roundInfo.current, 2)
    assert.equal(utc.roundInfo.current, null)
    assert.deepEqual(again.roundInfo, sh.roundInfo)
  })
  await test('runner/no-overlap-and-stops-after-disposal', async () => {
    let dispose, release, count = 0
    const runner = createRunner({ on: (_, fn) => { dispose = fn } })
    const first = runner(async signal => {
      count++
      await new Promise(resolve => { release = resolve })
      assert.equal(signal.aborted, true)
    })
    await runner(async () => { count++ })
    dispose(); release(); await first
    await runner(async () => { count++ })
    assert.equal(count, 1)
  })
  await test('send/two-bots-route-by-self-id', async () => {
    const sent = []
    const ctx = { bots: ['A', 'B'].map(selfId => ({ platform: 'qq', selfId, sendMessage: async () => { sent.push(selfId); return ['m'] } })) }
    assert.equal(await sendScheduledMessage(ctx, { platform: 'qq', selfId: 'B', channelId: 'G' }, 'test'), true)
    assert.deepEqual(sent, ['B'])
    assert.equal(await sendScheduledMessage(ctx, { platform: 'qq', channelId: 'G' }, 'test'), false)
  })
  await test('egg/local-size-fallback-retains-variant', () => {
    const pet = { id: 1, name: '甲', breeding: { weight_low: 1000, weight_high: 3000, height_low: 10, height_high: 30 }, egg_groups: [] }
    const local = { perfect: [pet], range: [] }
    const view = egg.buildSizeSearchData(18, 1, local)
    assert.equal(view.perfect_matches[0].size_variant_label, '小块头')
    assert.ok(egg.buildSizeSearchText(18, 1, local).includes('小块头'))
  })
  await test('player/mismatched-card-does-not-overwrite-player', () => {
    const merged = player.mergePlayerPayloads({ player_info: { uin: 'A', name: '甲' } },
      { player_info: { uin: 'B', name: '乙' }, player_card_brief_info: { card_pet_info: { collected_glass_pet_count: 88 } } })
    assert.equal(merged.player_info.name, '甲')
    assert.equal(merged.player_card_brief_info, undefined)
  })
  await test('announcement/untrusted-html-and-complete-text', () => {
    const tail = '末尾必须保留'
    const view = buildAnnouncementView({ title: '公告', content: '<p>' + '正文'.repeat(1200) + tail
      + '</p><script>bad()</script><img src="/a.png"><img src="javascript:bad()">' }, config.apiBaseUrl)
    assert.ok(announcementViewText(view).includes(tail))
    assert.equal(view.blocks.filter(x => x.image).length, 1)
    assert.equal(view.blocks.find(x => x.image).image, config.apiBaseUrl + '/a.png')
    assert.ok(!render('announcement/detail.html', view).includes('bad()'))
  })
  await test('announcement/failed-send-does-not-advance-cursor', async () => {
    let updates = 0
    const sub = { platform: 'qq', self_id: 'B', channel_id: 'G', guild_id: 'G', last_id: '1' }
    const deps = { config, ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => [] }] },
      client: { getLatestAnnouncement: async () => ({ id: '2', title: '公告' }) },
      renderer: { renderPages: async () => null }, announcementSubMgr: { getAll: () => ({ G: sub }), upsert: () => { updates++ } } }
    await tools.__review.checkAnnouncementSubscriptions(deps)
    assert.equal(updates, 0)
  })
  await test('announcement/permission-switches-apply-to-commands', async () => {
    const actions = new Map()
    const ctx = { command: name => {
      let key = name; const cmd = { subcommand: name => { key = name; return cmd }, alias: () => cmd,
        userFields: () => cmd, action: fn => { actions.set(key, fn); return cmd } }; return cmd
    }, on: () => {}, setInterval: () => {} }
    let saved
    tools.register({ ctx, config: { ...config, announcementSubscriptionEnabled: false },
      client: { getLatestAnnouncement: async () => ({ id: '1' }) }, announcementSubMgr: { upsert: (_, sub) => { saved = sub } } })
    await actions.get('订阅洛克公告')({ session: { isDirect: false, userId: 'U', selfId: 'B', channelId: 'G', guildId: 'G', user: { authority: 4 } } })
    assert.equal(saved.self_id, 'B')
  })
  await test('home/cancelled-query-does-not-send-or-write', async () => {
    const controller = new AbortController()
    let writes = 0, sends = 0
    const sub = { uid: '123', kind: 'garden', platform: 'qq', channel_id: 'G', guild_id: 'G', updated_by: 'U', notify_state: {} }
    const deps = { config, ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => { sends++; return ['m'] } }] },
      homeSubMgr: { getAll: () => ({ G: sub }), upsert: () => { writes++ } },
      client: { ingameHomeInfo: async () => { controller.abort(); return { home_info: {} } } } }
    await query.checkHomeSubscriptions(deps, controller.signal)
    assert.equal(writes, 0)
    assert.equal(sends, 0)
  })
  await test('merchant/empty-response-retries-at-most-three-times', async () => {
    const nativeTimeout = global.setTimeout, nativeNow = Date.now
    let interval, calls = 0, done
    const delays = []
    const finished = new Promise(resolve => { done = resolve })
    Date.now = () => Date.parse('2026-09-21T04:00:00Z')
    global.setTimeout = (fn, ms, ...args) => {
      if (ms >= 210000 && ms <= 270000) { delays.push(ms); return nativeTimeout(fn, 0, ...args) }
      return nativeTimeout(fn, ms, ...args)
    }
    try {
      const ctx = { command: () => { const c = {}; for (const k of ['alias', 'action', 'subcommand', 'userFields']) c[k] = () => c; return c },
        on: () => {}, setInterval: fn => { interval = fn }, setTimeout: fn => fn() }
      const deps = { ctx, config, merchantSubMgr: { getAll: () => ({ G: { items: ['甲'] } }) },
        client: { getMerchantInfo: async () => { calls++; if (calls === 4) done(); return { goods: [] } } }, renderer: {} }
      merchantCommands.register(deps)
      interval()
      await Promise.race([finished, new Promise((_, reject) => nativeTimeout(() => reject(Error('retry did not finish')), 300))])
      await new Promise(resolve => nativeTimeout(resolve, 10))
      assert.equal(calls, 4)
      assert.equal(delays.length, 3)
    } finally { global.setTimeout = nativeTimeout; Date.now = nativeNow }
  })
  await test('merchant/failed-send-keeps-dedup-state', async () => {
    const nativeNow = Date.now
    Date.now = () => Date.parse('2026-09-21T04:00:00Z')
    let updates = 0
    const sub = { platform: 'qq', self_id: 'B', group_id: 'G', channel_id: 'G', match_all: true, items: [], last_push_round: null }
    try {
      const deps = { config, ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => [] }] },
        client: { getMerchantInfo: async () => ({ goods: [{ goods_id: 1, name: '甲' }] }) },
        renderer: { renderHtml: async () => null }, merchantSubMgr: { getAll: () => ({ G: sub }), upsert: () => { updates++ } } }
      const result = await merchantCommands.__review.checkMerchantSubscriptions(deps)
      assert.equal(result.pushed, 0)
      assert.equal(updates, 0)
    } finally { Date.now = nativeNow }
  })
  await test('permissions/independent-admin-switches', () => {
    const session = { isDirect: false, userId: 'U', user: { authority: 4 }, event: { member: { roles: ['admin'] } } }
    for (const group of [true, false]) for (const bot of [true, false]) {
      assert.equal(permissions.canManageSubscription({ ...config, subscriptionGroupAdminEnabled: group, subscriptionBotAdminEnabled: bot }, session), group || bot)
    }
  })
  const summary = { total: results.length, passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length }
  console.log(JSON.stringify(summary))
  fs.writeFileSync(path.join(root, 'docs/alignment-review-results.json'), JSON.stringify({ date: '2026-09-21', scope: 'offline source tests; synthetic fixtures, no production API', summary, results }, null, 2) + '\n')
  process.exitCode = summary.failed ? 1 : 0
})().catch(error => { console.error(error); process.exitCode = 1 })
