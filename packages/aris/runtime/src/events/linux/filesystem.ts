import { watch, type FSWatcher } from 'node:fs'
import type { RuntimeEventPublisher, RuntimeEventSource } from '../source.ts'

export interface FilesystemEventSourceOptions {
  readonly path: string
  readonly recursive?: boolean
}

/** Streams native filesystem change notifications for one watched root. */
export class FilesystemEventSource implements RuntimeEventSource {
  readonly id: string

  constructor(private readonly options: FilesystemEventSourceOptions) {
    if (options.path.length === 0) throw new Error('filesystem event source path must be non-empty')
    this.id = `linux.filesystem:${options.path}`
  }

  async run(publish: RuntimeEventPublisher, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    let watcher: FSWatcher | undefined
    let abort: (() => void) | undefined

    try {
      await new Promise<void>((resolve, reject) => {
        abort = (): void => {
          watcher?.close()
          resolve()
        }
        signal?.addEventListener('abort', abort, { once: true })

        try {
          watcher = watch(
            this.options.path,
            { recursive: this.options.recursive ?? false },
            (eventType, filename) => {
              const published = publish({
                id: globalThis.crypto.randomUUID(),
                type: 'linux.filesystem.change',
                source: this.id,
                occurredAt: new Date().toISOString(),
                priority: 'normal',
                payload: {
                  root: this.options.path,
                  eventType,
                  filename: filename?.toString() ?? null,
                },
              })
              void Promise.resolve(published).catch(reject)
            },
          )
          watcher.once('error', reject)
          watcher.once('close', resolve)
        } catch (error) {
          reject(error)
        }
      })
    } finally {
      if (abort !== undefined) signal?.removeEventListener('abort', abort)
      watcher?.close()
    }
  }
}
