import { Context } from 'koishi'

export interface Runner {
  <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>
  aborted: () => boolean
}

// 每个插件实例的互斥与停止标记：取消在途任务、阻止重叠检查。
export function createRunner(ctx: Context): Runner {
  const controller = new AbortController()
  let running = false
  ctx.on('dispose', () => controller.abort())

  const runner: Runner = Object.assign(
    async <T>(job: (signal: AbortSignal) => Promise<T>) => {
      if (running || controller.signal.aborted) return
      running = true
      try {
        return await job(controller.signal)
      } finally {
        running = false
      }
    },
    { aborted: () => controller.signal.aborted },
  )
  return runner
}
