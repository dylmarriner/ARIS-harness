/** In-process runtime event bus. */

import type { RuntimeEvent } from '../contracts/types.ts'

/** Subscriber callback. */
export type EventHandler<T = unknown> = (event: RuntimeEvent<T>) => void | Promise<void>

/** Type-keyed bus; the `*` subscription receives every event after type-specific subscribers. */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>()

  /**
   * Subscribe to one event type, or `*` for all types.
   *
   * @param type - Event type or `*`.
   * @param handler - Callback.
   * @returns Disposer that removes this subscription.
   */
  subscribe<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>()
    handlers.add(handler as EventHandler)
    this.handlers.set(type, handlers)

    return () => {
      handlers.delete(handler as EventHandler)
      if (handlers.size === 0 && this.handlers.get(type) === handlers) this.handlers.delete(type)
    }
  }

  /**
   * Deliver an event to its subscribers sequentially, awaiting each.
   *
   * A throwing subscriber rejects the publish and later subscribers do not run.
   *
   * @param event - Event to deliver.
   */
  async publish<T>(event: RuntimeEvent<T>): Promise<void> {
    const direct = [...(this.handlers.get(event.type) ?? [])]
    const wildcard = [...(this.handlers.get('*') ?? [])]
    for (const handler of [...direct, ...wildcard]) {
      await handler(event)
    }
  }
}
