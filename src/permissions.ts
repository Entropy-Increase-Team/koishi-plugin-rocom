import type { PluginConfig } from './types'

export type GroupRole = 'owner' | 'admin' | 'member' | 'unknown'

export interface SubscriptionPermissionInput {
  privateChat: boolean
  privateAllowed: boolean
  groupRole: GroupRole
  groupAdminEnabled: boolean
  botAdminEnabled: boolean
  whitelisted: boolean
  authority: number
  botAdminAuthority: number
}

// 统一订阅权限策略：群主/管理员与 Bot 管理员按独立开关生效。
export function mayManageSubscription(p: SubscriptionPermissionInput): boolean {
  if (p.privateChat) return p.privateAllowed
  if (p.botAdminEnabled && (p.whitelisted || p.authority >= p.botAdminAuthority)) return true
  return p.groupAdminEnabled && (p.groupRole === 'owner' || p.groupRole === 'admin')
}

// 从平台会话中读取可信角色；只接受适配器规范化的字符串角色。
export function groupRoleFromSession(session: any): GroupRole {
  const collect = (value: any, output: string[]) => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      for (const item of value) collect(item, output)
      return
    }
    output.push(String(value))
  }

  const roles: string[] = []
  const member = session?.event?.member || session?.member
  collect(member?.roles, roles)
  collect(member?.role, roles)
  const sender = session?.event?.sender || session?.sender
  collect(sender?.role, roles)
  const author = session?.event?.author || session?.author
  collect(author?.member_role, roles)
  collect(author?.memberRole, roles)
  collect(member?.member_role, roles)

  // OneBot 原始事件由适配器提供；不从消息正文读取角色。
  collect(session?.onebot?.sender?.role, roles)
  const normalized = roles.map(role => role.trim().toLowerCase())
  if (normalized.some(role => ['owner', '群主', '创建者'].includes(role))) return 'owner'
  if (normalized.some(role => ['admin', 'administrator', '管理员'].includes(role))) return 'admin'
  if (normalized.some(role => ['member', '普通成员'].includes(role))) return 'member'
  return 'unknown'
}

export function isDirectSession(session: any): boolean {
  if (typeof session?.isDirect === 'boolean') return session.isDirect
  const type = session?.event?.channel?.type
  if (type !== undefined) return type === 1 || type === 'DIRECT'
  return !session?.guildId
}

export function canManageSubscription(config: PluginConfig, session: any, privateAllowed = true): boolean {
  return mayManageSubscription({
    privateChat: isDirectSession(session), privateAllowed,
    groupRole: groupRoleFromSession(session),
    groupAdminEnabled: config.subscriptionGroupAdminEnabled !== false,
    botAdminEnabled: config.subscriptionBotAdminEnabled !== false,
    whitelisted: config.adminUserIds.includes(session?.userId || ''),
    authority: Number(session?.user?.authority ?? 0) || 0,
    botAdminAuthority: Math.max(1, Number(config.subscriptionBotAdminAuthority) || 4),
  })
}
