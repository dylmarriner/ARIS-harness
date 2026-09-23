import type { EventPriority, RuntimeEvent } from '../contracts/types.ts'
import type { AttentionGate } from '../ports.ts'
import type { SessionSnapshot } from '../runtime/session.ts'

const PRIORITY_RANK: Readonly<Record<EventPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
}

export interface PriorityAttentionOptions {
  readonly minimumPriority?: EventPriority
  readonly cooldownMs?: number
  readonly ignoredTypes?: readonly string[]
}

/**
 * Cheap deterministic attention gate for noisy OS feeds. Critical events always
 * pass; lower priorities are thresholded and coalesced by source/type cooldown.
 */
export class PriorityAttentionGate implements AttentionGate {
  private readonly minimumPriority: EventPriority
  private readonly cooldownMs: number
  private readonly ignoredTypes: ReadonlySet<string>
  private readonly lastAccepted = new Map<string, number>()

  constructor(options: PriorityAttentionOptions = {}) {
    this.minimumPriority = options.minimumPriority ?? 'normal'
    this.cooldownMs = options.cooldownMs ?? 500
    this.ignoredTypes = new Set(options.ignoredTypes ?? [])
    if (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0) {
      throw new RangeError('cooldownMs must be a non-negative finite number')
    }
  }

  shouldProcess(event: RuntimeEvent, _session: SessionSnapshot): Promise<boolean> {
    if (this.ignoredTypes.has(event.type)) return Promise.resolve(false)
    if (event.priority === 'critical') return Promise.resolve(true)
    if (PRIORITY_RANK[event.priority] < PRIORITY_RANK[this.minimumPriority]) {
      return Promise.resolve(false)
    }

    const key = `${event.source}\u0000${event.type}`
    const parsed = Date.parse(event.occurredAt)
    const now = Number.isFinite(parsed) ? parsed : Date.now()
    const previous = this.lastAccepted.get(key)
    if (previous !== undefined && now - previous < this.cooldownMs) {
      return Promise.resolve(false)
    }

    this.lastAccepted.set(key, now)
    return Promise.resolve(true)
  }
}
