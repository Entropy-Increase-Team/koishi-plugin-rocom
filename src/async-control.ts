/** A deadline cancels the underlying operation as well as the caller's wait. */
export async function withDeadline<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<T>,
  onAbort?: () => void,
): Promise<T> {
  const controller = new AbortController()
  const forward = () => controller.abort(parent?.reason ?? new Error('操作已取消'))
  if (parent?.aborted) forward()
  else parent?.addEventListener('abort', forward, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('操作超时')), Math.max(1, timeoutMs))
  let stop: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => {
      onAbort?.()
      reject(controller.signal.reason)
    }
    if (controller.signal.aborted) stop()
    else controller.signal.addEventListener('abort', stop, { once: true })
  })
  try {
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return task(controller.signal)
    })])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', forward)
    controller.signal.removeEventListener('abort', stop)
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const cancel = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }, Math.max(0, ms))
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
