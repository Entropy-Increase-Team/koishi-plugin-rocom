// 图片尺寸与「不透明内容框」测量，用于商品图标等面积归一。
// 商品图标画布大小、四周留白、内容长宽比都不一致，object-fit: contain 按整张画布贴边，
// 会导致同一张卡片里圆球占满、细长商品偏小。这里量出不透明内容包围盒供缩放换算。
// PNG 只精确支持 8bit 非隔行且带独立 alpha 的变体；WebP 只读画布尺寸；其余返回 null 按原样渲染。

import zlib from 'node:zlib'

export interface ImageContentBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageMetrics {
  width: number
  height: number
  content: ImageContentBox
}

export interface IconFit {
  scale: number
  offsetX: number
  offsetY: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG 颜色类型 → 每像素通道数 */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
/** 带独立 alpha 通道的颜色类型 → alpha 在像素里的下标 */
const PNG_ALPHA_INDEX: Record<number, number> = { 4: 1, 6: 3 }

function paeth (a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** 按 PNG 的 5 种行过滤器还原一行原始像素 */
function unfilterScanline (src: Buffer, dest: Buffer, prev: Buffer, filter: number, bpp: number): boolean {
  const length = src.length

  if (filter === 0) {
    src.copy(dest, 0, 0, length)
    return true
  }

  if (filter === 1) {
    for (let i = 0; i < length; i += 1) {
      dest[i] = (src[i] + (i >= bpp ? dest[i - bpp] : 0)) & 0xff
    }
    return true
  }

  if (filter === 2) {
    for (let i = 0; i < length; i += 1) {
      dest[i] = (src[i] + prev[i]) & 0xff
    }
    return true
  }

  if (filter === 3) {
    for (let i = 0; i < length; i += 1) {
      const left = i >= bpp ? dest[i - bpp] : 0
      dest[i] = (src[i] + ((left + prev[i]) >> 1)) & 0xff
    }
    return true
  }

  if (filter === 4) {
    for (let i = 0; i < length; i += 1) {
      const left = i >= bpp ? dest[i - bpp] : 0
      const up = prev[i]
      const upLeft = i >= bpp ? prev[i - bpp] : 0
      dest[i] = (src[i] + paeth(left, up, upLeft)) & 0xff
    }
    return true
  }

  return false
}

interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

function readPngHeader (buffer: Buffer): PngHeader | null {
  if (buffer.length < 33) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width <= 0 || height <= 0) return null

  return {
    width,
    height,
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  }
}

/** 量 PNG 的不透明内容框；只处理 8bit 非隔行带独立 alpha 的图，其余返回 null（整张都算内容）。 */
function readPngContentBox (buffer: Buffer, header: PngHeader): ImageContentBox | null {
  const alphaIndex = PNG_ALPHA_INDEX[header.colorType]
  if (alphaIndex === undefined) return null
  if (header.bitDepth !== 8 || header.interlace !== 0) return null

  const channels = PNG_CHANNELS[header.colorType]
  const stride = header.width * channels
  if (stride <= 0) return null

  const idatParts: Buffer[] = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    if (dataStart + length > buffer.length) break
    if (type === 'IDAT') idatParts.push(buffer.subarray(dataStart, dataStart + length))
    if (type === 'IEND') break
    offset = dataStart + length + 4
  }
  if (idatParts.length === 0) return null

  let raw: Buffer
  try {
    raw = zlib.inflateSync(Buffer.concat(idatParts))
  } catch {
    return null
  }

  let current = Buffer.alloc(stride)
  let previous = Buffer.alloc(stride)
  let cursor = 0
  let minX = header.width
  let minY = header.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < header.height; y += 1) {
    if (cursor + 1 + stride > raw.length) return null
    const filter = raw[cursor]
    cursor += 1
    const line = raw.subarray(cursor, cursor + stride)
    cursor += stride

    if (!unfilterScanline(line, current, previous, filter, channels)) return null

    for (let x = 0; x < header.width; x += 1) {
      if (current[(x * channels) + alphaIndex] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    const swap = previous
    previous = current
    current = swap
  }

  if (maxX < 0) return null

  return {
    x: minX,
    y: minY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  }
}

/** 读 WebP 画布尺寸（VP8X / VP8L / VP8） */
function readWebpSize (buffer: Buffer): { width: number, height: number } | null {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null

  const chunk = buffer.toString('ascii', 12, 16)

  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
    return { width, height }
  }

  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunk === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  return null
}

/** 读一张图的尺寸与内容框；无法识别时返回 null。 */
export function readImageMetrics (buffer: Buffer): ImageMetrics | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null

  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const header = readPngHeader(buffer)
    if (!header) return null
    return {
      width: header.width,
      height: header.height,
      content: readPngContentBox(buffer, header) || {
        x: 0,
        y: 0,
        width: header.width,
        height: header.height,
      },
    }
  }

  const webp = readWebpSize(buffer)
  if (webp) {
    return {
      width: webp.width,
      height: webp.height,
      content: { x: 0, y: 0, width: webp.width, height: webp.height },
    }
  }

  return null
}

function round4 (value: number): number {
  // +0 归一掉 -0，避免模板里出现 "scale(-0)" 之类的输出
  return Math.round(value * 10000) / 10000 + 0
}

export interface IconFitBox {
  width: number
  height: number
  targetArea: number
}

/**
 * 把「等面积归一」算成 CSS transform 参数。
 * `.goods-img` 本身 object-fit: contain 按整张画布贴边居中，这里再叠一层
 * 以框中心为原点的 translate(...) scale(...)：
 *   - scale 把不透明内容缩放到 targetArea 对应面积，上限是不溢出图标框；
 *   - translate 写在 scale 前，矩阵乘法上位移不会被 scale 再放大，
 *     用于把不在画布中心的内容挪回框中心。
 */
export function buildIconFit (metrics: ImageMetrics | null | undefined, options: IconFitBox): IconFit | null {
  const boxWidth = Number(options.width) || 0
  const boxHeight = Number(options.height) || 0
  const targetArea = Number(options.targetArea) || 0
  if (boxWidth <= 0 || boxHeight <= 0 || targetArea <= 0) return null

  const width = Number(metrics?.width) || 0
  const height = Number(metrics?.height) || 0
  const content = metrics?.content
  const contentWidth = Number(content?.width) || 0
  const contentHeight = Number(content?.height) || 0
  if (width <= 0 || height <= 0 || contentWidth <= 0 || contentHeight <= 0) return null

  const containScale = Math.min(boxWidth / width, boxHeight / height)
  if (!Number.isFinite(containScale) || containScale <= 0) return null

  const contentScale = Math.min(
    Math.sqrt(targetArea / (contentWidth * contentHeight)),
    boxWidth / contentWidth,
    boxHeight / contentHeight,
  )
  if (!Number.isFinite(contentScale) || contentScale <= 0) return null

  const contentCenterX = (Number(content?.x) || 0) + (contentWidth / 2)
  const contentCenterY = (Number(content?.y) || 0) + (contentHeight / 2)
  const scale = contentScale / containScale

  return {
    scale: round4(scale),
    offsetX: round4(-contentScale * (contentCenterX - (width / 2))),
    offsetY: round4(-contentScale * (contentCenterY - (height / 2))),
  }
}
