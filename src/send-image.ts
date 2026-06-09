import { h, Logger } from 'koishi'
import zlib from 'node:zlib'
import { PluginConfig } from './types'

const logger = new Logger('rocom-send')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

function formatSessionContext(session: any): string {
  if (!session) return 'session=<null>'
  const platform = session.platform ?? 'unknown'
  const userId = session.userId ?? 'unknown'
  const guildId = session.guildId ?? 'private'
  const channelId = session.channelId ?? 'unknown'
  return `platform=${platform} user=${userId} guild=${guildId} channel=${channelId}`
}

function hasSendResult(result: any): boolean {
  if (result == null) return false
  if (typeof result === 'string') return result.length > 0
  if (Array.isArray(result)) return result.length > 0
  return true
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.allocUnsafe(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.allocUnsafe(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function isPng(buffer: Buffer): boolean {
  return buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > JPEG_SIGNATURE.length && buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
}

export function detectImageMime(image: Buffer): string {
  if (isPng(image)) return 'image/png'
  if (isJpeg(image)) return 'image/jpeg'
  return 'image/png'
}

export function compressPngImage(image: Buffer, config: Pick<PluginConfig, 'imageCompressionEnabled' | 'imageCompressionMinBytes' | 'imageCompressionLevel'>): Buffer {
  if (!config.imageCompressionEnabled) return image
  if (!isPng(image)) return image
  if (image.length < Math.max(0, config.imageCompressionMinBytes || 0)) return image

  try {
    const chunks: Array<{ type: string, data: Buffer }> = []
    const idatChunks: Buffer[] = []
    let offset = PNG_SIGNATURE.length
    while (offset + 12 <= image.length) {
      const length = image.readUInt32BE(offset)
      const type = image.subarray(offset + 4, offset + 8).toString('ascii')
      const dataStart = offset + 8
      const dataEnd = dataStart + length
      const nextOffset = dataEnd + 4
      if (dataEnd > image.length || nextOffset > image.length) return image
      const data = image.subarray(dataStart, dataEnd)
      chunks.push({ type, data })
      if (type === 'IDAT') idatChunks.push(data)
      offset = nextOffset
      if (type === 'IEND') break
    }
    if (!idatChunks.length) return image

    const rawImageData = zlib.inflateSync(Buffer.concat(idatChunks))
    const level = Math.max(0, Math.min(9, Math.floor(config.imageCompressionLevel ?? 9)))
    const compressedIdat = zlib.deflateSync(rawImageData, { level })

    const rebuiltChunks: Buffer[] = []
    let wroteIdat = false
    for (const chunk of chunks) {
      if (chunk.type === 'IDAT') {
        if (!wroteIdat) {
          rebuiltChunks.push(pngChunk('IDAT', compressedIdat))
          wroteIdat = true
        }
        continue
      }
      rebuiltChunks.push(pngChunk(chunk.type, chunk.data))
    }
    const compressed = Buffer.concat([PNG_SIGNATURE, ...rebuiltChunks])
    if (compressed.length < image.length) return compressed
  } catch (err) {
    logger.warn(`PNG compression failed, sending original image: ${err}`)
  }
  return image
}

export async function sendImageWithFallback(
  session: any,
  image: Buffer | null,
  fallbackText: string,
  scene: string,
  compressionConfig?: Pick<PluginConfig, 'imageCompressionEnabled' | 'imageCompressionMinBytes' | 'imageCompressionLevel'>,
) {
  const ctxInfo = formatSessionContext(session)

  if (!image) {
    logger.warn(`[${scene}] render returned empty image, fallback to text | ${ctxInfo}`)
    try {
      await session.send(fallbackText)
    } catch (e) {
      logger.error(`[${scene}] text fallback send failed | ${ctxInfo} | ${e}`)
    }
    return
  }

  const outputImage = compressionConfig ? compressPngImage(image, compressionConfig) : image
  if (outputImage.length < image.length) {
    logger.info(`[${scene}] compressed image ${image.length}B -> ${outputImage.length}B | ${ctxInfo}`)
  }

  try {
    const result = await session.send(h.image(outputImage, detectImageMime(outputImage)))
    if (!hasSendResult(result)) {
      logger.warn(`[${scene}] image send returned empty result | size=${outputImage.length}B | ${ctxInfo}`)
    }
  } catch (e) {
    logger.error(`[${scene}] image send failed | size=${outputImage.length}B | ${ctxInfo} | ${e}`)
    try {
      await session.send(fallbackText)
    } catch (fallbackErr) {
      logger.error(`[${scene}] text fallback send failed after image send error | ${ctxInfo} | ${fallbackErr}`)
    }
  }
}
