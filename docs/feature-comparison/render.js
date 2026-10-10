// 双插件功能渲染对比图生成器：node docs/feature-comparison/render.js [--only key1,key2]
// 左侧渲染 Yunzai（WeGame-GameModules rocom）模板，右侧渲染 Koishi（本仓库）模板，
// 逐功能拼接为对比图，并生成功能矩阵总图。所有 HTTP(S) 请求被拦截，仅用本地资源。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const puppeteer = require('puppeteer-core')
const template = require('art-template')
const { Renderer } = require('../../lib/render')

const ROOT = path.resolve(__dirname, '../..')
// 模板读取基点为 resources/render；模板内 {{_res_path}} 指向 resources/。
const WG = process.env.WEGAME_ROCOM_RESOURCES
  || path.join(process.env.TEMP || os.tmpdir(), 'WeGame-GameModules-rocom', 'resources', 'render')
const WG_RES_ROOT = path.resolve(WG, '..')
const OUT = __dirname
const executablePath = process.env.ROCOM_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const AVATAR = 'file:///' + path.join(ROOT, 'src/img/小洛克.png').replaceAll('\\', '/')
const PET_ICON = 'file:///' + path.join(ROOT, 'src/img/精灵pg.png').replaceAll('\\', '/')

const fileUrl = p => 'file:///' + path.resolve(p).replaceAll('\\', '/')

// ---------- 数据集 ----------
const menuData = {
  pageTitle: '洛克王国插件',
  pageSubtitle: 'WeGame · RoCom 数据查询',
  menuGroups: [
    { groupTitle: '账号管理', menuItems: [
      { cmd: '洛克.QQ登录', desc: 'QQ 扫码绑定账号' },
      { cmd: '洛克.绑定列表', desc: '查看已绑定账号' },
      { cmd: '洛克.切换', desc: '切换主账号' },
    ] },
    { groupTitle: '数据查询', menuItems: [
      { cmd: '洛克.档案', desc: '查看个人档案' },
      { cmd: '洛克.家园', desc: '查询家园菜园' },
      { cmd: '洛克.背包', desc: '查看精灵背包' },
    ] },
    { groupTitle: '订阅推送', menuItems: [
      { cmd: '远行商人', desc: '查看当前商品' },
      { cmd: '订阅远行商人', desc: '订阅商品提醒' },
      { cmd: '订阅家园生蛋', desc: '精灵生蛋提醒' },
    ] },
  ],
}

const homeData = {
  homeName: '星光小筑',
  uid: '12345678',
  updatedAt: '2026-10-10 12:00:00',
  summaryCards: [{ value: '30' }, { value: '85' }, { value: '12' }, { value: '6' }],
  gardenPlots: [
    { iconUrl: '', plantName: '雪怪果实', progress: 80, leftTimeText: '2小时后成熟', stateType: 'progress' },
    { iconUrl: '', plantName: '火龙果', progress: 100, leftTimeText: '已成熟', stateType: 'ready' },
    { iconUrl: '', plantName: '空田地', progress: 0, leftTimeText: '未种植', stateType: 'idle' },
  ],
  guardPets: [{ name: '圣光迪莫', statusText: '守卫中', statusClass: 'guard', iconUrl: PET_ICON, starIconUrl: '', level: 100, note: '家园守卫位' }],
  indoorPets: [
    { iconUrl: PET_ICON, starIconUrl: '', level: 88, name: '完全体甲', statusText: '可收取灵感', statusClass: 'progress', note: '1小时30分钟后生蛋' },
    { iconUrl: PET_ICON, starIconUrl: '', level: 50, name: '普通乙', statusText: '灵感收集中', statusClass: 'progress', note: '等待生蛋' },
    { iconUrl: PET_ICON, starIconUrl: '', level: 30, name: '未喂食丙', statusText: '未喂食', statusClass: 'idle', note: '未喂食' },
    { iconUrl: PET_ICON, starIconUrl: '', level: 66, name: '可收蛋丁', statusText: '可收取灵感', statusClass: 'ready', note: '可收取' },
  ],
}

const homePetsData = {
  homeName: '星光小筑',
  uid: '12345678',
  total: 3,
  eggCount: 1,
  updatedAt: '2026-10-10 12:00:00',
  emptyText: '未获取到家园精灵信息。',
  pets: [
    { name: '完全体甲', level: 88, genderText: '♀ 雌性', weightText: '35.6kg', voiceText: '98 dB · 婉转声', variantText: '异色', eggReady: true, eggText: '可收蛋', iconUrl: PET_ICON, starIconUrl: '' },
    { name: '普通乙', level: 50, genderText: '♂ 雄性', weightText: '12kg', voiceText: '40 dB', variantText: '', eggReady: false, eggText: '2小时30分钟后生蛋', iconUrl: PET_ICON, starIconUrl: '' },
    { name: '炫彩丙', level: 30, genderText: '未知', weightText: '--', voiceText: '--', variantText: '炫彩', eggReady: false, eggText: '', iconUrl: PET_ICON, starIconUrl: '' },
  ],
}

const petDetailCommon = {
  title: '家园详情',
  subtitle: 'Ingame Pet Data',
  uid: '12345678',
  playerName: '测试玩家',
  playerLevel: '100',
  worldLevel: '60',
  onlineText: '在线',
  queryMode: '家园批量',
  updatedAt: '2026-10-10 12:00',
  notice: '数据来自游戏内实时接口，目标玩家需在线。',
  emptyText: '未获取到家园精灵数据。',
}

const recordData = {
  userName: '测试玩家',
  userLevel: 100,
  userUid: '12345678',
  userAvatarDisplay: AVATAR,
  defaultAvatar: AVATAR,
  winRate: '66%',
  totalMatch: 128,
  pageText: '第 1 / 8 页',
  footerCommandHint: '洛克.战绩 <页码>',
  commandHint: '洛克.战绩 <页码>',
  copyright: 'Koishi & WeGame 洛克王国插件',
  battles: [
    { date: '2026-10-09', time: '21:30', result: 'win', leftName: '测试玩家', leftAvatar: AVATAR, leftBadge: '胜', leftPets: [{ icon: PET_ICON }, { icon: PET_ICON }], rightName: '对手A', rightAvatar: AVATAR, rightBadge: '负', rightPets: [{ icon: PET_ICON }, { icon: PET_ICON }] },
    { date: '2026-10-09', time: '20:05', result: 'fail', leftName: '测试玩家', leftAvatar: AVATAR, leftBadge: '负', leftPets: [{ icon: PET_ICON }], rightName: '对手B', rightAvatar: AVATAR, rightBadge: '胜', rightPets: [{ icon: PET_ICON }, { icon: PET_ICON }, { icon: PET_ICON }] },
  ],
}

const exchangeHallData = {
  filterLabel: '全部',
  currentPage: 1,
  totalPages: 3,
  commandHint: '洛克.交换大厅 <页码>',
  copyright: 'Koishi & WeGame 洛克王国插件',
  posts: [
    { userId: '10086', userName: '洛克玩家甲', userLevel: 'Lv.60', avatarUrl: AVATAR, timeLabel: '10-09 21:30', wantBadgeUrl: '', wantText: '想要：上古战龙（任意性格）', provideItems: [{ label: '雪怪果实 ×2' }, { label: '魔法橱柜 ×1' }] },
    { userId: '10087', userName: '玩家乙', userLevel: 'Lv.45', avatarUrl: AVATAR, timeLabel: '10-09 18:12', wantBadgeUrl: '', wantText: '想要：炫彩音速犬', provideItems: [{ label: '棱镜球 ×5' }] },
  ],
}

const lineupData = {
  category: '闪耀大赛',
  page_no: 1,
  total_pages: 2,
  fallbackPetImage: PET_ICON,
  commandHint: '洛克.阵容 <分类> <页码>',
  copyright: 'Koishi & WeGame 洛克王国插件',
  lineups: [
    {
      name: '速攻强队', tags: ['热门', '上分'], likes: 1234,
      author_name: '阵容大师', author_avatar: AVATAR, lineup_code: '59',
      lineup: { pets: [
        { pet_name: '先锋甲', pet_img_url: PET_ICON, skills_info: [{ skill_img_url: '' }, { skill_img_url: '' }, { skill_img_url: '' }, { skill_img_url: '' }] },
        { pet_name: '主力乙', pet_img_url: PET_ICON, skills_info: [{ skill_img_url: '' }, { skill_img_url: '' }, { skill_img_url: '' }, { skill_img_url: '' }] },
        { pet_name: '压轴丙', pet_img_url: PET_ICON, skills_info: [{ skill_img_url: '' }, { skill_img_url: '' }] },
      ] },
    },
  ],
}

const activitiesData = {
  title: '洛克活动日历',
  subtitle: '2026-10-10 · Asia/Shanghai',
  commandHint: '洛克.日历',
  copyright: 'Koishi & WeGame 洛克王国插件',
  axis_dates: [{ label: '10-08', left_pct: 5 }, { label: '10-09', left_pct: 25 }, { label: '10-10', left_pct: 45 }, { label: '10-11', left_pct: 65 }, { label: '10-12', left_pct: 85 }],
  now_line: { label: '现在', left_pct: 45 },
  lanes: [
    { label: '限时活动', left_pct: 0, items: [
      { name: '双倍经验周', theme: 'exp', statusText: '进行中', statusClass: 'active', time_label: '10-08 ~ 10-12', cover: '', desc: '全场景经验掉落翻倍', rewards_text: '经验加成', width_pct: 45, left_pct: 5 },
      { name: '周末狂欢', theme: 'party', statusText: '未开始', statusClass: 'upcoming', time_label: '10-11 ~ 10-12', cover: '', desc: '周末登录领好礼', rewards_text: '礼包', width_pct: 25, left_pct: 65 },
    ] },
    { label: '常驻活动', left_pct: 0, items: [
      { name: '每日签到', theme: 'daily', statusText: '进行中', statusClass: 'active', time_label: '常驻', cover: '', desc: '每日登录领取奖励', rewards_text: '金币/道具', width_pct: 90, left_pct: 5 },
    ] },
  ],
}

const packageData = {
  pageTitle: '精灵背包',
  accountLabel: '默认账号',
  userName: '测试玩家',
  userLevel: 'Lv.100',
  userUid: '12345678',
  userAvatar: AVATAR,
  defaultAvatar: AVATAR,
  tabs: [{ text: '全部' }, { text: '了不起' }, { text: '异色' }, { text: '炫彩' }],
  currentTab: '全部',
  currentPage: 1,
  totalPages: 5,
  totalCount: 43,
  pageSize: 10,
  fallbackPetImage: PET_ICON,
  commandHint: '洛克.背包 <分类> <页码>',
  copyright: 'Koishi & WeGame 洛克王国插件',
  pets: [
    { name: '圣光迪莫', level: 100, custom_name: '', badgeImage: '', elementIcons: [{ src: PET_ICON }] },
    { name: '完全体甲', level: 88, custom_name: '小甲', badgeImage: '', elementIcons: [{ src: PET_ICON }] },
    { name: '炫彩丙', level: 30, custom_name: '', badgeImage: '', elementIcons: [{ src: PET_ICON }] },
    { name: '普通乙', level: 50, custom_name: '', badgeImage: '', elementIcons: [] },
  ],
  emptySlots: [{}, {}, {}],
}

// 商人：koishi 与 yunzai 模板布局参数不同，分别构造。
const merchantGoods = [
  { goods_name: '轮次甲·测试球', price: 120, remainingStr: '本轮限购5个', ended: false },
  { goods_name: '全天乙·魔法柜', price: 66, remainingStr: '本日限购1个', ended: false },
  { goods_name: '已售丙·彩果', price: 30, remainingStr: '本轮限购2个', ended: true },
]
function koishiMerchantData() {
  const startY = 592, cardHeight = 308, gap = 43
  const goods = merchantGoods.map((item, index) => ({
    goods_name: item.goods_name,
    iconUrl: PET_ICON,
    price: item.price,
    num: String(index + 1).padStart(2, '0'),
    category: item.ended ? 'round' : 'normal',
    roundId: item.ended ? 2 : 0,
    isHot: !item.ended,
    isEnded: item.ended,
    remainingStr: item.remainingStr,
    top: startY + index * (cardHeight + gap),
  }))
  const lastTop = goods[goods.length - 1].top
  return {
    dateStr: '10.10',
    timeRange: '12:00-16:00',
    goods,
    bottomFrameTop: lastTop + 287,
    pageHeight: lastTop + 287 + 160,
  }
}
function wgMerchantData() {
  const goods = merchantGoods.map((item, index) => ({
    goods_name: item.goods_name,
    iconUrl: PET_ICON,
    price: item.price,
    num: String(index + 1).padStart(2, '0'),
    remainingStr: item.remainingStr,
    ended: item.ended,
    top: 250 + index * 92,
    iconScale: 1, iconOffsetX: 0, iconOffsetY: 0,
  }))
  const lastTop = goods[goods.length - 1].top
  return {
    dateStr: '10.10',
    timeRange: '12:00-16:00',
    goods,
    renderBaseWidth: 271,
    renderBaseHeight: lastTop + 120,
    renderWidth: 271 * 3,
    renderHeight: (lastTop + 120) * 3,
    renderScale: 3,
    renderZoom: 3,
    renderOffset3: 0,
    renderStroke10: 'wg-stroke-10',
    renderStroke11: 'wg-stroke-11',
    bottomFrameTop: lastTop + 28,
  }
}
function wgTodayData() {
  const rows = [
    { label: '当前轮次 12:00-16:00', timeLabel: '12:00 - 16:00', top: 240, iconSize: 34, cellWidth: 62,
      cells: merchantGoods.map(item => ({ goods_name: item.goods_name, iconUrl: PET_ICON, price: item.price, limit: '限5', iconScale: 1, iconOffsetX: 0, iconOffsetY: 0 })) },
    { label: '其它时段 16:00-20:00', timeLabel: '16:00 - 20:00', top: 420, iconSize: 34, cellWidth: 62,
      cells: [{ goods_name: '晚间丁·国王球', iconUrl: PET_ICON, price: 200, limit: '限1', iconScale: 1, iconOffsetX: 0, iconOffsetY: 0 }] },
  ]
  const lastTop = rows[rows.length - 1].top
  return {
    dateStr: '10.10',
    rows,
    startTop: 240,
    renderBaseWidth: 271,
    renderBaseHeight: lastTop + 140,
    renderWidth: 271 * 3,
    renderHeight: (lastTop + 140) * 3,
    renderScale: 3,
    renderZoom: 3,
    renderStroke10: 'wg-stroke-10',
    renderStroke11: 'wg-stroke-11',
    renderStrokeName: 'wg-stroke-name',
    bottomFrameTop: lastTop + 30,
  }
}
function koishiTodayData() {
  const startY = 592, cardHeight = 308, gap = 43
  const goods = [
    ...merchantGoods,
    { goods_name: '晚间丁·国王球', price: 200, remainingStr: '本轮限购1个', ended: false },
  ].map((item, index) => ({
    goods_name: item.goods_name,
    iconUrl: PET_ICON,
    price: item.price,
    num: String(index + 1).padStart(2, '0'),
    category: item.ended ? 'round' : 'normal',
    roundId: item.ended ? 2 : 0,
    isHot: !item.ended,
    isEnded: item.ended,
    remainingStr: item.remainingStr,
    top: startY + index * (cardHeight + gap),
  }))
  const lastTop = goods[goods.length - 1].top
  return {
    dateStr: '10.10',
    goods,
    bottomFrameTop: lastTop + 287,
    pageHeight: lastTop + 287 + 160,
  }
}

// 档案：共有字段 + 双侧差异字段合并提供，模板按需取用。
function radarGeometry() {
  const cx = 130, cy = 130, r = 90
  const dims = [
    { name: '战力', value: 0.8, angle: -90 },
    { name: '收藏', value: 0.7, angle: 0 },
    { name: '捕捉', value: 0.6, angle: 90 },
    { name: '推进', value: 0.5, angle: 180 },
  ]
  const toXY = (angle, radius) => {
    const rad = angle * Math.PI / 180
    return { x: Math.round(cx + radius * Math.cos(rad)), y: Math.round(cy + radius * Math.sin(rad)) }
  }
  const points = dims.map(d => toXY(d.angle, r * d.value))
  const polygon = points.map(p => `${p.x},${p.y}`).join(' ')
  return {
    centerX: cx, centerY: cy, radius: r,
    radarAxes: dims.map(d => { const p = toXY(d.angle, r); return { x1: cx, y1: cy, x2: p.x, y2: p.y } }),
    radarAxisLabels: dims.map(d => { const p = toXY(d.angle, r + 18); return { name: d.name, x: p.x, y: p.y, anchor: 'middle' } }),
    radarDots: points.map(p => ({ x: p.x, y: p.y })),
    radarValueBadges: dims.map((d, i) => { const p = points[i]; return { value: String(Math.round(d.value * 100)), x: p.x - 10, y: p.y - 8, width: 24 } }),
    radarPolygons: [{ points: polygon }],
  }
}
const personalCardData = {
  ...radarGeometry(),
  userName: '测试玩家',
  userLevel: 100,
  userUid: '12345678',
  userAvatarDisplay: AVATAR,
  defaultAvatar: AVATAR,
  backgroundUrl: '',
  signature: '今天也要好好养宠！',
  bestPetName: '圣光迪莫',
  bestPetImageDisplay: PET_ICON,
  fallbackPetImage: PET_ICON,
  enrollDays: 1234,
  currentCollectionCount: 5678,
  itemCount: 8901,
  amazingSpriteCount: 12,
  colorfulSpriteCount: 8,
  fashionCollectionCount: 3,
  collectionHint: '收集进度持续更新',
  aiCommentText: 'AI 点评：整体均衡，战力与收藏兼备，继续加油！',
  summaryTitleParts: [{ text: '实力评估' }],
  summaryCards: [{ label: 'UID', value: '12345678' }, { label: '等级', value: '100' }],
  badges: [{ value: 'Lv.100', x: 10, y: 10, width: 60 }],
  matchResult: 'win',
  opponentName: '对手A',
  opponentAvatarDisplay: AVATAR,
  leftTeamPets: [{ icon: PET_ICON }, { icon: PET_ICON }],
  profileSignature: '今天也要好好养宠！',
  profileStatusText: '',
  profileStatusClass: '',
  profileHeadTags: [{ label: '在线', value: '是' }],
  profileHomeItems: [{ label: '家园等级', value: '30' }],
  profileCardItems: [{ label: '名片皮肤', value: '默认' }],
  profileCardImage: '',
  commandHint: '洛克.档案',
  copyright: 'Koishi & WeGame 洛克王国插件',
}

// 查蛋尺寸：koishi 用 EggService 构造；yunzai 单独构造。
const sizePayload = {
  items: [
    { id: 1, name: '测试精灵甲', height_range_m: [0.1, 0.3], weight_range_kg: [1, 3], match: { layer: 'strict' } },
    { id: 2, name: '测试精灵乙', height_range_m: [0.4, 0.6], weight_range_kg: [30, 40], match: { layer: 'loose' } },
  ],
}
const wgSizeData = {
  query_label: '身高 0.45m / 体重 35.6kg',
  commandHint: '洛克.查蛋 <身高> <体重>',
  copyright: 'Koishi & WeGame 洛克王国插件',
  perfect_matches: [
    { id: '1', name: '测试精灵甲', icon: PET_ICON, type_label: '火系', height_label: '0.40-0.50m', weight_label: '34-36kg', egg_label: '怪兽组', egg_groups_label: '怪兽/飞行', match_label: '严格匹配' },
  ],
  range_matches: [
    { id: '2', name: '测试精灵乙', icon: PET_ICON, type_label: '水系', height_label: '0.40-0.60m', weight_label: '30-40kg', egg_label: '水中组', egg_groups_label: '水中/龙', match_label: '近似匹配' },
  ],
}

// 阵容码：koishi 用 share-code-service 构造；yunzai 单独构造。
const wgShareAssets = () => {
  return {
    frame: fileUrl(path.join(WG, 'share-code-team/assets/立绘背景框.png')),
    logo: fileUrl(path.join(WG, 'share-code-team/assets/eit-logo.png')),
    rocoIcon: fileUrl(path.join(WG, 'share-code-team/assets/roco_icon.png')),
    star: fileUrl(path.join(WG, 'share-code-team/assets/img_xingxingdi.png')),
    wax: fileUrl(path.join(WG, 'share-code-team/assets/火漆印.png')),
  }
}
const wgShareData = {
  shareAssets: wgShareAssets(),
  team: {
    mode_name: '闪耀大赛', share_code: 'ABCD-1234', count_label: '3 只精灵', sprite_count: 3, magic_icon: PET_ICON,
    teams: [
      {
        slotText: '1', color: 'rgb(200,60,60)', pet: { name: '先锋甲', icon: PET_ICON },
        bloodline: { name: '烈焰血脉', icon: '' },
        personality: { name: '固执', up: '攻击+', down: '特攻-' },
        skills: [{ name: '烈焰冲锋', icon: '' }, { name: '蓄力', icon: '' }, { name: '强袭', icon: '' }, { name: '觉醒', icon: '' }],
        ivs_detail: [{ name: '攻击', value: '31' }, { name: '防御', value: '25' }, { name: '速度', value: '28' }],
        typeIcons: [{ name: '火', icon: '' }],
      },
      {
        slotText: '2', color: 'rgb(60,120,200)', pet: { name: '主力乙', icon: PET_ICON },
        bloodline: { name: '深海血脉', icon: '' },
        personality: { name: '开朗', up: '速度+', down: '特攻-' },
        skills: [{ name: '水炮', icon: '' }, { name: '冰冻', icon: '' }, { name: '护盾', icon: '' }, { name: '反击', icon: '' }],
        ivs_detail: [{ name: '防御', value: '30' }, { name: '速度', value: '31' }, { name: '精力', value: '27' }],
        typeIcons: [{ name: '水', icon: '' }],
      },
    ],
  },
  pets: [
    {
      slotText: '1', color: 'rgb(200,60,60)', pet: { name: '先锋甲', icon: PET_ICON },
      bloodline: { name: '烈焰血脉', icon: '' },
      personality: { name: '固执', up: '攻击+', down: '特攻-' },
      skills: [{ name: '烈焰冲锋', icon: '' }, { name: '蓄力', icon: '' }, { name: '强袭', icon: '' }, { name: '觉醒', icon: '' }],
      ivs: [{ name: '攻击', value: '31' }, { name: '防御', value: '25' }, { name: '速度', value: '28' }],
      typeIcons: [{ name: '火', icon: '' }],
    },
  ],
}

// ---------- 功能清单 ----------
const features = [
  { key: 'menu', title: '帮助菜单', note: '双方菜单结构同源；Koishi 侧命令按本插件实际能力组织。', selector: '.menu-page, body', koishi: 'menu', wg: 'menu/index.html', data: menuData },
  { key: 'home', title: '家园查询', note: '同一套模板血缘：菜园/守卫/室内精灵布局一致。', selector: '.home-page, body', koishi: 'home', wg: 'home/index.html', data: homeData },
  { key: 'home-pets', title: '家园精灵一览', note: '本次移植的新功能，两侧模板同源；Koishi 版每张卡片额外显示生蛋倒计时文本。', selector: '.pets-page, .home-pets-page, body', koishi: 'home-pets', wg: 'home-pets/index.html', data: homePetsData },
  { key: 'pet-detail', title: '家园详情（单只精灵完整数据）', note: 'Yunzai 用 pet-detail 模板；Koishi 用 pet-data 模板（含六维、技能、捕捉信息卡片）。', selector: '.pet-page, .pet-data-page, body', koishi: 'pet-data', wg: 'pet-detail/index.html', data: null },
  { key: 'personal-card', title: '档案卡（AI 点评/雷达图）', note: '共有字段同源；Koishi 版增加名片信息、签名、页头标签等扩展区。', selector: '.stats-page, .player-card-page, .stats-cont, body', koishi: 'personal-card', wg: 'personal-card/index.html', data: personalCardData },
  { key: 'record', title: '对战战绩', note: '布局同源；Koishi 版战况行带头像与胜/负角标。', selector: '.record-page, body', koishi: 'record', wg: 'record/index.html', data: recordData },
  { key: 'exchange-hall', title: '交换大厅', note: '模板完全同源。', selector: '.exchange-page, body', koishi: 'exchange-hall', wg: 'exchange-hall/index.html', data: exchangeHallData },
  { key: 'lineup', title: '阵容推荐', note: '模板完全同源。', selector: '.lineup-page, body', koishi: 'lineup', wg: 'lineup/index.html', data: lineupData },
  { key: 'activities', title: '活动日历', note: '模板完全同源（泳道式活动时间轴）。', selector: '.activity-calendar-page, .page-section-main, body', koishi: 'activities', wg: 'activities/index.html', data: activitiesData },
  { key: 'package', title: '精灵背包', note: '模板同源；Koishi 版支持精灵自定义昵称展示。', selector: '.package-page, .package-cont, body', koishi: 'package', wg: 'package/index.html', data: packageData },
  { key: 'size', title: '查蛋尺寸反查', note: '同一功能两种字段口径：Yunzai 用 egg_label/match_label；Koishi 用体型标注（小块头/大块头）与匹配提示。', selector: '.searcheggs-cont, body', koishi: 'searcheggs/size', wg: 'searcheggs/size.html', data: null },
  { key: 'share', title: '阵容码解析卡片', note: 'Yunzai 为古典信笺风格；Koishi 为面板风格，含天赋/技能/解析次数等记录信息。', selector: '.share-page, .share-code-page, body', koishi: 'share-code-team', wg: 'share-code-team/index.html', data: null },
  { key: 'merchant', title: '远行商人（当前轮次）', note: '同一游戏数据的两套视觉：Yunzai 小画布缩放绘制；Koishi 大图卡片（价格/限购/序号）。', selector: '.page, .merchant-page, body', koishi: 'yuanxing-shangren/merchant', wg: 'yuanxing-shangren/merchant.html', data: null },
  { key: 'today', title: '今日远行商人（全天）', note: 'Yunzai 按时段分行排列；Koishi 纵向大图卡片，含历史轮次价格回填。', selector: '.page, .merchant-page, body', koishi: 'yuanxing-shangren/today', wg: 'yuanxing-shangren/today.html', data: null },
]

// ---------- 渲染引擎 ----------
async function withPage(browser, fn) {
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) request.abort()
    else request.continue()
  })
  try {
    return await fn(page)
  } finally {
    await page.close().catch(() => {})
  }
}

async function renderKoishi(browser, renderer, templateName, data) {
  const ctx = { puppeteer: { page: async () => browser.newPage() } }
  // 拦截网络需要包一层 page
  ctx.puppeteer.page = async () => {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (/^https?:/i.test(request.url())) request.abort()
      else request.continue()
    })
    return page
  }
  const pages = await renderer.renderPages(ctx, templateName, data, { maxPageHeight: 12000, timeoutMs: 20000 })
  return pages && pages[0] ? pages[0] : null
}

async function renderWg(browser, relHtml, data, selector) {
  const resUrl = fileUrl(WG_RES_ROOT) + '/'
  const html = template.render(fs.readFileSync(path.join(WG, relHtml), 'utf8'), { ...data, _res_path: resUrl, pluResPath: resUrl })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-wg-render-'))
  const tmp = path.join(tmpDir, relHtml.replaceAll('/', '_'))
  fs.writeFileSync(tmp, html, 'utf8')
  return await withPage(browser, async page => {
    await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 })
    await page.goto(fileUrl(tmp), { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {})
    await page.evaluate(async () => {
      const images = Array.from(document.images)
      await Promise.race([
        Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r }))),
        new Promise(r => setTimeout(r, 1500)),
      ])
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))])
    }).catch(() => {})
    const selectors = String(selector || '').split(',').map(s => s.trim()).filter(Boolean)
    for (const sel of selectors) {
      const el = await page.$(sel)
      if (el) {
        const shot = await el.screenshot({ type: 'png' })
        return Buffer.from(shot)
      }
    }
    const shot = await page.screenshot({ fullPage: true, type: 'png' })
    return Buffer.from(shot)
  })
}

async function compose(browser, title, note, leftPng, rightPng, outFile) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #1c2230; font-family: 'Microsoft YaHei', sans-serif; padding: 24px; }
    h1 { color: #fff; font-size: 26px; margin: 0 0 6px; }
    .note { color: #9fb0c8; font-size: 14px; margin: 0 0 18px; }
    .cols { display: flex; gap: 18px; align-items: flex-start; }
    figure { margin: 0; flex: 1; min-width: 0; background: #262f42; border-radius: 12px; padding: 12px; }
    figcaption { color: #d7e3f4; font-size: 16px; font-weight: 600; padding: 4px 6px 10px; }
    figure.left figcaption { color: #ffd24d; }
    figure.right figcaption { color: #7fd1a8; }
    img { width: 100%; max-height: 2600px; object-fit: contain; display: block; border-radius: 6px; background: #12161f; }
  </style></head><body>
    <h1>${title}</h1>
    <p class="note">${note}</p>
    <div class="cols">
      <figure class="left"><figcaption>Yunzai · WeGame-GameModules/rocom</figcaption><img src="data:image/png;base64,${leftPng.toString('base64')}"></figure>
      <figure class="right"><figcaption>Koishi · koishi-plugin-rocom（本仓库）</figcaption><img src="data:image/png;base64,${rightPng.toString('base64')}"></figure>
    </div>
  </body></html>`
  const tmp = path.join(os.tmpdir(), `compose-${Date.now()}.html`)
  fs.writeFileSync(tmp, html, 'utf8')
  return await withPage(browser, async page => {
    await page.setViewport({ width: 1560, height: 900, deviceScaleFactor: 1 })
    await page.goto(fileUrl(tmp), { waitUntil: 'networkidle0' }).catch(() => {})
    await new Promise(r => setTimeout(r, 300))
    const shot = await page.screenshot({ fullPage: true, type: 'png' })
    fs.writeFileSync(outFile, shot)
    return outFile
  })
}

// ---------- 主流程 ----------
;(async () => {
  if (!fs.existsSync(WG)) {
    console.error(`WeGame 资源目录不存在: ${WG}`)
    console.error('请设置环境变量 WEGAME_ROCOM_RESOURCES 指向 WeGame-GameModules-rocom/resources')
    process.exit(1)
  }
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1].split(',').map(s => s.trim())
    : null
  const { EggService } = require('../../lib/egg-service')
  const { buildShareCodeView } = require('../../lib/share-code-service')
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-background-networking'] })
  const renderer = new Renderer(ROOT, { timeoutMs: 20000, deviceScaleFactor: 1 })

  try {
    for (const feature of features) {
      if (only && !only.includes(feature.key)) continue
      let data = feature.data
      let dataWg = feature.data
      if (feature.key === 'merchant') { data = koishiMerchantData(); dataWg = wgMerchantData() }
      if (feature.key === 'today') { data = koishiTodayData(); dataWg = wgTodayData() }
      if (feature.key === 'size') {
        data = Object.create(EggService.prototype).buildSizeSearchDataFromApi(18, 1, sizePayload)
        dataWg = wgSizeData
      }
      if (feature.key === 'share') {
        data = buildShareCodeView({ teams: [{ pet: { id: 1, name: '先锋甲' }, ivs_detail: [{ id: 1, name: '攻击天赋' }] }] }, 'parse', undefined, 'https://example.invalid')
        dataWg = wgShareData
      }
      if (feature.key === 'pet-detail') {
        data = koishiPetDetailData()
        dataWg = wgPetDetailData()
      }
      const left = await renderWg(browser, feature.wg, dataWg, feature.selector).catch(err => { console.error(`wg ${feature.key}: ${err.message}`); return null })
      const right = await renderKoishi(browser, renderer, feature.koishi, data).catch(err => { console.error(`koishi ${feature.key}: ${err.message}`); return null })
      if (!left || !right) { console.log('SKIP', feature.key); continue }
      const out = path.join(OUT, `${feature.key}-对比.png`)
      await compose(browser, feature.title, feature.note, left, right, out)
      console.log('OK', feature.key, '->', path.relative(ROOT, out))
    }
    console.log('done')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

// ---------- 家园详情双侧数据 ----------
function koishiPetDetailData() {
  const attr = (label, value, race, talent) => ({ label, value, race, talent, percent: Math.min(100, Math.round(value)) })
  return {
    ...petDetailCommon,
    summaryCards: [{ label: '在线', value: '在线' }, { label: '等级', value: '100' }],
    commandHint: '洛克.家园详情 <UID>',
    copyright: 'Koishi & WeGame 洛克王国插件',
    pets: [{
      index: 1, status: 'ok', statusText: '成功', retCode: '0',
      name: '完全体甲', defaultName: '甲', level: '88', baseId: '101', confId: '101', petGid: 'g1', npcId: '9001', npcIdSource: 'pet_gid+furniture_guid',
      imageUrl: PET_ICON, iconUrl: PET_ICON, variantText: '异色', errorText: '',
      voiceText: '98 dB',
      specialityIds: '103', relationshipType: '好友', 
      cards: [
        { label: '体重', value: '35.6kg', hint: '大块头（体重位于前 5%）', className: 'size-big' },
        { label: '声音', value: '98 dB', hint: '婉转声 96~100', className: 'voice-soft' },
        { label: '性格', value: '固执', hint: '', className: '' },
        { label: '血脉', value: '烈焰血脉', hint: '', className: '' },
      ],
      attributes: [attr('精力', 31, 28, 3), attr('攻击', 30, 25, 5), attr('防御', 25, 20, 5), attr('特攻', 18, 15, 3), attr('特防', 20, 18, 2), attr('速度', 28, 22, 6)],
      skills: [
        { name: '烈焰冲锋', icon: '', type: '火', element: '火', pos: '1', cost: '2', power: '90', status: '已装备', statusClass: 'equipped', unlock: '' },
        { name: '蓄力', icon: '', type: '普通', element: '普通', pos: '2', cost: '1', power: '0', status: '已装备', statusClass: 'equipped', unlock: '' },
        { name: '强袭', icon: '', type: '火', element: '火', pos: '3', cost: '3', power: '110', status: '未装备', statusClass: '', unlock: 'Lv.90' },
      ],
      catchItems: [
        { label: '捕捉等级', value: '60' }, { label: '捕捉方式', value: '精灵球' }, { label: '捕捉营地', value: '火山营地' }, { label: '获得时间', value: '2026-01-01 12:00' },
      ],
    }],
  }
}
function wgPetDetailData() {
  const attr = (label, value, talent, effort) => ({ label, value, talent, effort })
  return {
    uid: '12345678',
    emptyText: '未获取到家园精灵数据。',
    pets: [{
      name: '完全体甲', level: '88', iconUrl: PET_ICON, imageUrl: PET_ICON,
      genderText: '♀ 雌性', natureText: '固执', voiceText: '98 dB', voiceLabel: '婉转声',
      variantIcon: '', typeColor: 'rgb(200,60,60)',
      bloodTag: { name: '烈焰血脉', icon: '', color: 'rgb(200,60,60)' },
      feature: { name: '特性甲', desc: '出场时提升攻击' }, featureIcon: '', fallbackFeatureIcon: '',
      fallbackIconUrl: PET_ICON, fallbackIconUrl2: PET_ICON,
      typeTags: [{ name: '火', icon: '', color: 'rgb(200,60,60)' }],
      attributes: [attr('精力', '31', '28', '3'), attr('攻击', '30', '25', '5'), attr('防御', '25', '20', '5'), attr('特攻', '18', '15', '3'), attr('特防', '20', '18', '2'), attr('速度', '28', '22', '6')],
      equipSkills: [{ name: '烈焰冲锋', iconUrl: '', fallbackIconUrl: PET_ICON, typeIcon: '', typeColor: 'rgb(200,60,60)', families: '火', cost: '2' }],
      learnedSkills: [
        { name: '蓄力', iconUrl: '', fallbackIconUrl: PET_ICON, typeIcon: '', typeColor: 'rgb(150,150,150)', families: '普通', cost: '1' },
        { name: '强袭', iconUrl: '', fallbackIconUrl: PET_ICON, typeIcon: '', typeColor: 'rgb(200,60,60)', families: '火', cost: '3' },
      ],
      errorText: '',
    }],
  }
}
