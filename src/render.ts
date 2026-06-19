import { Context, Logger } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import * as template from 'art-template'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const logger = new Logger('rocom-render')

type CapturePadding = {
  left: number
  right: number
  top: number
  bottom: number
}

type TemplateViewport = {
  width: number
  height: number
  deviceScaleFactor: number
}

const TEMPLATE_CAPTURE_PADDING: Record<string, CapturePadding> = {
  package: { left: 0, right: 0, top: 0, bottom: 0 },
}

const TEMPLATE_VIEWPORTS: Record<string, TemplateViewport> = {
  activities: { width: 1600, height: 1200, deviceScaleFactor: 2 },
}

const VISUAL_BOUNDS_TEMPLATES = new Set([
  'yuanxing-shangren/merchant',
  'yuanxing-shangren/today',
])

const DEFAULT_SCREENSHOT_OPTIONS = {
  type: 'jpeg' as const,
  quality: 82,
}

function toDirectoryFileUrl(dirPath: string): string {
  const href = pathToFileURL(dirPath).href
  return href.endsWith('/') ? href : `${href}/`
}

function normalizeTemplateResourcePaths(content: string): string {
  return content.replace(/\{\{(_res_path|pluResPath)\}\}render\//g, '{{$1}}render-templates/')
}

export class Renderer {
  constructor(private resPath: string) {}

  resourceUrl(relativePath: string) {
    return pathToFileURL(path.join(this.getPreferredResourceRoot(), relativePath)).href
  }

  private getPreferredResourceRoot() {
    const builtRoot = path.join(this.resPath, 'lib')
    if (fs.existsSync(path.join(builtRoot, 'render-templates'))) return builtRoot
    return path.join(this.resPath, 'src')
  }

  private getTemplateCandidateRoots() {
    const roots = [
      path.join(this.resPath, 'lib'),
      path.join(this.resPath, 'src'),
    ]
    return Array.from(new Set(roots))
  }

  private resolveTemplatePath(templateName: string) {
    for (const root of this.getTemplateCandidateRoots()) {
      const templateRoot = path.join(root, 'render-templates')
      const directHtmlPath = path.join(templateRoot, `${templateName}.html`)
      if (fs.existsSync(directHtmlPath)) {
        return { templatePath: directHtmlPath, resourceRoot: root }
      }
      const indexHtmlPath = path.join(templateRoot, templateName, 'index.html')
      if (fs.existsSync(indexHtmlPath)) {
        return { templatePath: indexHtmlPath, resourceRoot: root }
      }
    }
    return null
  }

  private getStylePath(templateName: string) {
    const resolved = this.resolveTemplatePath(templateName)
    if (!resolved) return ''
    return path.join(resolved.resourceRoot, 'render-templates', templateName, 'style.css')
  }

  async renderHtml(ctx: Context, templateName: string, data: any): Promise<Buffer | null> {
    try {
      const resolvedTemplate = this.resolveTemplatePath(templateName)
      if (!resolvedTemplate) {
        const checked = this.getTemplateCandidateRoots().map(root => path.join(root, 'render-templates', templateName))
        logger.error(`template file missing: ${checked.join(' | ')}`)
        return null
      }

      const { templatePath, resourceRoot } = resolvedTemplate
      const templateContent = fs.readFileSync(templatePath, 'utf-8')
      const normalizedTemplateContent = normalizeTemplateResourcePaths(templateContent)
      const resPathUrl = toDirectoryFileUrl(resourceRoot)
      const renderData = { ...data, _res_path: resPathUrl, pluResPath: resPathUrl }
      const html = template.render(normalizedTemplateContent, renderData)

      if (!ctx.puppeteer?.page) {
        logger.error('puppeteer service is unavailable')
        return null
      }

      const page = await ctx.puppeteer.page()
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-render-'))
      const tempHtmlPath = path.join(tempDir, `${templateName.replace(/[\\/]/g, '_')}.html`)

      try {
        await page.setCacheEnabled(false)
        fs.writeFileSync(tempHtmlPath, html, 'utf-8')

        const initialViewport = TEMPLATE_VIEWPORTS[templateName] || { width: 1280, height: 768, deviceScaleFactor: 2 }
        await page.setViewport(initialViewport)
        try {
          await page.goto(pathToFileURL(tempHtmlPath).href, {
            waitUntil: 'networkidle0',
            timeout: 15000,
          })
        } catch (err) {
          logger.warn(`page.goto failed for ${templateName}: ${err}`)
        }

        try {
          await page.evaluate(async () => {
            const images = Array.from(document.images)
            await Promise.all(images.map((img) => {
              if (img.complete) return Promise.resolve()
              return new Promise<void>((resolve) => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
              })
            }))

            const fonts = (document as any).fonts
            if (fonts?.ready) {
              await fonts.ready
            }
          })
        } catch (err) {
          logger.warn(`asset wait failed for ${templateName}: ${err}`)
        }

        await new Promise(resolve => setTimeout(resolve, 300))

        const selectors = [
          '.exchange-page',
          '.record-page',
          '.package-cont',
          '.searcheggs-cont',
          '.bwiki-shell',
          '.skill-shell',
          '.lineup-page',
          '.lineup-detail-page',
          '.page-section-main',
          '.stats-cont',
          '.inspect-page',
          '.player-search-page',
          '.ingame-shop-page',
          '.friendship-page',
          '.student-state-page',
          '.student-perks-page',
          '.student-page',
          '.merchant-page',
          '.page',
          '.home-page',
          '.pet-panel-page',
          '.pet-detail-page',
          '.activity-calendar-page',
        ]

        let target: any = null
        for (const selector of selectors) {
          target = await page.$(selector)
          if (target) break
        }
        if (!target) {
          target = await page.$('body')
        }

        if (target) {
          const box = await target.boundingBox()
          if (box && box.width > 0 && box.height > 0) {
            const useVisualBounds = VISUAL_BOUNDS_TEMPLATES.has(templateName)
            const elementMetrics = await page.evaluate((el: Element, visualBounds: boolean) => {
              const rect = el.getBoundingClientRect()
              const element = el as HTMLElement
              return {
                x: rect.left + window.scrollX,
                y: rect.top + window.scrollY,
                width: visualBounds ? rect.width : Math.max(rect.width, element.scrollWidth, element.offsetWidth),
                height: visualBounds ? rect.height : Math.max(rect.height, element.scrollHeight, element.offsetHeight),
              }
            }, target, useVisualBounds)

            const capturePadding = TEMPLATE_CAPTURE_PADDING[templateName] || { left: 0, right: 0, top: 0, bottom: 0 }
            await page.setViewport({
              width: Math.max(Math.ceil(elementMetrics.x + elementMetrics.width + capturePadding.right) + 8, 200),
              height: Math.max(Math.ceil(elementMetrics.y + elementMetrics.height + capturePadding.bottom) + 8, 200),
              deviceScaleFactor: initialViewport.deviceScaleFactor,
            })
            await new Promise(resolve => setTimeout(resolve, 100))

            const hasOverflow =
              elementMetrics.width > box.width + 0.5 ||
              elementMetrics.height > box.height + 0.5

            if (capturePadding.left || capturePadding.right || capturePadding.top || capturePadding.bottom || hasOverflow) {
              const clipX = Math.max(0, elementMetrics.x - capturePadding.left)
              const clipY = Math.max(0, elementMetrics.y - capturePadding.top)
              const clipWidth = elementMetrics.width + capturePadding.left + capturePadding.right
              const clipHeight = elementMetrics.height + capturePadding.top + capturePadding.bottom
              const screenshot = await page.screenshot({
                ...DEFAULT_SCREENSHOT_OPTIONS,
                clip: {
                  x: clipX,
                  y: clipY,
                  width: clipWidth,
                  height: clipHeight,
                },
              })
              return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot)
            }
          }
          const screenshot = await target.screenshot(DEFAULT_SCREENSHOT_OPTIONS)
          return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot)
        }

        const screenshot = await page.screenshot({ ...DEFAULT_SCREENSHOT_OPTIONS, fullPage: true })
        return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot)
      } finally {
        try {
          await page.close()
        } catch {
          // ignore
        }
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (e) {
      logger.error(`render failed: ${e}`)
      return null
    }
  }
}
