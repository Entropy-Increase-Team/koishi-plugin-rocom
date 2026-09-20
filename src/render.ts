import { Context, Logger } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import * as template from 'art-template'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { delay, withDeadline } from './async-control'

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
  'home',
  'yuanxing-shangren/merchant',
  'yuanxing-shangren/today',
])

const DEFAULT_SCREENSHOT_OPTIONS = {
  type: 'jpeg' as const,
  quality: 82,
}

export interface RenderOptions {
  signal?: AbortSignal
  timeoutMs?: number
  imageWaitMs?: number
  fontWaitMs?: number
  deviceScaleFactor?: number
  jpegQuality?: number
  maxPageHeight?: number
}

// 家园详情低带宽建议初值，需用真实截图校准。
export const lowBandwidthRenderOptions: RenderOptions = {
  timeoutMs: 30000,
  imageWaitMs: 3000,
  fontWaitMs: 1500,
  deviceScaleFactor: 1,
  jpegQuality: 65,
  maxPageHeight: 12000,
}

function toDirectoryFileUrl(dirPath: string): string {
  const href = pathToFileURL(dirPath).href
  return href.endsWith('/') ? href : `${href}/`
}

function normalizeTemplateResourcePaths(content: string): string {
  return content.replace(/\{\{(_res_path|pluResPath)\}\}render\//g, '{{$1}}render-templates/')
}

export class Renderer {
  constructor(private resPath: string, private defaults: RenderOptions = {}) {}

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

  async renderHtml(ctx: Context, templateName: string, data: any, options: RenderOptions = {}): Promise<Buffer | null> {
    const pages = await this.renderPages(ctx, templateName, data, { ...options, maxPageHeight: 0 })
    return pages?.[0] ?? null
  }

  async renderPages(ctx: Context, templateName: string, data: any, options: RenderOptions = {}): Promise<Buffer[] | null> {
    options = { maxPageHeight: 6000, ...this.defaults, ...options }
    let page: any
    let tempDir = ''
    let stopped = false
    let closing: Promise<unknown> | undefined
    const close = () => {
      if (page && !closing) closing = Promise.resolve().then(() => page.close()).catch(() => {})
      return closing
    }
    try {
      return await withDeadline(options.timeoutMs || 30000, options.signal, async signal => {
        const acquire = async () => {
          page = await ctx.puppeteer.page()
          if (stopped || signal.aborted) { await close(); signal.throwIfAborted() }
          return page
        }
        return this.capture(ctx, templateName, data, { ...options, signal }, acquire, dir => { tempDir = dir })
      }, () => { stopped = true; void close() })
    } catch (error) {
      logger.warn('render interrupted for ' + templateName + ': ' + error)
      return null
    } finally {
      stopped = true
      // A stalled browser must not block the request's deadline indefinitely.
      void close()
      if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {} }
    }
  }

  private async capture(ctx: Context, templateName: string, data: any, options: RenderOptions,
    acquire: () => Promise<any>, rememberDirectory: (dir: string) => void): Promise<Buffer[] | null> {
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 30000
    const deadline = Date.now() + timeoutMs
    const imageWaitMs = options.imageWaitMs && options.imageWaitMs > 0 ? options.imageWaitMs : 10000
    const fontWaitMs = options.fontWaitMs && options.fontWaitMs > 0 ? options.fontWaitMs : 3000
    const jpegQuality = options.jpegQuality && options.jpegQuality > 0 ? options.jpegQuality : DEFAULT_SCREENSHOT_OPTIONS.quality
    const screenshotOptions = { type: 'jpeg' as const, quality: jpegQuality }
    const remainingMs = () => { options.signal?.throwIfAborted(); return Math.max(1, deadline - Date.now()) }

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

      // Puppeteer 服务由 Koishi 共享，只能关闭本次 page，不能关闭共享 browser。
      const page = await acquire()
      let tempDir = ''
      try {
        options.signal?.throwIfAborted()
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom-render-'))
        rememberDirectory(tempDir)
        const tempHtmlPath = path.join(tempDir, `${templateName.replace(/[\\/]/g, '_')}.html`)

        await page.setCacheEnabled(false)
        fs.writeFileSync(tempHtmlPath, html, 'utf-8')

        const templateViewport = TEMPLATE_VIEWPORTS[templateName] || { width: 1280, height: 768, deviceScaleFactor: 2 }
        const initialViewport = {
          ...templateViewport,
          deviceScaleFactor: options.deviceScaleFactor ?? templateViewport.deviceScaleFactor,
        }
        await page.setViewport(initialViewport)
        try {
          await page.goto(pathToFileURL(tempHtmlPath).href, {
            waitUntil: 'networkidle0',
            timeout: Math.min(15000, remainingMs()),
          })
        } catch (err) {
          logger.warn(`page.goto failed for ${templateName}: ${err}`)
        }

        try {
          await page.evaluate(async (waitImageMs: number, waitFontMs: number) => {
            const images = Array.from(document.images)
            // 限制远程图片等待时间，避免慢速资源拖垮整次渲染（对应上游 v3.7.1）。
            await Promise.race([
              Promise.all(images.map((img) => {
                if (img.complete) return Promise.resolve()
                return new Promise<void>((resolve) => {
                  img.onload = () => resolve()
                  img.onerror = () => resolve()
                })
              })),
              new Promise<void>(resolve => setTimeout(resolve, waitImageMs)),
            ])

            const fonts = (document as any).fonts
            if (fonts?.ready) {
              // 字体等待单独设上限，避免字体服务异常时无限等待。
              await Promise.race([
                fonts.ready,
                new Promise<void>(resolve => setTimeout(resolve, waitFontMs)),
              ])
            }
          }, Math.min(imageWaitMs, remainingMs()), Math.min(fontWaitMs, remainingMs()))
        } catch (err) {
          logger.warn(`asset wait failed for ${templateName}: ${err}`)
        }

        await delay(300, options.signal)

        const selectors = [
          '.exchange-page',
          '.record-page',
          '.package-cont',
          '.searcheggs-cont',
          '.bwiki-shell',
          '.skill-shell',
          '.wiki-page',
          '.pet-data-page',
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
          '.pet-ranking-page',
          '.share-code-page',
          '.announcement-list-page',
          '.announcement-detail-page',
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
              height: Math.min(6000, Math.max(Math.ceil(elementMetrics.y + elementMetrics.height + capturePadding.bottom) + 8, 200)),
              deviceScaleFactor: initialViewport.deviceScaleFactor,
            })
            await delay(100, options.signal)

            // 居中（margin auto）模板在视口调整后 x/y 会变化，截图前需要重新测量，
            // 否则 clip 会带着旧偏移导致画面左侧被截断（对应上游 v3.7.5 修复）。
            try {
              const remeasured = await page.evaluate((el: Element, visualBounds: boolean) => {
                const rect = el.getBoundingClientRect()
                const element = el as HTMLElement
                return {
                  x: rect.left + window.scrollX,
                  y: rect.top + window.scrollY,
                  width: visualBounds ? rect.width : Math.max(rect.width, element.scrollWidth, element.offsetWidth),
                  height: visualBounds ? rect.height : Math.max(rect.height, element.scrollHeight, element.offsetHeight),
                }
              }, target, useVisualBounds)
              if (remeasured && remeasured.width > 0 && remeasured.height > 0) {
                elementMetrics.x = remeasured.x
                elementMetrics.y = remeasured.y
                elementMetrics.width = remeasured.width
                elementMetrics.height = remeasured.height
              }
            } catch (err) {
              logger.warn(`element remeasure failed for ${templateName}: ${err}`)
            }

            const clipX = Math.max(0, elementMetrics.x - capturePadding.left)
            const clipY = Math.max(0, elementMetrics.y - capturePadding.top)
            const width = elementMetrics.width + capturePadding.left + capturePadding.right
            const height = elementMetrics.height + capturePadding.top + capturePadding.bottom
            const maxHeight = Math.max(1, options.maxPageHeight || height)
            // Evenly distribute the last few pixels instead of emitting a tiny blank final page.
            const step = Math.ceil(height / Math.ceil(height / maxHeight))
            const pages: Buffer[] = []
            for (let offset = 0; offset < height; offset += step) {
              options.signal?.throwIfAborted()
              const screenshot = await page.screenshot({ ...screenshotOptions, captureBeyondViewport: true,
                clip: { x: clipX, y: clipY + offset, width, height: Math.min(step, height - offset) } })
              pages.push(Buffer.from(screenshot))
            }
            return pages
          }
          const screenshot = await target.screenshot(screenshotOptions)
          return [Buffer.from(screenshot)]
        }

        const screenshot = await page.screenshot({ ...screenshotOptions, fullPage: true })
        return [Buffer.from(screenshot)]
      } finally {
        try {
          await page.close()
        } catch {
          // ignore
        }
        if (tempDir) {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true })
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      logger.error(`render failed: ${e}`)
      return null
    }
  }
}
