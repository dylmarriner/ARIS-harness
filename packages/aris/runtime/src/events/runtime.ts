import type { RuntimeEvent } from '../contracts/types.ts'
import type { AttentionGate } from '../ports.ts'
import { RuntimeSession } from '../runtime/session.ts'
import { EventBus } from './bus.ts'
import type { RuntimeEventSource } from './source.ts'

export interface EventRuntimeOptions {
  readonly sources: readonly RuntimeEventSource[]
  readonly bus: EventBus
  readonly attention: AttentionGate
  readonly session: RuntimeSession
}

/**
 * Runs passive OS/event sources, broadcasts every normalized event, and emits a
 * separate attention request only for events that should wake cognition.
 */
export class EventRuntime {
  constructor(private readonly options: EventRuntimeOptions) {}

  async run(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await Promise.all(this.options.sources.map(async source => {
      await source.run(async event => this.ingest(event), signal)
    }))
  }

  async ingest(event: RuntimeEvent): Promise<boolean> {
    await this.options.bus.publish(event)
    const shouldProcess = await this.options.attention.shouldProcess(
      event,
      this.options.session.snapshot(),
    )
    if (!shouldProcess) return false

    await this.options.bus.publish({
      id: globalThis.crypto.randomUUID(),
      type: 'attention.requested',
      source: 'aris.event-runtime',
      occurredAt: new Date().toISOString(),
      priority: event.priority,
      payload: { event },
    })
    return true
  }
}
