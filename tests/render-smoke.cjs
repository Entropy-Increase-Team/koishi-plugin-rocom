// Run after npm run build. Headless local browser, all HTTP(S) requests blocked.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const puppeteer = require('puppeteer-core')
const { Renderer } = require('../lib/render')
const { buildRankingView } = require('../lib/ranking-service')
const { buildShareCodeView } = require('../lib/share-code-service')
const { buildAnnouncementView } = require('../lib/announcement-service')
const { EggService } = require('../lib/egg-service')
const root = path.resolve(__dirname, '..')
const executablePath = process.env.ROCOM_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
;(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-background-networking'] })
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-smoke-'))
  const results = []
  let requestedRemote = 0
  let clips = []
  const ctx = { puppeteer: { page: async () => {
    const page = await browser.newPage()
    const screenshot = page.screenshot.bind(page)
    page.screenshot = async options => {
      if (options?.clip) clips.push(options.clip)
      return screenshot(options)
    }
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (/^https?:/i.test(request.url())) { requestedRemote++; request.abort() }
      else request.continue()
    })
    return page
  } } }
  try {
    const renderer = new Renderer(root, { timeoutMs: 30000, deviceScaleFactor: 1 })
    const cases = [
      ['pet-ranking', buildRankingView({ total: 50, items: Array.from({ length: 50 }, (_, i) => ({
        rank: i + 1, player_name: '测试玩家' + (i + 1), collected_shining_pet_count: 100 - i,
        collected_glass_pet_count: i, card_signature: '榜单分页验证',
      })) }, 'shining', 'https://example.invalid'), 2],
      ['share-code-team', buildShareCodeView({ teams: [{ pet: { id: 1, name: '测试精灵' }, ivs_detail: [{ id: 1, name: '测试天赋' }] }] }, 'parse', undefined, 'https://example.invalid'), 1],
      ['announcement/detail', buildAnnouncementView({ title: '长公告', content: '<p>' + '这是长公告测试正文，所有段落必须保留。\n'.repeat(160) + '最后一段必须保留</p>' }, 'https://example.invalid'), 2],
      ['announcement/list', { title: '公告列表', page: 1, items: [{ id: '1', title: '测试公告', summary: '测试摘要', publishedAt: '2026-09-21' }], commandHint: '洛克.公告', copyright: 'Koishi' }, 1],
      ['player-search', { title: '洛克玩家', heroValue: '测试玩家', heroSubvalue: 'UID 123', summaryCards: [], sections: [],
        showSignature: false, collectedShining: '9173', collectedGlass: '8264', cardImageUrl: '', commandHint: '', copyright: '' }, 1],
      ['searcheggs/size', Object.create(EggService.prototype).buildSizeSearchDataFromApi(18, 1, {
        items: [{ id: 1, name: '测试精灵', height_range_m: [0.1, 0.3], weight_range_kg: [1, 3], match: { layer: 'strict' } }],
      }), 1],
    ]
    for (const [name, data, minimum] of cases) {
      clips = []
      const pages = await renderer.renderPages(ctx, name, data, { maxPageHeight: 3500 })
      assert.ok(pages && pages.length >= minimum, name + ' did not render expected pages')
      for (let i = 0; i < clips.length; i++) {
        assert.ok(clips[i].height <= 3500)
        if (clips.length > 1) assert.ok(clips[i].height > 1000, 'tiny trailing page')
        if (i) assert.ok(Math.abs(clips[i].y - clips[i - 1].y - clips[i - 1].height) < 1, 'gap between pages')
      }
      for (let i = 0; i < pages.length; i++) {
        assert.ok(pages[i].length > 1000, 'empty screenshot')
        fs.writeFileSync(path.join(out, name.replaceAll('/', '-') + '-' + i + '.jpg'), pages[i])
      }
      results.push({ template: name, pages: pages.length, bytes: pages.reduce((sum, page) => sum + page.length, 0) })
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    // Chrome starts with one blank page; every renderer-owned page must close.
    assert.equal((await browser.pages()).length, 1)
    fs.writeFileSync(path.join(root, 'docs/render-review-results.json'), JSON.stringify({ date: '2026-09-21',
      browser: await browser.version(), network: 'HTTP(S) blocked', requestedRemote, results }, null, 2) + '\n')
    console.log(JSON.stringify({ results, screenshots: out, openPages: 1 }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
