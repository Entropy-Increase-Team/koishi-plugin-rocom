import { Context, Logger } from 'koishi'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { normalizeQueryText } from './wiki-service'

const logger = new Logger('rocom-atlas')

const ATLAS_ZIP_URLS = [
  'https://codeload.github.com/Entropy-Increase-Team/Rocom-Atlas/zip/refs/heads/main',
  'https://github.com/Entropy-Increase-Team/Rocom-Atlas/archive/refs/heads/main.zip',
]
const ATLAS_GIT_URL = 'https://github.com/Entropy-Increase-Team/Rocom-Atlas.git'

// ===== 最小 ZIP 解包（stored + deflate），避免引入额外依赖 =====

function extractZip(buffer: Buffer, destDir: string) {
  // 定位 End of Central Directory（自尾部反向搜索签名 0x06054b50）
  let eocd = -1
  const minEocd = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP 结构异常：找不到中央目录结尾')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 结构异常：中央目录签名错误')
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + extraLength + commentLength

    // 拒绝路径穿越
    const normalized = name.replace(/\\/g, '/')
    if (normalized.includes('..')) continue
    const target = path.join(destDir, ...normalized.split('/'))
    if (!path.resolve(target).startsWith(path.resolve(destDir))) continue

    if (normalized.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true })
      continue
    }

    // 读本地文件头拿数据真实偏移（本地头的 name/extra 长度可能与中央目录不同）
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('ZIP 结构异常：本地文件头签名错误')
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

    let content: Buffer
    if (compressionMethod === 0) content = Buffer.from(compressed)
    else if (compressionMethod === 8) content = zlib.inflateRawSync(compressed)
    else throw new Error(`ZIP 不支持的压缩方式: ${compressionMethod}`)

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}

function gitClone(dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --progress 让 git 在非 TTY 下也输出克隆进度（写到 stderr），逐行转发到日志。
    const child = spawn(
      'git',
      ['clone', '--depth', '1', '--single-branch', '--progress', ATLAS_GIT_URL, dst],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    )
    const stderrLines: string[] = []
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8')
      // git 进度行用 \r 刷新，按 \r 和 \n 一起切
      const lines = stderrTail.split(/[\r\n]+/)
      stderrTail = lines.pop() || ''
      for (const line of lines) {
        const text = line.trim()
        if (!text) continue
        stderrLines.push(text)
        logger.info(`git clone: ${text}`)
      }
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('git clone Rocom-Atlas 超时（180 秒）'))
    }, 180000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`git clone Rocom-Atlas 失败：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`git clone Rocom-Atlas 失败（exit ${code}）：${stderrLines.slice(-3).join(' | ')}`))
    })
  })
}

export type AtlasProgressCallback = (percent: number, stage: string) => void | Promise<void>

export class AtlasService {
  constructor(private dataDir: string) {}

  get atlasDir() {
    return path.join(this.dataDir, 'rocom_atlas')
  }

  private indexPath() {
    return path.join(this.atlasDir, 'path.json')
  }

  private petsDir() {
    return path.join(this.atlasDir, 'pets')
  }

  private aliasPath() {
    return path.join(this.atlasDir, 'othername', 'pets.yaml')
  }

  isReady(): boolean {
    return fs.existsSync(this.indexPath()) && fs.existsSync(this.petsDir())
  }

  loadIndex(): Record<string, string> {
    try {
      const payload = JSON.parse(fs.readFileSync(this.indexPath(), 'utf-8'))
      const pets = payload?.pets
      return pets && typeof pets === 'object' ? pets : {}
    } catch (e) {
      logger.warn(`读取本地图鉴索引失败: ${e}`)
      return {}
    }
  }

  private stripYamlValue(value: string): string {
    const text = String(value || '').trim()
    if (text.length >= 2 && text[0] === text[text.length - 1] && ["'", '"'].includes(text[0])) {
      return text.slice(1, -1).trim()
    }
    return text
  }

  // 解析上游简单结构的 pets.yaml：`正式名:` + 缩进 `- 别名` 列表。
  loadPetAliases(): Record<string, string[]> {
    const filePath = this.aliasPath()
    if (!fs.existsSync(filePath)) return {}
    const aliases: Record<string, string[]> = {}
    let currentName = ''
    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
      for (const line of lines) {
        const stripped = line.trim()
        if (!stripped || stripped.startsWith('#')) continue
        if (!/^\s/.test(line) && stripped.endsWith(':')) {
          currentName = this.stripYamlValue(stripped.slice(0, -1))
          if (currentName) {
            const key = normalizeQueryText(currentName)
            aliases[key] = aliases[key] || []
            if (!aliases[key].includes(currentName)) aliases[key].push(currentName)
          }
          continue
        }
        if (currentName && stripped.startsWith('-')) {
          const alias = this.stripYamlValue(stripped.slice(1))
          if (!alias) continue
          const key = normalizeQueryText(alias)
          aliases[key] = aliases[key] || []
          if (!aliases[key].includes(currentName)) aliases[key].push(currentName)
        }
      }
    } catch (e) {
      logger.warn(`读取本地图鉴别名失败: ${e}`)
      return {}
    }
    return aliases
  }

  private localImagePath(atlasRelPath: string): string {
    const rel = String(atlasRelPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel) return ''
    const candidate = path.resolve(this.atlasDir, ...rel.split('/'))
    const root = path.resolve(this.atlasDir)
    if (!candidate.startsWith(root)) return ''
    return candidate
  }

  private existingImagePath(index: Record<string, string>, name: string): string {
    const filePath = this.localImagePath(index[name] || '')
    return filePath && fs.existsSync(filePath) ? filePath : ''
  }

  findMatch(query: string): { name: string, imagePath: string, candidates: string[] } {
    const trimmed = String(query || '').trim()
    if (!trimmed) return { name: '', imagePath: '', candidates: [] }
    if (/^\d+$/.test(trimmed)) {
      const filePath = path.join(this.petsDir(), `${trimmed}.png`)
      if (fs.existsSync(filePath)) return { name: `#${trimmed}`, imagePath: filePath, candidates: [] }
    }

    const index = this.loadIndex()
    if (!Object.keys(index).length) return { name: '', imagePath: '', candidates: [] }

    const normalizedQuery = normalizeQueryText(trimmed)
    let exactKey = ''
    for (const name of Object.keys(index)) {
      if (normalizeQueryText(name) === normalizedQuery) {
        exactKey = name
        break
      }
    }
    if (exactKey) {
      const filePath = this.existingImagePath(index, exactKey)
      if (filePath) return { name: exactKey, imagePath: filePath, candidates: [] }
    }

    const aliasMap = this.loadPetAliases()
    const exactAliasCandidates = (aliasMap[normalizedQuery] || []).filter(name => this.existingImagePath(index, name))
    if (exactAliasCandidates.length) {
      const only = exactAliasCandidates[0]
      return { name: only, imagePath: this.existingImagePath(index, only), candidates: [] }
    }

    const candidates: string[] = []
    const addCandidate = (name: string) => {
      if (!candidates.includes(name) && this.existingImagePath(index, name)) candidates.push(name)
    }
    for (const name of Object.keys(index)) {
      const normalizedName = normalizeQueryText(name)
      if (normalizedQuery && (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName))) {
        addCandidate(name)
      }
    }
    for (const [alias, names] of Object.entries(aliasMap)) {
      if (normalizedQuery && (alias.includes(normalizedQuery) || normalizedQuery.includes(alias))) {
        for (const name of names) addCandidate(name)
      }
    }
    if (candidates.length === 1) {
      const only = candidates[0]
      return { name: only, imagePath: this.existingImagePath(index, only), candidates: [] }
    }
    return { name: '', imagePath: '', candidates: candidates.slice(0, 10) }
  }

  private prepareAtlasDir(sourceRoot: string, preparedDir: string): { imageCount: number, totalBytes: number } {
    fs.mkdirSync(preparedDir, { recursive: true })
    for (const name of ['path.json', 'index', 'othername', 'pets']) {
      const src = path.join(sourceRoot, name)
      const dst = path.join(preparedDir, name)
      if (fs.existsSync(src)) {
        fs.cpSync(src, dst, { recursive: true })
      }
    }
    if (!fs.existsSync(path.join(preparedDir, 'path.json'))) throw new Error('Atlas 缺少 path.json')
    if (!fs.existsSync(path.join(preparedDir, 'othername', 'pets.yaml'))) throw new Error('Atlas 缺少 othername/pets.yaml')
    const petsDir = path.join(preparedDir, 'pets')
    if (!fs.existsSync(petsDir)) throw new Error('Atlas 缺少 pets 图片目录')
    const imageCount = fs.readdirSync(petsDir).filter(name => name.toLowerCase().endsWith('.png')).length
    let totalBytes = 0
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(entryPath)
        else totalBytes += fs.statSync(entryPath).size
      }
    }
    walk(preparedDir)
    return { imageCount, totalBytes }
  }

  private replaceAtlasDir(preparedDir: string) {
    const target = path.resolve(this.atlasDir)
    const dataRoot = path.resolve(this.dataDir)
    if (!target.startsWith(dataRoot)) throw new Error('图鉴目标目录不在插件数据目录内')
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.renameSync(preparedDir, target)
    } catch (e: any) {
      // Windows 跨盘符（如 C: 临时目录 → D: 数据目录）rename 会抛 EXDEV/EPERM，回退为复制。
      if (['EXDEV', 'EPERM'].includes(e?.code)) {
        logger.info(`rename 失败（${e.code}），回退为复制方式迁移图鉴目录`)
        fs.cpSync(preparedDir, target, { recursive: true })
      } else {
        throw e
      }
    }
  }

  // 流式下载压缩包：每 2 秒输出一次已下载字节数/速度，避免大文件下载期间毫无动静。
  private async downloadZipWithProgress(ctx: Context, url: string): Promise<Buffer> {
    const started = Date.now()
    const res = await ctx.http(url, { responseType: 'stream', timeout: 180000 })
    const totalHeader = Number(res.headers?.get?.('content-length'))
    const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0
    const totalText = totalBytes ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB` : '未知大小'
    logger.info(`开始下载图鉴压缩包：${url}（${totalText}）`)

    const chunks: Buffer[] = []
    let received = 0
    let lastLogAt = Date.now()
    const reader = (res.data as ReadableStream<Uint8Array>).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(Buffer.from(value))
        received += value.byteLength
      }
      const now = Date.now()
      if (now - lastLogAt >= 2000) {
        lastLogAt = now
        const mb = (received / 1024 / 1024).toFixed(1)
        const speed = (received / 1024 / (now - started) * 1000 / 1024).toFixed(2)
        const percentText = totalBytes ? `${Math.min(99, Math.round(received / totalBytes * 100))}%，` : ''
        logger.info(`图鉴压缩包下载中：${percentText}已收到 ${mb} MB，平均 ${speed} MB/s`)
      }
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    logger.info(`图鉴压缩包下载完成：共 ${(received / 1024 / 1024).toFixed(1)} MB，耗时 ${elapsed} 秒`)
    return Buffer.concat(chunks)
  }

  async download(ctx: Context, progressCb?: AtlasProgressCallback): Promise<{ imageCount: number, totalBytes: number }> {
    const emit = async (percent: number, stage: string) => {
      if (progressCb) await progressCb(Math.max(0, Math.min(100, Math.round(percent))), stage)
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocom_atlas_'))
    const extractDir = path.join(tmpRoot, 'extract')
    let preparedDir = path.join(tmpRoot, 'rocom_atlas')
    const cloneDir = path.join(tmpRoot, 'clone')
    try {
      let zipBuffer: Buffer | null = null
      const zipErrors: string[] = []
      for (const url of ATLAS_ZIP_URLS) {
        try {
          await emit(10, '正在下载图鉴压缩包')
          zipBuffer = await this.downloadZipWithProgress(ctx, url)
          await emit(80, '图鉴压缩包下载完成')
          break
        } catch (e) {
          logger.warn(`图鉴压缩包下载失败：${url}: ${e}`)
          zipErrors.push(`${url}: ${e}`)
          zipBuffer = null
        }
      }

      let stats: { imageCount: number, totalBytes: number }
      if (zipBuffer) {
        await emit(80, '正在解压图鉴文件')
        logger.info('正在解压图鉴压缩包…')
        fs.mkdirSync(extractDir, { recursive: true })
        extractZip(zipBuffer, extractDir)
        logger.info('图鉴压缩包解压完成')
        const roots = fs.readdirSync(extractDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => path.join(extractDir, entry.name))
        if (!roots.length) throw new Error('Atlas 压缩包结构异常')
        stats = this.prepareAtlasDir(roots[0], preparedDir)
      } else {
        logger.warn(`GitHub zip 下载失败，尝试 git clone：${zipErrors.join(' | ')}`)
        await emit(20, '正在 git clone 图鉴仓库')
        await gitClone(cloneDir)
        await emit(80, '正在整理图鉴文件')
        stats = this.prepareAtlasDir(cloneDir, preparedDir)
      }
      this.replaceAtlasDir(preparedDir)
      preparedDir = ''
      logger.info(`本地图鉴缓存已更新：${stats.imageCount} 张图片，${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB`)
      await emit(100, '本地图鉴缓存已更新')
      return stats
    } finally {
      cleanupTempDir(tmpRoot)
    }
  }
}

// Windows 下 git clone 产生的 .git pack 文件是只读的，直接 rmSync 会抛 EPERM；
// 先带重试删，失败则清掉只读属性再删。清理失败只告警，不影响下载结果。
function cleanupTempDir(tmpRoot: string) {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    try {
      const clearReadonly = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name)
          try {
            fs.chmodSync(entryPath, 0o666)
          } catch {
            // ignore
          }
          if (entry.isDirectory()) clearReadonly(entryPath)
        }
      }
      clearReadonly(tmpRoot)
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch (e) {
      logger.warn(`清理图鉴临时目录失败（不影响下载结果）：${tmpRoot}: ${e}`)
    }
  }
}
