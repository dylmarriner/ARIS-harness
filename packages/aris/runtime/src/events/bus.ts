import type { RuntimeEvent } from '../contracts/types.ts'

export type EventHandler<T = unknown> = (event: RuntimeEvent<T>) => void | Promise<void>

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>()

  subscribe<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>()
    handlers.add(handler as EventHandler)
    this.handlers.set(type, handlers)

    return () => {
      const current = this.handlers.get(type)
      current?.delete(handler as EventHandler)
      if (current?.size === 0) this.handlers.delete(type)
    }
  }

  async publish<T>(event: RuntimeEvent<T>): Promise<void> {
    const direct = [...(this.handlers.get(event.type) ?? [])]
    const wildcard = [...(this.handlers.get('*') ?? [])]
    for (const handler of [...direct, ...wildcard]) {
      await handler(event)
    }
  }
}
