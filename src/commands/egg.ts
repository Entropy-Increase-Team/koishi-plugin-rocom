import { PluginDeps } from '../types'
import { SearchResult } from '../egg-service'
import { sendImageWithFallback } from '../send-image'

type ParsedHeight = {
  dataValue: number
  meterValue: number
  display: string
}

function petName(p: any): string {
  return p?.localized?.zh?.name || p?.name || '未知精灵'
}

function parseHeightValue(raw: unknown): ParsedHeight | null {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(身高|高度|h)\s*/i, '')
    .trim()
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(?:\s*(m|米))?$/)
  if (!match) return null
  const meterValue = Number(match[1])
  if (!Number.isFinite(meterValue)) return null
  return {
    dataValue: meterValue * 100,
    meterValue,
    display: `${formatNumber(meterValue)} m`,
  }
}

function parseWeightValue(raw: unknown): number | null {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(体重|重量|w)\s*/i, '')
    .trim()
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(?:\s*(kg|千克|公斤))?$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function searchResultCandidates(result: SearchResult): any[] {
  return result.candidates || []
}

async function sendEggImage(
  deps: PluginDeps,
  session: any,
  templateName: string,
  data: any,
  fallback: string,
) {
  const png = await deps.renderer.renderHtml(deps.ctx, templateName, data)
  await sendImageWithFallback(session, png, fallback, `egg:${templateName}`, deps.config)
}

export function register(deps: PluginDeps) {
  const { ctx, client, eggService } = deps

  ctx.command('洛克').subcommand('.查蛋 [arg1:string] [arg2:string]', '查询精灵蛋组')
    .alias('洛克查蛋')
    .action(async ({ session }, arg1, arg2) => {
      if (!arg1) {
        return [
          '查蛋用法：',
          '  洛克.查蛋 <精灵名>',
          '  洛克.查蛋 0.18 1.5',
          '  洛克.查蛋 0.18m 1.5kg',
          '  洛克.查蛋 身高0.18m 体重1.5kg',
        ].join('\n')
      }

      let height: number | undefined
      let heightMeters: number | undefined
      let heightDisplay: string | undefined
      let weight: number | undefined
      const nameParts: string[] = []
      const numericArgs: Array<{ height: ParsedHeight | null; weight: number | null }> = []

      for (const rawArg of [arg1, arg2]) {
        if (!rawArg) continue
        const arg = String(rawArg).trim()
        const explicitHeight = /^(身高|高度|h)/i.test(arg)
        const explicitWeight = /^(体重|重量|w)/i.test(arg)

        if (explicitHeight) {
          const parsed = parseHeightValue(arg)
          if (parsed) {
            height = parsed.dataValue
            heightMeters = parsed.meterValue
            heightDisplay = parsed.display
            continue
          }
        }

        if (explicitWeight) {
          const parsed = parseWeightValue(arg)
          if (parsed != null) {
            weight = parsed
            continue
          }
        }

        const heightCandidate = parseHeightValue(arg)
        const weightCandidate = parseWeightValue(arg)
        if (heightCandidate || weightCandidate != null) {
          numericArgs.push({ height: heightCandidate, weight: weightCandidate })
        } else {
          nameParts.push(arg)
        }
      }

      if (numericArgs.length) {
        if (height == null && numericArgs[0]?.height) {
          height = numericArgs[0].height.dataValue
          heightMeters = numericArgs[0].height.meterValue
          heightDisplay = numericArgs[0].height.display
        }
        if (weight == null && numericArgs[1]?.weight != null) {
          weight = numericArgs[1].weight
        }
      }

      if (height != null || weight != null) {
        let data: any | null = null
        let fallback = ''

        if (height != null && weight != null) {
          const backendResults = await client.queryPetSize(ctx, heightMeters ?? height / 100, weight)
          if (backendResults) {
            data = eggService.buildSizeSearchDataFromApi(height, weight, backendResults, heightDisplay)
            fallback = eggService.buildSizeSearchTextFromApi(height, weight, backendResults, heightDisplay)
          }
        }

        if (!data) {
          const results = eggService.searchBySize(height, weight)
          data = eggService.buildSizeSearchData(height, weight, results, heightDisplay)
          fallback = eggService.buildSizeSearchText(height, weight, results, heightDisplay)
        }

        await sendEggImage(deps, session, 'searcheggs/size', data, fallback)
        return
      }

      const name = nameParts.join(' ')
      if (!name) return '请输入精灵名称。用法：洛克.查蛋 <精灵名>'

      const sr = eggService.search(name)
      if (sr.matchType === 'multi') {
        const candidates = searchResultCandidates(sr)
        const data = eggService.buildCandidatesRenderData(name, candidates)
        await sendEggImage(deps, session, 'searcheggs/candidates', data, eggService.buildCandidatesText(name, candidates))
        return
      }
      if (sr.matchType === 'not_found') return `未找到名为「${name}」的精灵，请检查名称后重试。`

      const pet = sr.pet
      const data = eggService.buildSearchData(pet)
      data.commandHint = '洛克.查蛋 <名称> | 洛克.查蛋 身高0.18m 体重1.5kg | 洛克.配种 <父体> <母体>'
      data.copyright = 'Koishi & WeGame 洛克王国插件'
      const hint = sr.matchType === 'fuzzy' ? `模糊匹配到「${petName(pet)}」\n` : ''
      await sendEggImage(deps, session, 'searcheggs', data, hint + eggService.buildSearchText(pet))
    })

  ctx.command('洛克').subcommand('.配种 <nameA:string> [nameB:string]', '配种查询')
    .alias('洛克配种')
    .action(async ({ session }, nameA, nameB) => {
      if (!nameA) {
        return [
          '配种用法：',
          '  洛克.配种 <精灵名>',
          '    查询想孵出这个精灵时可选哪些父体。',
          '  洛克.配种 <父体> <母体>',
          '    判断两只精灵是否可以配种，默认前父后母，孵蛋结果跟随母体。',
          '示例：',
          '  洛克.配种 喵喵',
          '  洛克.配种 父体名称 母体名称',
        ].join('\n')
      }

      if (!nameB) {
        const sr = eggService.search(nameA)
        if (sr.matchType === 'multi') {
          const candidates = searchResultCandidates(sr)
          const data = eggService.buildCandidatesRenderData(nameA, candidates)
          await sendEggImage(deps, session, 'searcheggs/candidates', data, eggService.buildCandidatesText(nameA, candidates))
          return
        }
        if (sr.matchType === 'not_found') return `未找到名为「${nameA}」的精灵。`

        const data = eggService.buildWantPetData(sr.pet)
        await sendEggImage(deps, session, 'searcheggs/want', data, eggService.buildWantPetText(sr.pet))
        return
      }

      const srA = eggService.search(nameA)
      if (srA.matchType === 'multi') {
        const candidates = searchResultCandidates(srA)
        const data = eggService.buildCandidatesRenderData(nameA, candidates)
        await sendEggImage(deps, session, 'searcheggs/candidates', data, eggService.buildCandidatesText(nameA, candidates))
        return
      }
      if (srA.matchType === 'not_found') return `未找到名为「${nameA}」的精灵。`

      const srB = eggService.search(nameB)
      if (srB.matchType === 'multi') {
        const candidates = searchResultCandidates(srB)
        const data = eggService.buildCandidatesRenderData(nameB, candidates)
        await sendEggImage(deps, session, 'searcheggs/candidates', data, eggService.buildCandidatesText(nameB, candidates))
        return
      }
      if (srB.matchType === 'not_found') return `未找到名为「${nameB}」的精灵。`

      const data = eggService.buildPairData(srB.pet, srA.pet)
      data.commandHint = '默认前父后母，孵蛋结果跟随母体 | 洛克.配种 <精灵名> 查询怎么孵'
      data.copyright = 'Koishi & WeGame 洛克王国插件'
      await sendEggImage(deps, session, 'searcheggs/pair', data, eggService.buildPairText(srB.pet, srA.pet))
    })
}
