import { h, Logger } from 'koishi'
import fs from 'node:fs'
import { PluginDeps } from '../types'
import { sendImageWithFallback } from '../send-image'
import {
  wikiCandidateText,
  buildWikiPetRenderData,
  buildWikiSkillRenderData,
  splitWikiCommandParts,
} from '../wiki-service'

const logger = new Logger('rocom-wiki-cmd')

async function sendImage(deps: PluginDeps, session: any, templateName: string, data: any, fallback: string) {
  const png = await deps.renderer.renderHtml(deps.ctx, templateName, data)
  await sendImageWithFallback(session, png, fallback, `wiki:${templateName}`, deps.config)
}

// 统一 Wiki 入口：目录菜单 / 分类查询 / 全局搜索 / 精灵与技能专属渲染。
async function handleWikiQuery(deps: PluginDeps, session: any, rawText: string) {
  const { ctx, wikiService } = deps
  const trimmed = String(rawText || '').trim()
  const rawKey = trimmed.toLowerCase()
  const catalogsMeta = await wikiService.getCatalogsPayload()

  if (!trimmed || ['帮助', 'help', '类型', '目录', '专题'].includes(rawKey)) {
    const optionsMeta = await wikiService.getOptionsPayload()
    const data = wikiService.buildCatalogRenderData(catalogsMeta, optionsMeta)
    await sendImage(deps, session, 'wiki/menu', data, wikiService.catalogUsageText())
    return
  }

  let { catalog, query, pageNo } = wikiService.parseWikiCommand(trimmed)

  if (catalog) {
    catalog = wikiService.catalogForKeyFromPayload(String(catalog.key || ''), catalogsMeta) || catalog
  }

  if (!catalog) {
    const { parts, pageNo: parsedPageNo } = splitWikiCommandParts(trimmed)
    if (parts.length) {
      const dynamicCatalog = wikiService.dynamicCatalogByToken(parts[0], catalogsMeta)
      if (dynamicCatalog) {
        catalog = dynamicCatalog
        query = parts.slice(1).join(' ').trim()
        pageNo = parsedPageNo
      }
    }
  }

  if (!catalog) {
    const { payload, mode, error } = await wikiService.fetchGlobalSearch(query, pageNo)
    if (error) return error

    if (mode === 'global-detail') {
      const sourceCatalog = payload?._catalog || {}
      const detail = payload?.item && typeof payload.item === 'object' ? payload.item : {}
      const sourceKey = String(sourceCatalog?.key || '')
      if (sourceKey === 'pets') {
        const sections = await wikiService.fetchWikiPetSections(detail.pet_id)
        const data = buildWikiPetRenderData(detail, sections.profile, sections.skills, sections.family, sections.handbook, query)
        await sendImage(deps, session, 'wiki/pet', data, [
          `${data.name} #${data.number}`,
          `属性：${data.type_names.join(' / ') || '暂无'}`,
          `蛋组：${data.egg_groups.join(' / ') || '暂无'}`,
          data.description,
        ].join('\n'))
        return
      }
      if (sourceKey === 'skills') {
        const pets = await deps.client.getWikiSkillPets(ctx, detail.skill_id)
        const data = buildWikiSkillRenderData(detail, pets && typeof pets === 'object' ? pets : {}, query)
        await sendImage(deps, session, 'wiki/skill', data, `${data.name} #${data.skill_id}\n${data.description}`)
        return
      }
      const data = wikiService.buildGenericRenderData(sourceCatalog?.key ? sourceCatalog : { title: '全局搜索', key: 'global' }, detail, query, 'detail', pageNo)
      await sendImage(deps, session, 'wiki/detail', data, `${data.title}\n${data.summary || ''}`)
      return
    }

    const data = wikiService.buildGenericRenderData({ title: '全局搜索', key: 'global' }, payload, query, 'global-search', pageNo)
    await sendImage(deps, session, 'wiki/list', data, `${data.title}\n${data.summary || ''}`)
    return
  }

  if (['pets', 'pet'].includes(catalog.key) && query) {
    const { detail: overview, candidates, error } = await wikiService.resolveWikiPet(query)
    if (error) return error
    if (candidates.length) return wikiCandidateText(query, candidates, '精灵')
    if (!overview) return '获取 Wiki 精灵详情失败：接口未返回有效数据。'
    const sections = await wikiService.fetchWikiPetSections(overview.pet_id)
    const data = buildWikiPetRenderData(overview, sections.profile, sections.skills, sections.family, sections.handbook, query)
    await sendImage(deps, session, 'wiki/pet', data, `${data.name} #${data.number}\n${data.description}`)
    return
  }

  if (['skills', 'skill'].includes(catalog.key) && query) {
    const { detail, candidates, error } = await wikiService.resolveWikiSkill(query)
    if (error) return error
    if (candidates.length) return wikiCandidateText(query, candidates, '技能')
    if (!detail) return '获取技能详情失败：接口未返回有效数据。'
    const pets = await deps.client.getWikiSkillPets(ctx, detail.skill_id)
    const data = buildWikiSkillRenderData(detail, pets && typeof pets === 'object' ? pets : {}, query)
    await sendImage(deps, session, 'wiki/skill', data, `${data.name} #${data.skill_id}\n${data.description}`)
    return
  }

  const { payload, mode, error } = await wikiService.fetchGenericCatalog(catalog, query, pageNo)
  if (error) return error
  const data = wikiService.buildGenericRenderData(catalog, payload, query, mode, pageNo)
  let templateName = 'wiki/detail'
  if (mode === 'list') templateName = 'wiki/list'
  else if (mode === 'suggestions') templateName = 'wiki/suggestions'
  await sendImage(deps, session, templateName, data, `${data.title}\n${data.summary || ''}`)
}

export function register(deps: PluginDeps) {
  const { ctx, atlasService } = deps

  ctx.command('洛克').subcommand('.wiki [name:text]', '查询洛克 Wiki（精灵/技能/物品等，支持全局搜索）')
    .alias('洛克wiki')
    .alias('洛克百科')
    .action(async ({ session }, name = '') => handleWikiQuery(deps, session, name))

  ctx.command('洛克').subcommand('.技能 <name:text>', '查询技能 Wiki')
    .alias('洛克技能')
    .action(async ({ session }, name = '') => handleWikiQuery(deps, session, `技能 ${String(name || '').trim()}`))

  ctx.command('图鉴下载', '下载 Rocom-Atlas 精灵图鉴到本地缓存')
    .alias('洛克图鉴下载')
    .action(async ({ session }) => {
      if (!deps.config.adminUserIds.includes(session?.userId || '')) return '此指令仅限管理员使用。'
      await session?.send?.('开始下载 Rocom-Atlas 图鉴，请稍候…')
      let lastPercent = -20
      try {
        const { imageCount, totalBytes } = await atlasService.download(ctx, async (percent, stage) => {
          // 20% 粒度进度提醒（对应上游行为）
          if (percent - lastPercent >= 20 || percent >= 100) {
            lastPercent = percent
            await session?.send?.(`图鉴下载进度 ${percent}%：${stage}`)
          }
        })
        const sizeMb = (totalBytes / 1024 / 1024).toFixed(1)
        return `图鉴下载完成：共 ${imageCount} 张精灵图片，占用约 ${sizeMb} MB。\n使用：精灵图鉴 <精灵名>`
      } catch (e) {
        logger.warn(`图鉴下载失败: ${e}`)
        return `图鉴下载失败：${e instanceof Error ? e.message : e}`
      }
    })

  ctx.command('精灵图鉴 <name:text>', '使用本地 Rocom-Atlas 查询精灵图鉴图片')
    .alias('洛克精灵图鉴')
    .action(async ({ session }, name = '') => {
      const query = String(name || '').trim()
      if (!query) return '请输入精灵名称。用法：精灵图鉴 <精灵名>'
      if (!atlasService.isReady()) {
        return '本地图鉴尚未下载。请管理员先执行：图鉴下载'
      }
      const { name: matchedName, imagePath, candidates } = atlasService.findMatch(query)
      if (imagePath) {
        try {
          const image = fs.readFileSync(imagePath)
          await session?.send?.(h('message', {}, h.text(`【精灵图鉴】${matchedName}\n`), h.image(image, 'image/png')))
          return
        } catch (e) {
          logger.warn(`读取图鉴图片失败: ${e}`)
          return `读取图鉴图片失败：${e instanceof Error ? e.message : e}`
        }
      }
      if (candidates.length) {
        const lines = [`未精确匹配「${query}」，可能是：`]
        candidates.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`))
        lines.push('请使用更精确名称重新查询。')
        return lines.join('\n')
      }
      return `未在本地图鉴中找到「${query}」。可尝试其他名称，或联系管理员更新图鉴（图鉴下载）。`
    })
}
