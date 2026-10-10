// Offline acceptance review: node tests/alignment-review.cjs
// Loads current TypeScript in memory; no production API, browser, or business-data writes.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const template = require('art-template')
const root = path.resolve(__dirname, '..')
const extraExports = {
  'src/commands/query.ts': '\nexport const __review = { buildPlayerSearchRenderData, canManageGroupSubscription, buildShopRenderData, checkHomeSubscriptions, buildHomePetsViewData, extractHomeEggStatus }',
  'src/commands/merchant.ts': '\nexport const __review = { checkMerchantSubscriptions, canManageGroupSubscription, getSubscriptionTarget, buildConfiguredMerchantRenderPayload, buildConfiguredTodayMerchantRenderPayload, parseMerchantSubscriptionArgs, recordLiveMerchantPrices }',
  'src/commands/tools.ts': '\nexport const __review = { checkAnnouncementSubscriptions }',
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
const { MerchantCatalogService, buildMerchantCatalog, resolveMerchantSelection, describeMerchantItems, isAllAlias } = require('../src/merchant-catalog.ts')
const { MerchantPriceLog } = require('../src/merchant-price-log.ts')
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
  await test('share/classic-view-colors-and-nature', () => {
    const view = share.buildShareCodeView({
      share_code: 'ABCD', sprite_count: 1,
      mode: { name: '闪耀大赛' },
      teams: [{ slot: 1, pet: { id: 1, name: '甲', type_names: ['火'] }, bloodline: { name: '火系血脉' }, personality: { id: 5, name: '固执' },
        ivs_detail: [{ id: 1, name: '攻击' }], skills: [{ id: 11, name: '烈焰冲锋' }] }],
    }, 'parse', undefined, 'https://example.invalid')
    const assets = {
      frame: 'f', logo: 'l', rocoIcon: 'r', star: 's', wax: 'w',
      typeIcon: name => `ti-${name}`, bloodIcon: el => `bl-${el}`,
    }
    const classic = share.buildShareCodeClassicView(view, assets, id => (id === '5' ? { name: '固执', summary: '+攻击 -特攻' } : {}))
    assert.equal(classic.team.mode_name, '闪耀大赛')
    assert.equal(classic.team.teams[0].color, '#db5525')
    assert.equal(classic.team.teams[0].slotText, '01')
    assert.deepEqual(classic.team.teams[0].typeIcons, [{ name: '火', icon: 'ti-火' }])
    assert.equal(classic.team.teams[0].bloodline.icon, 'bl-火')
    assert.equal(classic.team.teams[0].personality.up, '攻击')
    assert.equal(classic.team.teams[0].personality.down, '特攻')
    assert.deepEqual(classic.team.teams[0].ivs_detail, [{ name: '攻击' }])
    assert.equal(classic.shareAssets.frame, 'f')
    // 性格摘要解析器兼容多写法
    assert.deepEqual(share.parseNaturePair('攻击↑ 防御↓'), { up: '攻击', down: '防御' })
    assert.deepEqual(share.parseNaturePair('加速度 减魔攻'), { up: '速度', down: '魔攻' })
  })
  await test('petdata/classic-view-mappings', () => {
    const view = require('../src/pet-data-service.ts').buildPetDetailClassicView({
      npc_pets: [{ pet_gid: 'g1', status: 'ok', npc_pet: { ret_code: 0, pet: {
        base_conf_id: 101, name: '甲', level: 88, gender: 2, nature: 3, blood_id: 2,
        voice: 98, mutation_type: 1, unit_type: ['火'],
        attribute_info: { hp: { base_value: 300, total_race: 320, talent: 28 } },
        skill: { skill_data: [{ id: 11, is_equipped: true, pos: 1 }, { id: 12, is_learned: true, pos: 2 }] },
      } } }],
    }, '12345678', {
      optionsPayload: { pet: { natures: [{ id: 3, name: '固执', summary: '+攻击 -特攻' }], bloodlines: [{ id: 2, name: '火系血脉' }] } },
      skillLookup: { 11: { name: '烈焰冲锋', element_type: '火', cost: 2 }, 12: { name: '蓄力', element_type: '普通', cost: 1 } },
      baseUrl: 'https://example.invalid',
      variantIconPath: m => `render-templates/pet-detail-classic/texture2D/star_${m}.png`,
    })
    assert.equal(view.uid, '12345678')
    const pet = view.pets[0]
    assert.equal(pet.genderText, '♀ 雌性')
    assert.equal(pet.natureText, '固执（+攻击 -特攻）')
    assert.equal(pet.voiceLabel, '婉转声')
    assert.equal(pet.variantIcon, 'render-templates/pet-detail-classic/texture2D/star_1.png')
    assert.equal(pet.bloodTag.name, '火系血脉')
    assert.equal(pet.bloodTag.icon, '火')
    assert.deepEqual(pet.typeTags, [{ name: '火', icon: '火', color: '#db5525' }])
    assert.equal(pet.attributes[0].effort, '320')
    assert.equal(pet.equipSkills.length, 1)
    assert.equal(pet.equipSkills[0].name, '烈焰冲锋')
    assert.equal(pet.learnedSkills.length, 1)
    assert.equal(pet.learnedSkills[0].name, '蓄力')
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
  await test('merchant/allday-detection-and-icon-fallback', () => {
    const sec = iso => Date.parse(iso) / 1000
    const clock = new MerchantClock('Asia/Shanghai')
    const secondsOfDay = ms => { const p = clock.parts(ms); return p.hour * 3600 + p.minute * 60 + p.second }
    // 带 next_refresh_time 的商品随轮次刷新，是 4 小时商品
    assert.equal(merchant.isAllDayMerchantProduct(sec('2026-09-21T15:00:00+08:00') * 1000, null, null, undefined, secondsOfDay), false)
    // 旧接口 round：0 全天，1-4 对应轮次
    assert.equal(merchant.isAllDayMerchantProduct(null, null, null, 0, secondsOfDay), true)
    assert.equal(merchant.isAllDayMerchantProduct(null, null, null, '2', secondsOfDay), false)
    // 起止跨度超过单轮 4 小时视为全天
    assert.equal(merchant.isAllDayMerchantProduct(null, sec('2026-09-21T08:00:00+08:00') * 1000, sec('2026-09-21T23:59:59+08:00') * 1000, undefined, secondsOfDay), true)
    // 仅知结束时间：结束时刻落在当日 24:00 边界视为全天
    assert.equal(merchant.isAllDayMerchantProduct(null, null, Date.parse('2026-09-21T16:00:00+08:00'), undefined, secondsOfDay), false)
    assert.equal(merchant.isAllDayMerchantProduct(null, null, Date.parse('2026-09-22T00:00:00+08:00'), undefined, secondsOfDay), true)
    // 同一商品出现多次，只有全部为全天才按全天去重
    assert.deepEqual([...merchant.collectAllDayProductNames([
      { name: '甲', allDay: true }, { name: '甲', allDay: true }, { name: '乙', allDay: false },
    ])], ['甲'])
    // 缺图标时按 goods_mapping 的 item_id/item_kind 拼 Wiki 物品图；非数字 ID 不生成
    assert.equal(merchant.wikiItemAssetUrl('https://example.invalid/', '12', ''), 'https://example.invalid/api/v1/resources/wiki/assets/items/bag/12.png')
    assert.equal(merchant.wikiItemAssetUrl('https://example.invalid', 'abc', 'pet'), '')
    const items = merchant.normalizeLiveMerchant({
      goods: [{ goods_id: 7, disable_time: sec('2026-09-21T23:59:59+08:00') }],
      _goods_mapping: [{ goods_id: 7, goods_name: '测试商品', item_id: 123, item_kind: 'pet' }],
    }, Date.parse('2026-09-21T12:00:00+08:00'), { assetBaseUrl: 'https://example.invalid', secondsOfDay })
    assert.equal(items[0].icon, 'https://example.invalid/api/v1/resources/wiki/assets/items/pet/123.png')
    assert.equal(items[0].allDay, true)
  })
  await test('merchant/allday-once-and-round-still-pushes', async () => {
    const NativeDate = Date
    const sec = iso => NativeDate.parse(iso) / 1000
    const round3Start = NativeDate.parse('2026-09-21T16:00:00+08:00')
    let nowMs = NativeDate.parse('2026-09-21T12:00:00+08:00')
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [nowMs])) }
      static now() { return nowMs }
    }
    const sends = []
    const store = {
      G1: { platform: 'qq', self_id: 'B', group_id: 'G1', channel_id: 'G1', items: ['全天甲', '轮次'], last_push_round: null, last_matched_items: [] },
      G2: { platform: 'qq', self_id: 'B', group_id: 'G2', channel_id: 'G2', items: ['全天甲'], last_push_round: null, last_matched_items: [] },
    }
    const payload = () => ({ goods: [
      { goods_id: 1, name: '全天甲', start_time: sec('2026-09-21T08:00:00+08:00'), disable_time: sec('2026-09-21T23:59:59+08:00') },
      nowMs < round3Start
        ? { goods_id: 2, name: '轮次乙', start_time: sec('2026-09-21T12:00:00+08:00'), disable_time: sec('2026-09-21T16:00:00+08:00') }
        : { goods_id: 3, name: '轮次丙', start_time: sec('2026-09-21T16:00:00+08:00'), disable_time: sec('2026-09-21T20:00:00+08:00') },
    ] })
    try {
      const deps = { config: { ...config, merchantAllDayOnceEnabled: true },
        ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async (channelId) => { sends.push(channelId); return ['m'] } }] },
        client: { getMerchantInfo: async () => payload() },
        renderer: { renderHtml: async () => Buffer.from('img') },
        merchantSubMgr: { getAll: () => JSON.parse(JSON.stringify(store)), upsert: (k, s) => { store[k] = s } } }
      const first = await merchantCommands.__review.checkMerchantSubscriptions(deps)
      assert.equal(first.pushed, 2)
      assert.deepEqual(store.G1.allday_pushed, { date: '2026-09-21', names: ['全天甲'] })
      assert.deepEqual(store.G2.allday_pushed, { date: '2026-09-21', names: ['全天甲'] })
      // 同一轮再次检查：去重状态生效，不重复推送
      assert.equal((await merchantCommands.__review.checkMerchantSubscriptions(deps)).pushed, 0)
      // 下一轮：只订阅全天商品的会话当天不再推送，同时订阅轮次商品的会话仍每轮推送
      nowMs = round3Start
      const third = await merchantCommands.__review.checkMerchantSubscriptions(deps)
      assert.equal(third.pushed, 1)
      assert.deepEqual(sends, ['G1', 'G2', 'G1'])
      assert.deepEqual(store.G2.allday_pushed, { date: '2026-09-21', names: ['全天甲'] })
    } finally { global.Date = NativeDate }
  })
  await test('merchant/interface-error-waits-and-retries', async () => {
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
        client: { getMerchantInfo: async () => { calls++; if (calls === 4) done(); return null } }, renderer: {} }
      merchantCommands.register(deps)
      interval()
      await Promise.race([finished, new Promise((_, reject) => nativeTimeout(() => reject(Error('retry did not finish')), 300))])
      await new Promise(resolve => nativeTimeout(resolve, 10))
      assert.equal(calls, 4)
      assert.equal(delays.length, 3)
    } finally { global.setTimeout = nativeTimeout; Date.now = nativeNow }
  })
  await test('merchant/catalog-build-and-selection', () => {
    const catalog = buildMerchantCatalog([
      { goods_name: '国王球', id: 1, item_id: 11 },
      { goods_name: '国王球', id: 2 },
      { goods_name: '棱镜球', id: 3 },
    ])
    assert.deepEqual(catalog.map(item => item.name), ['国王球', '棱镜球'])
    assert.equal(catalog[0].index, 1)
    assert.equal(catalog[1].index, 2)
    const resolved = resolveMerchantSelection(['1', '棱镜球', '9', '新商品'], catalog)
    assert.deepEqual(resolved.names, ['国王球', '棱镜球', '新商品'])
    assert.deepEqual(resolved.unknownIndexes, ['9'])
    assert.deepEqual(resolved.unrecognizedNames, ['新商品'])
    assert.equal(isAllAlias('所有物品'), true)
    assert.equal(isAllAlias('all'), true)
    assert.equal(isAllAlias('国王球'), false)
    assert.equal(resolveMerchantSelection(['*'], catalog).all, true)
    assert.equal(describeMerchantItems(['国王球', '新商品'], catalog), '1.国王球、新商品')
    // 目录为空（离线）时文字词条不报未识别；纯数字序号仍按未命中序号处理
    const offline = resolveMerchantSelection(['1', '国王球'], [])
    assert.deepEqual(offline.names, ['国王球'])
    assert.deepEqual(offline.unrecognizedNames, [])
    assert.deepEqual(offline.unknownIndexes, ['1'])
  })
  await test('merchant/price-log-rounds-and-rollover', () => {
    const log = new MerchantPriceLog(path.join(os.tmpdir(), `rocom-price-log-${Date.now()}-${Math.random().toString(36).slice(2)}.json`))
    const day1 = new Date('2026-10-10T04:00:00Z')
    const day2 = new Date('2026-10-11T04:00:00Z')
    log.record([{ goods_id: 7, goods_name: '甲', price: 120, origin_price: 150, buy_limit_num: 5 }], { now: day1, round: 2 })
    log.record([{ goods_id: 7, goods_name: '甲', price: 99 }], { now: day1, round: 3 })
    // 同轮优先，其余轮次退回最近一次观察值
    assert.equal(log.lookup(7, '', 2, day1).price, 120)
    assert.equal(log.lookup(7, '', 3, day1).price, 99)
    assert.equal(log.lookup(7, '', 1, day1).price, 99)
    // 按 goods_id 查不到时按名称兜底
    assert.equal(log.lookup(0, '甲', 0, day1).price, 99)
    // 无效价格不写入
    log.record([{ goods_id: 8, goods_name: '乙', price: 0 }], { now: day1, round: 2 })
    assert.equal(log.lookup(8, '乙', 2, day1), null)
    // 跨天自动清空
    assert.equal(log.lookup(7, '甲', 2, day2), null)
    assert.deepEqual(Object.keys(log.snapshot().items), [])
  })
  await test('merchant/live-prices-recorded-per-round', () => {
    const NativeDate = Date
    const nowMs = NativeDate.parse('2026-10-10T12:00:00+08:00')
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [nowMs])) }
      static now() { return nowMs }
    }
    try {
      const log = new MerchantPriceLog(path.join(os.tmpdir(), `rocom-price-live-${Date.now()}-${Math.random().toString(36).slice(2)}.json`))
      const res = {
        _source: 'live',
        goods: [
          { goods_id: 5, price: 66, limit_buy_num: 3, next_refresh_time: NativeDate.parse('2026-10-10T16:00:00+08:00') / 1000 },
          { goods_id: 6, price: { real: { amount: 88 }, origin: { amount: 120 } } },
        ],
        goods_mapping: [{ goods_id: 5, goods_name: '当前球', item_id: 51 }, { goods_id: 6, goods_name: '全天球', item_id: 61 }],
      }
      merchantCommands.__review.recordLiveMerchantPrices({ merchantPriceLog: log }, res)
      const items = log.snapshot().items
      assert.equal(items['5'].name, '当前球')
      assert.equal(items['5'].price, 66)
      // 12:00 属于第 2 轮，带刷新时间的商品记入轮次 2
      assert.ok(items['5'].by_round['2'])
      assert.equal(items['6'].price, 88)
      assert.equal(items['6'].origin_price, 120)
      // 缺 next_refresh_time 的视为全天（round 0）
      assert.ok(items['6'].by_round['0'])
    } finally { global.Date = NativeDate }
  })
  await test('merchant/today-backfills-logged-prices', () => {
    const NativeDate = Date
    const nowMs = NativeDate.parse('2026-10-10T12:00:00+08:00')
    global.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [nowMs])) }
      static now() { return nowMs }
    }
    try {
      const log = new MerchantPriceLog(path.join(os.tmpdir(), `rocom-price-today-${Date.now()}-${Math.random().toString(36).slice(2)}.json`))
      // 第 1 轮（08:00-12:00）观察到的实时价格
      log.record([{ goods_id: 5, goods_name: '历史球', price: 88, buy_limit_num: 2 }], { now: new Date(NativeDate.parse('2026-10-10T09:00:00+08:00')), round: 1 })
      const sec = iso => NativeDate.parse(iso) / 1000
      const res = {
        _source: 'live',
        goods: [
          { goods_id: 6, start_time: sec('2026-10-10T12:00:00+08:00'), disable_time: sec('2026-10-10T16:00:00+08:00'), next_refresh_time: sec('2026-10-10T16:00:00+08:00'), price: 66 },
          { goods_id: 5, start_time: sec('2026-10-10T08:00:00+08:00'), disable_time: sec('2026-10-10T12:00:00+08:00') },
        ],
        goods_mapping: [{ goods_id: 6, goods_name: '当前球' }, { goods_id: 5, goods_name: '历史球' }],
      }
      const deps = { config, client: {}, renderer: {}, merchantPriceLog: log }
      const view = merchantCommands.__review.buildConfiguredTodayMerchantRenderPayload(deps, res)
      const history = view.products.find(product => product.name === '历史球')
      const current = view.products.find(product => product.name === '当前球')
      // 已结束轮次的商品用当天记录补价，当前轮次保持实时价格
      assert.equal(history.price, 88)
      assert.equal(current.price, 66)
    } finally { global.Date = NativeDate }
  })
  await test('merchant/subscribe-args-aliases-and-mention-memory', () => {
    const parse = merchantCommands.__review.parseMerchantSubscriptionArgs
    const withPrefix = parse('1 国王球', ['默认'])
    assert.equal(withPrefix.mentionAll, true)
    assert.deepEqual(withPrefix.tokens, ['国王球'])
    const atAll = parse('@全体 1 3', ['默认'])
    assert.equal(atAll.mentionAll, true)
    assert.deepEqual(atAll.tokens, ['1', '3'])
    const off = parse('0 国王球', ['默认'])
    assert.equal(off.mentionAll, false)
    // 未指定时为 null，由调用方沿用上次设置
    const plain = parse('', ['默认'])
    assert.equal(plain.mentionAll, null)
    assert.deepEqual(plain.items, ['默认'])
    assert.equal(plain.source, '默认')
    // 全部写法扩展
    for (const token of ['全部', '所有物品', 'all', '*']) {
      assert.equal(parse(token, ['默认']).match_all, true, token)
    }
  })
  await test('home/egg-status-multi-shape-extraction', () => {
    const now = Math.floor(Date.now() / 1000)
    const readyTime = now - 60
    const pendingTime = now + 3600
    const status = query.extractHomeEggStatus({ data: { home_pets: [
      { home_pet_info: { pet_cfg_id: 1, name: '甲' }, have_egg: true },
      { home_pet_info: { pet_cfg_id: 2, name: '乙' }, predicted_egg_time: pendingTime },
    ] } })
    assert.equal(status.readyCount, 1)
    assert.equal(status.totalEggs, 2)
    assert.equal(status.pets[0].ready, true)
    assert.ok(status.pets[1].remaining.includes('小时'))
    const nested = query.extractHomeEggStatus({ result: { eggs: [{ pet_id: 9, name: '丙', egg_ready_time: readyTime }] } })
    assert.equal(nested.readyCount, 1)
    // 顶层计数字段兜底
    const counts = query.extractHomeEggStatus({ ready_egg_count: 2, total_egg_count: 5 })
    assert.equal(counts.readyCount, 2)
    assert.equal(counts.totalEggs, 5)
  })
  await test('home/egg-subscription-uses-light-endpoint', async () => {
    let eggsCalls = 0, fullCalls = 0, sends = 0
    const sub = { uid: '123', kind: 'egg', platform: 'qq', channel_id: 'G', guild_id: 'G', updated_by: 'U', notify_state: {} }
    const deps = { config,
      ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => { sends++; return ['m'] } }] },
      homeSubMgr: { getAll: () => ({ G: sub }), upsert: () => {} },
      userMgr: { getUserBindings: () => [] },
      client: {
        ingameHomeEggs: async () => { eggsCalls++; return { home_pets: [
          { home_pet_info: { pet_cfg_id: 1, name: '甲' }, have_egg: true },
          { home_pet_info: { pet_cfg_id: 2, name: '乙' }, predicted_egg_time: Math.floor(Date.now() / 1000) + 3600 },
        ] } },
        ingameHomeInfo: async () => { fullCalls++; return { home_info: {} } },
      } }
    const result = await query.checkHomeSubscriptions(deps)
    assert.equal(eggsCalls, 1)
    assert.equal(fullCalls, 0)
    assert.equal(result.pushed, 1)
    assert.equal(sends, 1)
  })
  await test('home/egg-subscription-falls-back-to-full-info', async () => {
    let eggsCalls = 0, fullCalls = 0, sends = 0
    const sub = { uid: '123', kind: 'egg', platform: 'qq', channel_id: 'G', guild_id: 'G', updated_by: 'U', notify_state: {} }
    const deps = { config,
      ctx: { bots: [{ platform: 'qq', selfId: 'B', sendMessage: async () => { sends++; return ['m'] } }] },
      homeSubMgr: { getAll: () => ({ G: sub }), upsert: () => {} },
      userMgr: { getUserBindings: () => [] },
      renderer: { resourceUrl: () => 'file:///star.png' },
      client: {
        ingameHomeEggs: async () => { eggsCalls++; return null },
        ingameHomeInfo: async () => { fullCalls++; return { home_info: { home_pets: [
          { home_pet_info: { pet_cfg_id: 3, name: '丙' }, have_egg: true },
        ] } } },
      } }
    const result = await query.checkHomeSubscriptions(deps)
    assert.equal(eggsCalls, 1)
    assert.equal(fullCalls, 1)
    // 单只可收蛋：首个 + 全部 两档合并为一条消息推送
    assert.equal(result.pushed, 2)
    assert.equal(sends, 1)
  })
  await test('home/home-pets-view-joins-and-sorts', () => {
    const deps = { renderer: { resourceUrl: rel => 'file:///' + rel } }
    const pending = Math.floor(Date.now() / 1000) + 7200
    const payload = {
      home_info: {
        home_brief_info: { home_name: '测试小屋' },
        cell_info: { home_pets: [
          { home_pet_info: { pet_gid: 'g1', pet_cfg_id: 101, name: '展示甲' }, have_egg: false, predicted_egg_time: pending },
          { home_pet_info: { pet_gid: 'g0', pet_cfg_id: 0, name: '守卫' }, is_guard: true },
        ] },
      },
      npc_pets: [
        { pet_gid: 'g1', status: 'ok', npc_pet: { pet: { base_conf_id: 101, name: '完全体甲', level: 88, gender: 2, weight: 35600, voice: 98, mutation_type: 1 } } },
      ],
    }
    const data = query.buildHomePetsViewData(deps, payload, '123')
    assert.equal(data.homeName, '测试小屋')
    assert.equal(data.pets.length, 1)
    const pet = data.pets[0]
    assert.equal(pet.name, '完全体甲')
    assert.equal(pet.genderText, '♀ 雌性')
    assert.equal(pet.weightText, '35.6kg')
    assert.ok(pet.voiceText.includes('婉转声'))
    assert.equal(pet.variantText, '异色')
    assert.ok(pet.starIconUrl.includes('star_1.png'))
    assert.ok(pet.eggText.includes('后生蛋'))
    assert.equal(data.eggCount, 0)
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
