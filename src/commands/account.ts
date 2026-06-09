import { h, Logger } from 'koishi'
import { PluginDeps } from '../types'
import {
  getRoleToken,
  removeRoleToken,
  upsertRoleToken,
} from '../role-token'
import { Binding } from '../user'
import { sendImageWithFallback } from '../send-image'

const logger = new Logger('rocom-account')

async function recallMessages(session: any, messageIds: string[]) {
  if (!session?.bot?.deleteMessage || !session.channelId) return
  for (const id of messageIds) {
    if (!id) continue
    try {
      await session.bot.deleteMessage(session.channelId, id)
    } catch (err) {
      logger.warn(`撤回消息 ${id} 失败：${err}`)
    }
  }
}

export async function getPrimaryToken(deps: PluginDeps, userId: string): Promise<string> {
  const token = await getRoleToken(deps.ctx, userId)
  return token?.fwt || ''
}

export function notLoggedInHint(): string {
  return '您尚未绑定洛克王国账号，请先使用“洛克.QQ登录”或“洛克.微信登录”进行绑定。'
}

function formatBindTime(bindTime: number): string {
  if (!bindTime || bindTime <= 0) return '未知'
  const date = new Date(bindTime)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatLoginType(loginType: string): string {
  const typeMap: Record<string, string> = {
    qq: 'QQ',
    wechat: '微信',
    manual: '手动导入',
    uid: 'UID 绑定',
  }
  return typeMap[loginType] || loginType || '未知'
}

export async function saveBindingWithRoleInfo(
  deps: PluginDeps,
  session: any,
  fwToken: string,
  loginType: string,
  userId: string,
  preMessageIds: string[] = [],
) {
  const { ctx, client, userMgr } = deps
  const intermediateMessageIds: string[] = [...preMessageIds]
  const sendIntermediate = async (content: any) => {
    const result = await session.send(content)
    if (Array.isArray(result)) {
      for (const id of result) {
        if (id) intermediateMessageIds.push(String(id))
      }
    } else if (result) {
      intermediateMessageIds.push(String(result))
    }
  }

  await sendIntermediate('登录成功，正在调用绑定接口...')

  const bindRes = await client.createBinding(ctx, fwToken, userId)
  const bindingId = String(bindRes?.binding?.id || fwToken || '').trim()
  if (!bindRes?.binding || !bindingId) {
    await session.send('绑定接口调用失败，请稍后重试。')
    return
  }

  await sendIntermediate('绑定成功，正在获取角色信息...')
  const roleRes = await client.getRole(ctx, fwToken, undefined, userId)
  if (!roleRes?.role) {
    await session.send('绑定成功，但获取角色信息失败，请尝试重新登录。')
    return
  }

  const role = roleRes.role
  const binding: Binding = {
    binding_id: bindingId,
    login_type: loginType,
    role_id: role.id || 'unknown',
    nickname: role.name || '洛克',
    bind_time: Date.now(),
    is_primary: true,
  }

  userMgr.addBinding(userId, binding)
  await upsertRoleToken(ctx, {
    userId,
    fwt: fwToken,
    bindingId,
    roleId: binding.role_id,
    loginType,
  })

  await recallMessages(session, intermediateMessageIds)
  await session.send(`绑定成功！当前账号：${binding.nickname} (ID: ${binding.role_id})`)
}

export function register(deps: PluginDeps) {
  const { ctx, client, userMgr } = deps

  ctx.command('洛克').subcommand('.QQ登录', 'QQ 扫码登录')
    .alias('洛克QQ登录')
    .action(async ({ session }) => {
      const userId = session!.userId!
      const qrData = await client.qqQrLogin(ctx, userId)
      if (!qrData?.qr_image) return '获取 QQ 二维码失败。'

      const fwToken = qrData.frameworkToken
      const qrB64 = qrData.qr_image
      const imgData = qrB64.includes(',') ? qrB64.split(',')[1] : qrB64
      const qrSendResult = await session!.send(h('message', {},
        h.at(userId),
        h.text('\n请使用 QQ 扫描二维码登录（有效时间 2 分钟）\n注意需要双设备扫码。\n'),
        h.image(`data:image/png;base64,${imgData}`),
      ))
      const qrMessageIds: string[] = Array.isArray(qrSendResult)
        ? qrSendResult.filter(Boolean).map(String)
        : qrSendResult ? [String(qrSendResult)] : []

      const startTime = Date.now()
      while (Date.now() - startTime < 115000) {
        await new Promise(r => setTimeout(r, 3000))
        const status = await client.qqQrStatus(ctx, fwToken, userId)
        if (!status) continue
        if (status.status === 'done') {
          await saveBindingWithRoleInfo(deps, session, fwToken, 'qq', userId, qrMessageIds)
          return
        }
        if (['expired', 'failed', 'canceled'].includes(status.status)) break
      }
      return '登录超时或失败，请重试。'
    })

  ctx.command('洛克').subcommand('.微信登录', '微信扫码登录')
    .alias('洛克微信登录')
    .action(async ({ session }) => {
      const userId = session!.userId!
      const qrData = await client.wechatQrLogin(ctx, userId)
      if (!qrData?.qr_image) return '获取微信登录链接失败。'

      const fwToken = qrData.frameworkToken
      const qrUrl = qrData.qr_image
      const qrSendResult = await session!.send(`请使用微信打开以下链接扫码登录（有效时间 2 分钟）\n注意需要双设备扫码。\n${qrUrl}`)
      const qrMessageIds: string[] = Array.isArray(qrSendResult)
        ? qrSendResult.filter(Boolean).map(String)
        : qrSendResult ? [String(qrSendResult)] : []

      const startTime = Date.now()
      while (Date.now() - startTime < 115000) {
        await new Promise(r => setTimeout(r, 3000))
        const status = await client.wechatQrStatus(ctx, fwToken, userId)
        if (!status) continue
        if (status.status === 'done') {
          await saveBindingWithRoleInfo(deps, session, fwToken, 'wechat', userId, qrMessageIds)
          return
        }
        if (['expired', 'failed'].includes(status.status)) break
      }
      return '登录超时或失败，请重试。'
    })

  ctx.command('洛克').subcommand('.导入 <tgpId:string> <tgpTicket:string>', '导入 WeGame 凭证')
    .alias('洛克导入')
    .action(async ({ session }, tgpId, tgpTicket) => {
      if (!tgpId || !tgpTicket) return '用法：洛克.导入 <tgp_id> <tgp_ticket>'
      const userId = session!.userId!
      const res = await client.importToken(ctx, tgpId, tgpTicket, userId)
      if (!res?.frameworkToken) return '凭证导入失败。'
      await saveBindingWithRoleInfo(deps, session, res.frameworkToken, 'manual', userId)
    })

  ctx.command('洛克').subcommand('.绑定列表', '查看已绑定账号')
    .alias('洛克绑定列表')
    .action(async ({ session }) => {
      const bindings = userMgr.getUserBindings(session!.userId!)
      if (!bindings.length) return '暂无绑定账号。'

      const bindItems = bindings.map((binding, index) => ({
        index: index + 1,
        nickname: binding.nickname || '未知',
        isPrimary: Boolean(binding.is_primary),
        role_id: binding.role_id || '未知',
        type_label: formatLoginType(binding.login_type),
        created_at: formatBindTime(binding.bind_time),
      }))

      const data = {
        title: '绑定账号列表',
        subtitle: `共找到 ${bindings.length} 个有效绑定账号`,
        bindings: bindItems,
        commandHint: '洛克.切换 <序号> 切换主账号 | 洛克.解绑 <序号> 移除绑定',
        copyright: 'Koishi & WeGame 洛克王国插件',
      }

      const fallbackLines = ['【绑定账号列表】']
      bindItems.forEach((binding) => {
        const mark = binding.isPrimary ? '（主账号）' : ''
        fallbackLines.push(`[${binding.index}] ${binding.nickname} (ID: ${binding.role_id}) ${binding.type_label}${mark} · ${binding.created_at}`)
      })
      const png = await deps.renderer.renderHtml(ctx, 'bind-list', data)
      await sendImageWithFallback(session, png, fallbackLines.join('\n'), 'account:bind-list', deps.config)
    })

  ctx.command('洛克').subcommand('.绑定UID <uid:string>', '绑定洛克 UID')
    .alias('洛克绑定UID')
    .alias('绑定UID')
    .action(async ({ session }, uid) => {
      const userId = session!.userId!
      const targetUid = String(uid || '').trim()
      if (!/^\d{4,20}$/.test(targetUid)) return '用法：洛克.绑定UID <UID>，UID 必须为 4 到 20 位数字。'

      const res = await client.bindUid(ctx, targetUid, userId)
      if (!res) return `绑定 UID 失败：${client.getLastErrorBrief()}`

      const bindingPayload = res?.binding || {}
      const bindingId = String(bindingPayload?.id || bindingPayload?.binding_id || `uid:${targetUid}`).trim()
      const frameworkToken = String(res?.frameworkToken || res?.framework_token || '').trim()
      const binding: Binding = {
        binding_id: bindingId,
        login_type: 'uid',
        role_id: targetUid,
        nickname: `UID ${targetUid}`,
        bind_time: Date.now(),
        is_primary: true,
      }

      const existing = userMgr.getUserBindings(userId)
        .filter(item => item.binding_id !== bindingId && item.role_id !== targetUid)
        .map(item => ({ ...item, is_primary: false }))
      userMgr.saveUserBindings(userId, [...existing, binding])

      if (frameworkToken) {
        await upsertRoleToken(ctx, {
          userId,
          fwt: frameworkToken,
          bindingId,
          roleId: targetUid,
          loginType: 'uid',
        })
      }

      const source = String(bindingPayload?.source || '').trim()
      return [
        'UID 绑定成功。',
        `UID：${targetUid}`,
        source ? `来源：${source}` : '',
        frameworkToken ? '已生成凭证，后续 ingame 查询会优先使用该账号。' : '已保存为本地主账号，可用于默认 UID 查询。',
      ].filter(Boolean).join('\n')
    })

  ctx.command('洛克').subcommand('.切换 <index:number>', '切换主账号')
    .alias('洛克切换')
    .action(async ({ session }, index) => {
      if (!index) return '用法：洛克.切换 <序号>'
      const userId = session!.userId!
      if (!userMgr.switchPrimary(userId, index)) return '序号无效。'
      const newPrimary = userMgr.getPrimaryBinding(userId)
      if (newPrimary?.binding_id) {
        const token = await getRoleToken(ctx, userId)
        if (token && token.bindingId !== newPrimary.binding_id) {
          const res = await client.refreshBinding(ctx, newPrimary.binding_id, userId)
          if (res?.framework_token) {
            await upsertRoleToken(ctx, {
              userId,
              fwt: res.framework_token,
              bindingId: newPrimary.binding_id,
              roleId: newPrimary.role_id,
              loginType: newPrimary.login_type,
            })
          }
        }
      }
      return `成功切换到序号 ${index} 账号：${newPrimary?.nickname || '未知'}`
    })

  ctx.command('洛克').subcommand('.解绑 <index:number>', '解绑账号')
    .alias('洛克解绑')
    .action(async ({ session }, index) => {
      if (!index) return '用法：洛克.解绑 <序号>'
      const removed = userMgr.deleteUserBinding(session!.userId!, index)
      if (!removed) return '序号无效。'

      if (removed.binding_id) {
        try {
          await client.deleteBinding(ctx, removed.binding_id, session!.userId!)
        } catch {
          // 解绑本地记录优先，服务端删除失败不阻断结果。
        }
      }
      if (userMgr.getUserBindings(session!.userId!).length === 0) {
        await removeRoleToken(ctx, session!.userId!)
      } else {
        const token = await getRoleToken(ctx, session!.userId!)
        if (token?.bindingId === removed.binding_id) {
          const newPrimary = userMgr.getPrimaryBinding(session!.userId!)
          if (newPrimary?.binding_id) {
            const res = await client.refreshBinding(ctx, newPrimary.binding_id, session!.userId!)
            if (res?.framework_token) {
              await upsertRoleToken(ctx, {
                userId: session!.userId!,
                fwt: res.framework_token,
                bindingId: newPrimary.binding_id,
                roleId: newPrimary.role_id,
                loginType: newPrimary.login_type,
              })
            } else {
              await removeRoleToken(ctx, session!.userId!)
            }
          }
        }
      }
      return `已解绑账号：${removed.nickname}`
    })

  ctx.command('洛克').subcommand('.刷新', '刷新当前主账号凭证')
    .alias('洛克刷新')
    .action(async ({ session }) => {
      const userId = session!.userId!
      const binding = userMgr.getPrimaryBinding(userId)
      if (!binding) return notLoggedInHint()
      if (!binding.binding_id) return '绑定 ID 无效，请重新绑定账号。'

      await session!.send('正在刷新凭证，服务端会自动处理，无需手动操作。')
      const res = await client.refreshBinding(ctx, binding.binding_id, userId)
      if (res?.framework_token) {
        await upsertRoleToken(ctx, {
          userId,
          fwt: res.framework_token,
          bindingId: binding.binding_id,
          roleId: binding.role_id,
          loginType: binding.login_type,
        })
        return '当前账号凭证刷新成功。'
      }
      return '凭证刷新失败，可能已过期或不支持刷新（仅 QQ 扫码支持）。'
    })
}
