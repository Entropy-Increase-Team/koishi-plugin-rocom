// Check the supplied September response examples, without network requests.
// Run: node tests/player-response-review.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const template = require('art-template')
const root = path.resolve(__dirname, '..')
require.extensions['.ts'] = (module, filename) => {
  let source = fs.readFileSync(filename, 'utf8')
  if (filename === path.join(root, 'src/commands/query.ts')) {
    source += '\nexport const __review = { buildPlayerSearchRenderData };'
  }
  module._compile(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText, filename)
}
const { RocomClient } = require('../src/client.ts')
const player = require('../src/player-service.ts')
const query = require('../src/commands/query.ts').__review
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'src/doc', name), 'utf8').replace(/^\uFEFF/, ''))
const searchExample = read('player-search.json')
const cardExample = read('player-card.json')
const uid = String(searchExample.data.player_info.uin)
const base = 'https://example.invalid'
const results = []
async function test(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name) }
  catch { results.push({ name, passed: false }); console.log('FAIL', name) }
}
function mockHttp(example) {
  const calls = []
  return { calls, ctx: { http: async (method, url, options) => {
    calls.push({ method, url, options })
    return { status: 200, data: structuredClone(example) }
  } } }
}
;(async () => {
  let search, card
  await test('search/http-envelope-and-nested-player', async () => {
    const mock = mockHttp(searchExample)
    search = await new RocomClient(base, '').ingamePlayerSearch(mock.ctx, uid)
    assert.deepEqual(search, searchExample.data)
    assert.equal(mock.calls.length, 1) // meta.task_id must not trigger another task request.
  })
  await test('card/http-envelope-and-nested-card', async () => {
    const mock = mockHttp(cardExample)
    card = await new RocomClient(base, '').ingamePlayerCard(mock.ctx, uid)
    assert.deepEqual(card, cardExample.data)
    assert.equal(mock.calls.length, 1)
  })
  await test('search/basic-home-and-offline-values', () => {
    const p = player.parseIngamePlayerPayload(search, uid)
    assert.equal(p.nickname, searchExample.data.player_info.name)
    assert.equal(p.level, '57')
    assert.equal(p.uid, uid)
    assert.equal(player.playerField(p, 'online'), '否')
    assert.equal(player.playerField(p, 'home_level'), '10')
    assert.equal(player.playerField(p, 'home_comfort_level'), '3400')
    assert.equal(player.playerField(p, 'visitor_num'), '0')
  })
  await test('card/merge-collection-avatar-skin-and-signature', () => {
    const p = player.parseIngamePlayerPayload(player.mergePlayerPayloads(search, card), uid)
    assert.equal(p.nickname, searchExample.data.player_info.name)
    assert.equal(player.playerField(p, 'collected_shining_pet_count'), '4')
    assert.equal(player.playerField(p, 'collected_glass_pet_count'), '28')
    assert.equal(player.playerField(p, 'card_icon_selected'), '1001017')
    assert.equal(player.playerField(p, 'card_skin_selected'), '48')
    assert.equal(p.signature, searchExample.data.player_info.signature)
  })
  await test('card/no-uid-preserves-search-context', () => {
    assert.equal(player.playerPayloadUid(card), '')
    assert.equal(player.buildPlayerView(search, card, uid, base).parsed.uid, uid)
  })
  await test('card/relative-marker-is-not-a-url-directory', () => {
    const raw = cardExample.data.player_card_brief_info.business_card_info.cur_card_url
    assert.ok(raw.startsWith('relative/'))
    assert.equal(player.buildPlayerView(search, card, uid, base).cardImageUrl, base + '/' + raw.slice('relative/'.length))
  })
  await test('search/relative-marker-is-not-a-url-directory', () => {
    const raw = searchExample.data.player_info.card_bussiness_card_url
    assert.equal(player.buildPlayerView(search, null, uid, base).cardImageUrl, base + '/' + raw.slice('relative/'.length))
  })
  await test('player/template-receives-new-collection-fields', () => {
    const merged = player.mergePlayerPayloads(search, card)
    const view = player.buildPlayerView(search, card, uid, base)
    const data = query.buildPlayerSearchRenderData(merged, uid, view.cardImageUrl)
    assert.equal(data.collectedShining, '4')
    assert.equal(data.collectedGlass, '28')
    const html = template.render(fs.readFileSync(path.join(root, 'src/render-templates/player-search/index.html'), 'utf8'), {
      ...data, _res_path: 'file:///review-assets/',
    })
    assert.ok(html.includes('异色收集') && html.includes('炫彩收集'))
  })
  await test('formatted-business-payload-in-completed-task', async () => {
    const mock = mockHttp({ code: 0, data: { task_id: 'review-task', status: 'completed', result: cardExample.data } })
    const data = await new RocomClient(base, '').ingamePlayerCard(mock.ctx, uid)
    assert.deepEqual(data, cardExample.data)
  })
  const p = player.parseIngamePlayerPayload(player.mergePlayerPayloads(search, card), uid)
  const data = query.buildPlayerSearchRenderData(player.mergePlayerPayloads(search, card), uid)
  const observations = {
    lastLogoutShownAsRawTimestamp: data.sections.some(section => section.items.some(item =>
      item.label === '最后离线' && item.value === String(searchExample.data.player_info.last_logout_time))),
    cardHasExplicitUid: Boolean(player.playerPayloadUid(card)),
    readFields: Object.keys(p.rowMap),
    additionalUnmappedCardFields: ['card_fashion_bond_collect_num', 'card_label_first_selected', 'card_label_last_selected', 'card_music_id']
      .filter(key => cardExample.data.player_card_brief_info[key] !== undefined && p.rowMap[key] === undefined),
  }
  const summary = { total: results.length, passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length }
  const output = { scope: 'local supplied JSON examples; mocked HTTP; no production requests or messages', summary, results, observations }
  fs.writeFileSync(path.join(root, 'docs/player-response-review-results.json'), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(summary))
  console.log(JSON.stringify({ lastLogoutShownAsRawTimestamp: observations.lastLogoutShownAsRawTimestamp,
    additionalUnmappedCardFields: observations.additionalUnmappedCardFields }))
  process.exitCode = summary.failed ? 1 : 0
})().catch(error => { console.error(error.message); process.exitCode = 1 })
