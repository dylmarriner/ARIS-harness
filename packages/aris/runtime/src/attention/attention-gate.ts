/** Deterministic attention: decides which runtime events wake cognition. */

import type { EventPriority, RuntimeEvent } from '../contracts/types.ts'
import type { EventBus } from '../events/bus.ts'

const PRIORITY_RANK: Readonly<Record<EventPriority, number>> = { low: 0, normal: 1, high: 2, critical: 3 }

/**
 * Why the gate decided as it did: `bypass` events are at or above
 * `bypassPriority` and ignore cooldown; `admitted` events passed threshold and
 * cooldown; `below-threshold` events are neither goal-relevant nor at
 * `minPriority`; `cooldown` events repeat a key admitted within `cooldownMs`.
 */
export type AttentionReason = 'bypass' | 'admitted' | 'below-threshold' | 'cooldown'

/** Outcome of evaluating one event. */
export interface AttentionDecision {
  /** Whether cognition should wake. */
  readonly wake: boolean
  /** Decision reason. */
  readonly reason: AttentionReason
  /** Cooldown key of the event. */
  readonly key: string
}

/** Signal delivered to cognition for an admitted event. */
export interface CognitionWake {
  /** Event that woke cognition. */
  readonly event: RuntimeEvent
  /** Gate decision. */
  readonly decision: AttentionDecision
}

/** Construction options for {@link AttentionGate}. */
export interface AttentionGateOptions {
  /** Lowest priority admitted without goal relevance. */
  readonly minPriority: EventPriority
  /** Priority at or above which events wake cognition regardless of cooldown. */
  readonly bypassPriority: EventPriority
  /** Window in milliseconds during which a repeated key is suppressed. */
  readonly cooldownMs: number
  /** Cooldown key, for example the event type plus its primary entity. */
  readonly keyOf: (event: RuntimeEvent) => string
  /** Whether an event concerns an active goal; relevant events skip the priority threshold. */
  readonly isGoalRelevant: (event: RuntimeEvent) => boolean
}

/**
 * Filters an event stream into cognition wake-ups without model inference.
 *
 * Most events only update state; the gate admits an event when it is at or
 * above `bypassPriority`, or when it is goal-relevant or at `minPriority` and
 * its key was not admitted within `cooldownMs`.
 */
export class AttentionGate {
  private readonly admittedAt = new Map<string, number>()

  /**
   * @param options - Gate configuration; a negative `cooldownMs` throws.
   */
  constructor(private readonly options: AttentionGateOptions) {
    if (!(options.cooldownMs >= 0)) throw new Error('attention cooldownMs must be non-negative')
  }

  /**
   * Decide whether an event wakes cognition, recording admitted keys.
   *
   * @param event - Event to evaluate.
   * @returns The decision.
   */
  evaluate(event: RuntimeEvent): AttentionDecision {
    const now = Date.now()
    this.prune(now)
    const key = this.options.keyOf(event)
    const rank = PRIORITY_RANK[event.priority]
    if (rank >= PRIORITY_RANK[this.options.bypassPriority]) {
      this.admit(key, now)
      return { wake: true, reason: 'bypass', key }
    }
    if (rank < PRIORITY_RANK[this.options.minPriority] && !this.options.isGoalRelevant(event)) {
      return { wake: false, reason: 'below-threshold', key }
    }
    if (this.admittedAt.has(key)) return { wake: false, reason: 'cooldown', key }
    this.admit(key, now)
    return { wake: true, reason: 'admitted', key }
  }

  /**
   * Evaluate every bus event and deliver admitted ones.
   *
   * @param bus - Bus to observe through its `*` subscription.
   * @param onWake - Receives each admitted event; a rejection rejects the bus publish.
   * @returns Disposer that removes the subscription.
   */
  attach(bus: EventBus, onWake: (wake: CognitionWake) => void | Promise<void>): () => void {
    return bus.subscribe('*', async (event) => {
      const decision = this.evaluate(event)
      if (decision.wake) await onWake({ event, decision })
    })
  }

  private admit(key: string, now: number): void {
    this.admittedAt.delete(key)
    this.admittedAt.set(key, now)
  }

  /** Drops expired keys; insertion order equals admission order, so the scan stops at the first live key. */
  private prune(now: number): void {
    for (const [key, at] of this.admittedAt) {
      if (now - at < this.options.cooldownMs) return
      this.admittedAt.delete(key)
    }
  }
}
