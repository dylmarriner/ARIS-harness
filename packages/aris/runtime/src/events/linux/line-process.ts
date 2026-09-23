import { spawn } from 'node:child_process'

export type LineHandler = (line: string) => Promise<void> | void

/** Run a long-lived command and deliver complete UTF-8 stdout lines in order. */
export async function runLineProcess(
  command: string,
  args: readonly string[],
  onLine: LineHandler,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const child = spawn(command, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let stdoutBuffer = ''
  let stderr = ''
  let pending = Promise.resolve()

  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.length === 0) continue
      pending = pending.then(() => Promise.resolve(onLine(line)))
    }
  })
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length)
  })

  const abort = (): void => {
    if (!child.killed) child.kill('SIGTERM')
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        void (async () => {
          try {
            if (stdoutBuffer.length > 0) await onLine(stdoutBuffer)
            await pending
            if (signal?.aborted === true || code === 0) {
              resolve()
              return
            }
            reject(new Error(
              `${command} exited with code ${String(code)}${stderr.length === 0 ? '' : `: ${stderr.trim()}`}`,
            ))
          } catch (error) {
            reject(error)
          }
        })()
      })
    })
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM')
  }
}
