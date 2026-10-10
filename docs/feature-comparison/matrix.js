// 功能矩阵总图生成器：node docs/feature-comparison/matrix.js
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const puppeteer = require('puppeteer-core')

const OUT = path.join(__dirname, '功能矩阵.png')
const executablePath = process.env.ROCOM_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const fileUrl = p => 'file:///' + path.resolve(p).replaceAll('\\', '/')

// 能力对照：✓ 支持 · ≈ 部分支持/形态不同 · — 不支持
const rows = [
  ['账号绑定（QQ/微信扫码、导入、切换）', '✓', '✓'],
  ['档案卡（AI 点评 / 雷达图）', '✓', '✓（扩展名片、签名信息）'],
  ['玩家查询 / 战绩 / 背包', '✓', '✓'],
  ['阵容推荐 / 阵容详情', '✓', '✓'],
  ['交换大厅', '✓', '✓'],
  ['家园查询（菜园/守卫/室内精灵）', '✓', '✓'],
  ['家园精灵一览（体重/声音/生蛋）', '✓', '✓（本次移植，含生蛋倒计时）'],
  ['家园详情（单只完整数据）', '✓', '✓（含体型/声线 Wiki 标注）'],
  ['家园订阅（菜园/灵感/生蛋）', '仅生蛋', '✓ 三类 + 轻量接口轮询 + @全体 + 订阅列表'],
  ['家园状态即时查询', '✓', '✓（本次移植）'],
  ['查蛋 / 配种 / 尺寸反查', '✓', '✓（含体型前5%/后5%标注）'],
  ['远行商人 / 今日远行商人', '✓', '✓（含历史轮次价格回填）'],
  ['商人商品目录 + 序号订阅', '✓', '✓（本次移植）'],
  ['商人订阅 @全体 / 全部别名 / 设置记忆', '✓', '✓（本次移植）'],
  ['全天商品每日仅推送一次', '—', '✓（上游 astrbot v4.2 移植）'],
  ['活动日历', '✓', '✓'],
  ['公告查询与订阅推送', '—', '✓'],
  ['异色/炫彩收集排行榜', '—', '✓'],
  ['阵容码解析/查询', '✓（解析）', '✓（解析 + 历史记录查询）'],
  ['Wiki 查询（新版目录/精灵/技能）', '旧版 Wiki', '✓ 新版 Wiki + 目录菜单'],
  ['本地图鉴下载 / 精灵图鉴', '—', '✓'],
  ['玩家名片 / 好友关系 / 学生认证', '—', '✓'],
  ['换蛋广场（发布/关闭/订阅）', '✓', '—（暂未移植，代码已备）'],
  ['订阅推送渠道', 'Yunzai Bot', 'Koishi（多平台/多 Bot 定向发送）'],
]

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 28px; background: #171d29; font-family: 'Microsoft YaHei', sans-serif; width: 980px; }
  h1 { color: #fff; font-size: 24px; margin: 0 0 4px; }
  .sub { color: #93a5bd; font-size: 13px; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #2b3547; text-align: left; vertical-align: top; }
  th { color: #d7e3f4; background: #222b3d; font-size: 15px; }
  td.f { color: #e8eef7; width: 44%; }
  td.y { color: #ffd24d; width: 24%; }
  td.k { color: #7fd1a8; width: 32%; }
  tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
  .legend { color: #93a5bd; font-size: 12px; margin-top: 12px; }
</style></head><body>
  <h1>Yunzai（WeGame-GameModules/rocom） vs Koishi（koishi-plugin-rocom）功能对照</h1>
  <p class="sub">生成于 ${new Date().toISOString().slice(0, 10)} · 逐功能渲染对比图见同目录 *-对比.png</p>
  <table>
    <tr><th>功能</th><th>Yunzai · WeGame rocom</th><th>Koishi · 本仓库插件</th></tr>
    ${rows.map(([f, y, k]) => `<tr><td class="f">${f}</td><td class="y">${y}</td><td class="k">${k}</td></tr>`).join('\n')}
  </table>
  <p class="legend">✓ 支持 · ≈/文字说明 = 形态差异 · — 不支持</p>
</body></html>`

;(async () => {
  const tmp = path.join(os.tmpdir(), `rocom-matrix-${Date.now()}.html`)
  fs.writeFileSync(tmp, html, 'utf8')
  const browser = await puppeteer.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1040, height: 800, deviceScaleFactor: 2 })
    await page.goto(fileUrl(tmp), { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, 300))
    await page.screenshot({ path: OUT, fullPage: true })
    console.log('OK ->', OUT)
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
