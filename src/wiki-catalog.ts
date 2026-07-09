// 新版 RoCom Wiki 目录路由表（移植自上游 astrbot v3.6.0 core/wiki_catalog.py）。
// list_path 由后端 /wiki/catalogs 实时下发；这里只维护详情路径、ID 字段与别名。

export interface WikiCatalog {
  key: string
  title: string
  aliases: string[]
  list_path?: string
  detail_path: string
  id_fields: string[]
  /** null 表示以后端 filters 是否带 q 为准 */
  search: boolean | null
  _backend?: any
}

function route(
  key: string,
  title: string,
  aliases: string[],
  detailPath = '',
  idFields: string[] = [],
  search: boolean | null = null,
): WikiCatalog {
  return { key, title, aliases, detail_path: detailPath, id_fields: idFields, search }
}

export const WIKI_CATALOG_ROUTES: WikiCatalog[] = [
  route('pets', '精灵', ['精灵', '宠物', 'pet', 'pets'], '/api/v1/games/rocom/wiki/pets/{pet_id}', ['pet_id']),
  route('pet-skills', '精灵技能', ['精灵技能', '宠物技能'], '/api/v1/games/rocom/wiki/pets/{pet_id}/skills', ['pet_id'], false),
  route('pet-features', '精灵特性', ['精灵特性', '宠物特性'], '/api/v1/games/rocom/wiki/pets/{pet_id}/features', ['pet_id'], false),
  route('pet-family', '精灵家族', ['精灵家族', '进化链', '形态链'], '/api/v1/games/rocom/wiki/pets/{pet_id}/family', ['pet_id'], false),
  route('pet-egg', '精灵蛋详情', ['精灵蛋详情', '宠物蛋详情'], '/api/v1/games/rocom/wiki/pets/{pet_id}/egg', ['pet_id'], false),
  route('pet-handbook', '精灵图鉴课题', ['精灵图鉴课题', '图鉴课题'], '/api/v1/games/rocom/wiki/pets/{pet_id}/handbook', ['pet_id'], false),
  route('pet-talents', '精灵天赋', ['精灵天赋', '同乘天赋'], '/api/v1/games/rocom/wiki/pets/{pet_id}/talents', ['pet_id'], false),
  route('pet-natures', '精灵性格', ['精灵性格', '性格'], '/api/v1/games/rocom/wiki/pets/{pet_id}/natures', ['pet_id'], false),
  route('pet-profile', '精灵资料', ['精灵资料', '资料页'], '/api/v1/games/rocom/wiki/pets/{pet_id}/profile', ['pet_id'], false),
  route('pet-fruit-section', '精灵关联果实', ['精灵关联果实'], '/api/v1/games/rocom/wiki/pets/{pet_id}/fruit', ['pet_id'], false),
  route('pet-ride', '精灵骑乘', ['精灵骑乘', '骑乘'], '/api/v1/games/rocom/wiki/pets/{pet_id}/ride', ['pet_id'], false),
  route('pet-ecology', '精灵生态', ['精灵生态', '生态'], '/api/v1/games/rocom/wiki/pets/{pet_id}/ecology', ['pet_id'], false),
  route('pet-stories', '精灵故事', ['精灵故事', '故事'], '/api/v1/games/rocom/wiki/pets/{pet_id}/stories', ['pet_id'], false),
  route('pet-acquisition', '精灵获取方式', ['精灵获取', '获取方式'], '/api/v1/games/rocom/wiki/pets/{pet_id}/acquisition', ['pet_id'], false),
  route('skills', '技能', ['技能', 'skill', 'skills'], '/api/v1/games/rocom/wiki/skills/{skill_id}', ['skill_id']),
  route('skill-pets', '技能可用精灵', ['技能可用精灵', '技能精灵'], '/api/v1/games/rocom/wiki/skills/{skill_id}/pets', ['skill_id'], false),
  route('skill-stones', '技能石', ['技能石', 'skillstone', 'skill-stone'], '/api/v1/games/rocom/wiki/skill-stones/{item_id}', ['item_id']),
  route('skill-stone-recipes', '技能石配方', ['技能石配方', '技能配方', 'skillstonerecipe'], '/api/v1/games/rocom/wiki/skill-stone-recipes/{item_id}', ['item_id']),
  route('items', '物品', ['物品', '道具', 'item', 'items'], '/api/v1/games/rocom/wiki/items/{item_kind}/{item_id}', ['item_kind', 'item_id']),
  route('egg-items', '蛋物品', ['蛋物品', '蛋道具', 'egg-item'], '/api/v1/games/rocom/wiki/egg-items/{item_id}', ['item_id']),
  route('pet-eggs', '精灵蛋', ['精灵蛋', '宠物蛋', '蛋图鉴', 'pet-egg'], '/api/v1/games/rocom/wiki/pet-eggs/{egg_conf_id}', ['egg_conf_id']),
  route('random-eggs', '随机蛋', ['随机蛋', '随机蛋池', 'random-egg'], '/api/v1/games/rocom/wiki/random-eggs/{random_egg_id}', ['random_egg_id']),
  route('pet-fruits', '精灵果实', ['精灵果实', '果实', 'pet-fruit'], '/api/v1/games/rocom/wiki/pet-fruits/{item_id}', ['item_id']),
  route('pet-foods', '精灵食物', ['精灵食物', '食物', 'pet-food'], '/api/v1/games/rocom/wiki/pet-foods/{item_id}', ['item_id']),
  route('pet-gifts', '精灵礼物', ['精灵礼物', '礼物', 'pet-gift'], '/api/v1/games/rocom/wiki/pet-gifts/{item_id}', ['item_id']),
  route('pet-close-level-effects', '亲密等级效果', ['亲密等级', '亲密效果'], '', ['level'], false),
  route('pet-action-close-exp', '行为亲密经验', ['行为亲密', '亲密经验'], '', [], false),
  route('home-egg-lay-rates', '家园产蛋概率', ['家园产蛋', '产蛋概率'], '', [], false),
  route('home-progression', '家园成长', ['家园成长', '家园升级'], '', [], false),
  route('pet-levels', '精灵等级经验', ['精灵等级', '等级经验', 'pet-level'], '/api/v1/games/rocom/wiki/pet-levels/{level}', ['level'], false),
  route('handbook-areas', '图鉴区域', ['图鉴区域', '区域图鉴'], '', ['id'], false),
  route('fruit-trees', '果实树', ['果实树', '树'], '/api/v1/games/rocom/wiki/fruit-trees/{tree_id}', ['tree_id']),
  route('fruit-refresh', '果实刷新精灵', ['果实刷新', '刷新精灵'], '/api/v1/games/rocom/wiki/fruit-refresh/{fruit_item_id}', ['fruit_item_id'], false),
  route('medals', '奖章', ['奖章', '勋章', 'medal'], '/api/v1/games/rocom/wiki/medals/{medal_id}', ['medal_id']),
  route('recipes', '食谱', ['食谱', '料理', 'recipe'], '/api/v1/games/rocom/wiki/recipes/{item_id}', ['item_id']),
  route('balls', '咕噜球', ['咕噜球', '球', 'ball'], '/api/v1/games/rocom/wiki/balls/{ball_id}', ['ball_id']),
  route('plants', '种植', ['种植', '作物', '植物', 'plant'], '/api/v1/games/rocom/wiki/plants/{plant_id}', ['plant_id']),
  route('pet-carryons', '精灵携带物', ['精灵携带物', '携带物', 'carryon'], '/api/v1/games/rocom/wiki/pet-carryons/{carryon_id}', ['carryon_id']),
  route('furniture', '家具', ['家具', 'furniture'], '/api/v1/games/rocom/wiki/furniture/{furniture_id}', ['furniture_id']),
  route('fashion', '服装套装', ['服装', '套装', 'fashion'], '/api/v1/games/rocom/wiki/fashion/{suit_id}', ['suit_id']),
  route('regions', '地区', ['地区', '区域', 'region'], '/api/v1/games/rocom/wiki/regions/{region_id}', ['region_id']),
  route('dungeons', '副本', ['副本', 'dungeon'], '/api/v1/games/rocom/wiki/dungeons/{dungeon_id}', ['dungeon_id']),
  route('mails', '邮件模板', ['邮件', '邮件模板', 'mail'], '/api/v1/games/rocom/wiki/mails/{mail_id}', ['mail_id']),
  route('music', '音乐', ['音乐', 'music'], '/api/v1/games/rocom/wiki/music/{music_id}', ['music_id']),
  route('profile-assets', '个人名片资产', ['名片', '名片资产', 'profile-asset'], '/api/v1/games/rocom/wiki/profile-assets/{asset_type}/{asset_id}', ['asset_type', 'asset_id']),
  route('chat-emojis', '聊天表情', ['表情', '聊天表情', 'emoji'], '/api/v1/games/rocom/wiki/chat-emojis/{emoji_id}', ['emoji_id']),
  route('photo-actions', '拍照动作', ['拍照动作', '动作', 'photo-action'], '/api/v1/games/rocom/wiki/photo-actions/{action_type}/{action_id}', ['action_type', 'action_id']),
  route('tasks', '任务', ['任务', 'task'], '/api/v1/games/rocom/wiki/tasks/{task_id}', ['task_id']),
  route('task-summaries', '剧情摘要', ['剧情', '剧情摘要', 'task-summary'], '/api/v1/games/rocom/wiki/task-summaries/{summary_id}', ['summary_id']),
  route('shops', '商店', ['商店', 'shop'], '/api/v1/games/rocom/wiki/shops/{shop_id}', ['shop_id']),
  route('exchanges', '兑换', ['兑换', 'exchange'], '/api/v1/games/rocom/wiki/exchanges/{exchange_id}', ['exchange_id']),
]

export const WIKI_CATALOG_ROUTES_BY_KEY = new Map(WIKI_CATALOG_ROUTES.map(item => [item.key, item]))

export const WIKI_CATALOG_ROUTES_BY_ALIAS = new Map<string, WikiCatalog>()
for (const item of WIKI_CATALOG_ROUTES) {
  for (const alias of [item.key, item.title, ...item.aliases]) {
    WIKI_CATALOG_ROUTES_BY_ALIAS.set(alias.toLowerCase(), item)
  }
}

// 全局搜索时各目录的展示优先级（越小越靠前）。
const WIKI_GLOBAL_PRIORITIES: Record<string, number> = {
  'pets': 0, 'skills': 0,
  'balls': 1, 'pet-carryons': 1, 'medals': 1, 'plants': 1, 'pet-fruits': 1, 'recipes': 1,
  'pet-eggs': 1, 'random-eggs': 1, 'egg-items': 1, 'skill-stones': 1, 'skill-stone-recipes': 1,
  'pet-foods': 1, 'pet-gifts': 1, 'furniture': 1, 'fashion': 1, 'regions': 1, 'dungeons': 1,
  'tasks': 1, 'task-summaries': 1, 'shops': 1, 'exchanges': 1,
  'mails': 2, 'music': 2, 'chat-emojis': 2, 'photo-actions': 2,
  'items': 3,
  'profile-assets': 4,
}

export function wikiGlobalCatalogPriority(catalog: { key?: string } | null | undefined): number {
  const key = String(catalog?.key || '')
  return WIKI_GLOBAL_PRIORITIES[key] ?? 2
}

const WIKI_KEY_LABELS: Record<string, string> = {
  pet_id: '精灵ID', skill_id: '技能ID', item_id: '物品ID', item_kind: '物品类型',
  egg_conf_id: '蛋配置ID', random_egg_id: '随机蛋ID', tree_id: '果实树ID', medal_id: '奖章ID',
  ball_id: '咕噜球ID', plant_id: '种植ID', carryon_id: '携带物ID', furniture_id: '家具ID',
  suit_id: '套装ID', region_id: '地区ID', dungeon_id: '副本ID', mail_id: '邮件ID',
  music_id: '音乐ID', asset_type: '资产类型', asset_id: '资产ID', emoji_id: '表情ID',
  action_type: '动作类型', action_id: '动作ID', task_id: '任务ID', summary_id: '剧情ID',
  shop_id: '商店ID', exchange_id: '兑换ID', handbook_no: '图鉴编号', stage: '阶段',
  quality: '品质', cost: '能量', power: '威力', level: '等级', total_exp: '累计经验',
  next_level_exp: '升级所需', next_level_total_exp: '下级累计', hatch_label: '孵化时间',
  hatch_seconds: '孵化秒数', egg_type: '蛋类型', egg_size: '蛋尺寸', body_size: '体型',
  type: '类型', skill_type: '技能类型', damage_type: '伤害类型', element_type: '属性',
  label_type: '标签', families: '技能族', pet_count: '可用精灵', learnable_pet_count: '可学习精灵',
  food_close_exp: '亲密经验', close_exp: '亲密经验', home_exp_num: '家园经验',
  furniture_coin_num: '家具币', need_time_label: '制作时间', interaction_count: '交互次数',
  comfort: '舒适度', footprint: '占地', gender: '性别', grade: '品级', bond: '羁绊',
  category: '分类', area: '区域', source: '来源', source_label: '来源', summary: '摘要',
  description: '说明', flavor_text: '背景说明', enabled: '启用', banned: '禁用',
  shareable: '可分享', common: '通用', nest_num: '巢穴数', egg_laying_nest_num: '产蛋巢数',
  pet_lay_egg_rate_percent: '产蛋概率', close_level: '亲密等级', action_label: '行为',
}

export function wikiLabelForKey(key: string): string {
  return WIKI_KEY_LABELS[String(key || '')] || String(key || '').replace(/_/g, ' ')
}

const WIKI_SECTION_TITLES: Record<string, string> = {
  items: '条目', members: '家族成员', probabilities: '概率信息', variants: '蛋型变体',
  voice_percent: '语音概率', topics: '图鉴课题', rewards: '奖励', reward_items: '奖励',
  acquire_methods: '获取方式', acquisition: '获取方式', methods: '获取方式', sources: '来源',
  world_maps: '世界地图', habitats: '栖息地', effects: '效果', rules: '规则', parts: '套装部件',
  tags: '标签', goods: '商品', mall_items: '商城商品', get_items: '获得物品', cost_items: '消耗物品',
  comfort_levels: '舒适度收益', levels: '等级成长', pet_bond_counts: '精灵羁绊',
  pet_home_limits: '入驻上限', settled_bonuses: '入驻加成', enjoy_field_types: '喜欢场景',
  hate_field_types: '讨厌场景', npc_reactions: 'NPC 反应', movements: '骑乘动作',
  blood: '血脉技能', level: '升级习得', machine: '技能石习得', field: '场景习得',
}

export function wikiSectionTitle(key: string): string {
  return WIKI_SECTION_TITLES[String(key || '')] || wikiLabelForKey(key)
}
