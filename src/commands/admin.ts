import { Logger } from 'koishi'
import { getRoleToken, removeRoleToken, upsertRoleToken } from '../role-token'
import { PluginDeps } from '../types'

const logger = new Logger('rocom-admin')

export function register(deps: PluginDeps) {
  const { ctx, config, client, userMgr } = deps

  function isAdmin(userId: string): boolean {
    return config.adminUserIds.includes(userId)
  }

  ctx.command('洛克').subcommand('.刷新所有凭证', '刷新所有用户凭证（管理员）')
    .alias('洛克刷新所有凭证')
    .action(async ({ session }) => {
      if (!isAdmin(session!.userId!)) return '此指令仅限管理员使用。'
      await session!.send('正在刷新所有用户的凭证...')

      const allUsers = userMgr.getAllUsersBindings()
      let success = 0
      let fail = 0

      for (const [userId] of Object.entries(allUsers)) {
        const binding = userMgr.getPrimaryBinding(userId)
        if (!binding || binding.login_type !== 'qq' || !binding.binding_id) continue

        try {
          const res = await client.refreshBinding(ctx, binding.binding_id, userId)
          if (res?.framework_token) {
            await upsertRoleToken(ctx, {
              userId,
              fwt: res.framework_token,
              bindingId: binding.binding_id,
              roleId: binding.role_id,
              loginType: binding.login_type,
            })
            success++
          } else {
            fail++
          }
        } catch {
          fail++
        }
      }

      return `刷新完成：成功 ${success}，失败 ${fail}`
    })

  ctx.command('洛克').subcommand('.删除失效绑定', '清理失效绑定（管理员）')
    .alias('洛克删除失效绑定')
    .action(async ({ session }) => {
      if (!isAdmin(session!.userId!)) return '此指令仅限管理员使用。'
      await session!.send('正在检查所有用户的绑定有效性...')

      const allUsers = userMgr.getAllUsersBindings()
      let totalInvalid = 0
      let totalValid = 0

      for (const [userId, bindings] of Object.entries(allUsers)) {
        const token = await getRoleToken(ctx, userId)
        if (!token?.fwt) {
          logger.warn(`用户 ${userId} 没有可用的 fwt，跳过失效检测`)
          continue
        }

        const fwToken = token.fwt
        const valid: typeof bindings = []

        for (const binding of bindings) {
          const roleRes = await client.getRole(ctx, fwToken, undefined, userId)
          if (roleRes?.role) {
            valid.push(binding)
            totalValid++
            continue
          }

          if (binding.binding_id) {
            try {
              await client.deleteBinding(ctx, binding.binding_id, userId)
            } catch (e) {
              logger.warn(`删除用户 ${userId} 服务端绑定 ${binding.binding_id} 失败：${e}`)
            }
          }
          totalInvalid++
        }

        userMgr.saveUserBindings(userId, valid)
        if (valid.length === 0) {
          await removeRoleToken(ctx, userId)
        }
      }

      return totalInvalid > 0
        ? `清理完成：移除 ${totalInvalid} 个无效绑定，剩余 ${totalValid} 个有效绑定。`
        : `所有绑定均有效，无需清理。共 ${totalValid} 个有效绑定。`
    })

  if (config.autoRefreshEnabled) {
    ctx.setInterval(async () => {
      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (!config.autoRefreshTime.includes(timeStr)) return

      const allUsers = userMgr.getAllUsersBindings()
      for (const [userId] of Object.entries(allUsers)) {
        const binding = userMgr.getPrimaryBinding(userId)
        if (!binding || binding.login_type !== 'qq' || !binding.binding_id) continue

        try {
          const res = await client.refreshBinding(ctx, binding.binding_id, userId)
          if (res?.framework_token) {
            await upsertRoleToken(ctx, {
              userId,
              fwt: res.framework_token,
              bindingId: binding.binding_id,
              roleId: binding.role_id,
              loginType: binding.login_type,
            })
          }
        } catch (e) {
          logger.warn(`自动刷新用户 ${userId} 失败: ${e}`)
        }
      }
    }, 60000)
  }
}
