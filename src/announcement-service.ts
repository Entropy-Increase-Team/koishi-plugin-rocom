import { resourceUrl } from './player-service'

export type AnnouncementBlock = { text: string, image: string }

export function plainAnnouncementText(value: unknown): string {
  return String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export function buildAnnouncementView(data: any, baseUrl: string) {
  const item = data?.detail || data?.announcement || data || {}
  const content = typeof item.content === 'object' ? item.content?.text : item.content
  const html = String(content || item.text || item.summary || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const blocks: AnnouncementBlock[] = []
  const images = new Set<string>()
  const addText = (value: string) => {
    const text = plainAnnouncementText(value)
    if (text) blocks.push({ text, image: '' })
  }
  const addImage = (value: unknown) => {
    const url = resourceUrl(value, baseUrl)
    if (!/^https?:\/\//i.test(url) || images.has(url)) return
    images.add(url)
    blocks.push({ text: '', image: url })
  }
  let offset = 0
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    addText(html.slice(offset, match.index))
    addImage(match[1] || match[2] || match[3])
    offset = match.index! + match[0].length
  }
  addText(html.slice(offset))
  for (const index of Array.isArray(item.content?.indexes) ? item.content.indexes : []) {
    for (const image of Array.isArray(index?.imageUrl) ? index.imageUrl : []) addImage(image)
  }
  return {
    title: String(item.title || '洛克公告'), id: String(item.thread_id || item.id || ''),
    publishedAt: String(item.publishAt || item.published_at || item.createdAt || ''),
    blocks, commandHint: '洛克.公告详情 <公告ID>', copyright: 'Koishi · 洛克王国',
  }
}

export function announcementViewText(view: ReturnType<typeof buildAnnouncementView>): string {
  return [view.title, view.publishedAt, ...view.blocks.map(block => block.text || block.image)].filter(Boolean).join('\n')
}

export function buildAnnouncementListView(data: any, page: number) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.list) ? data.list : []
  return {
    title: '洛克公告', page,
    items: items.map((item: any) => ({ id: String(item.thread_id || item.id || ''),
      title: String(item.title || '未命名公告'), summary: plainAnnouncementText(item.summary),
      publishedAt: String(item.publishAt || item.published_at || item.createdAt || '') })),
    commandHint: '洛克.公告 [页码] · 洛克.公告详情 <公告ID>', copyright: 'Koishi · 洛克王国',
  }
}
