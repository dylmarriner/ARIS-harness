/**
 * Ingestion of ARIS OS `aris-eventd` events.
 *
 * eventd owns the raw Linux adapters (procfs, systemd, journald, udev, sysfs,
 * NetworkManager, mounts, logind) and publishes `EventEnvelope` v1 messages on
 * NATS subjects `aris.v1.<type>`. The runtime consumes those envelopes; it does
 * not read OS sources itself.
 */

import { z } from 'zod'
import type { EventPriority, RuntimeEvent } from '../contracts/types.ts'
import type { EventBus } from './bus.ts'

const Uuid = z.uuid()
const Timestamp = z.iso.datetime({ offset: true })

/** eventd sensitivity label; `restricted` content must not leave the host. */
export type EventdSensitivity = 'public' | 'internal' | 'sensitive' | 'restricted'

/** `EventEnvelope` v1 from `@aris/contracts`. */
export const EventdEnvelopeSchema = z.object({
  schemaVersion: z.literal('v1'),
  eventId: Uuid,
  type: z.string().min(1),
  producer: z.string().min(1),
  sourceNodeId: Uuid.optional(),
  occurredAt: Timestamp,
  observedAt: Timestamp.optional(),
  correlationId: Uuid,
  causationId: Uuid.nullable(),
  sensitivity: z.enum(['public', 'internal', 'sensitive', 'restricted']),
  confidence: z.number().min(0).max(1).optional(),
  entityRefs: z.array(z.object({ kind: z.string().min(1).max(128), id: z.string().min(1).max(512) })).optional(),
  payload: z.record(z.string(), z.unknown()),
})

/** Validated eventd envelope. */
export type EventdEnvelope = z.infer<typeof EventdEnvelopeSchema>

/** Payload of a runtime event normalized from an eventd envelope. */
export interface EventdEventPayload {
  /** eventd producer, for example `aris-eventd.network-manager`. */
  readonly producer: string
  /** Node that observed the event. */
  readonly sourceNodeId?: string
  /** Correlation id shared by related events. */
  readonly correlationId: string
  /** Event that caused this one. */
  readonly causationId: string | null
  /** Sensitivity label. */
  readonly sensitivity: EventdSensitivity
  /** Producer confidence in `[0, 1]`. */
  readonly confidence?: number
  /** Entities the event concerns, as `kind:id`. */
  readonly entities: readonly string[]
  /** Producer payload. */
  readonly data: Readonly<Record<string, unknown>>
}

/** Priority assigned to event types that start with `prefix`. */
export interface EventdPriorityRule {
  /** Dotted type prefix, for example `service.failed` or `system.`. */
  readonly prefix: string
  /** Priority for matching types. */
  readonly priority: EventPriority
}

/** Construction options for {@link EventdIngestor}. */
export interface EventdIngestorOptions {
  /** Bus that receives normalized events. */
  readonly bus: EventBus
  /** Priority rules; the longest matching prefix wins. */
  readonly priorities: readonly EventdPriorityRule[]
  /** Priority of types no rule matches. */
  readonly defaultPriority: EventPriority
  /** Number of recent event ids remembered for duplicate suppression; at least 1. */
  readonly dedupeWindow: number
  /** Receives each message that fails JSON or envelope validation. */
  readonly onRejected: (reason: string, message: string) => void
}

/** Counters for one {@link EventdIngestor.consume} run. */
export interface EventdIngestStats {
  /** Envelopes published to the bus. */
  readonly published: number
  /** Envelopes dropped as repeats of a recent event id. */
  readonly duplicates: number
  /** Messages that failed validation. */
  readonly rejected: number
}

/**
 * Validates eventd messages, drops redelivered event ids, and publishes the
 * rest to the runtime bus as {@link RuntimeEvent}s whose `type` is the eventd
 * type and whose `source` is the producer.
 *
 * The message stream is any async iterable of JSON text or bytes; a NATS
 * subscription on `aris.v1.>` adapts with `(async function* () { for await (const m of sub) yield m.data })()`.
 */
export class EventdIngestor {
  private readonly recent = new Set<string>()
  private readonly decoder = new TextDecoder()

  /**
   * @param options - Ingestion configuration; a `dedupeWindow` below 1 throws.
   */
  constructor(private readonly options: EventdIngestorOptions) {
    if (!Number.isInteger(options.dedupeWindow) || options.dedupeWindow < 1) {
      throw new Error('eventd dedupeWindow must be a positive integer')
    }
  }

  /**
   * Normalize one validated envelope.
   *
   * @param envelope - eventd envelope.
   * @returns The runtime event.
   */
  normalize(envelope: EventdEnvelope): RuntimeEvent<EventdEventPayload> {
    return {
      id: envelope.eventId,
      type: envelope.type,
      source: envelope.producer,
      occurredAt: envelope.occurredAt,
      priority: this.priorityOf(envelope.type),
      payload: {
        producer: envelope.producer,
        ...(envelope.sourceNodeId === undefined ? {} : { sourceNodeId: envelope.sourceNodeId }),
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        sensitivity: envelope.sensitivity,
        ...(envelope.confidence === undefined ? {} : { confidence: envelope.confidence }),
        entities: (envelope.entityRefs ?? []).map(ref => `${ref.kind}:${ref.id}`),
        data: envelope.payload,
      },
    }
  }

  /**
   * Consume messages until the stream ends or `signal` aborts.
   *
   * A throwing bus subscriber rejects the run, matching {@link EventBus.publish}.
   *
   * @param messages - JSON envelopes as text or UTF-8 bytes.
   * @param signal - Stops consumption before the next message.
   * @returns Counters for the run.
   */
  async consume(messages: AsyncIterable<string | Uint8Array>, signal?: AbortSignal): Promise<EventdIngestStats> {
    let published = 0
    let duplicates = 0
    let rejected = 0
    for await (const message of messages) {
      if (signal?.aborted === true) break
      const text = typeof message === 'string' ? message : this.decoder.decode(message)
      const envelope = this.parse(text)
      if (envelope === undefined) {
        rejected += 1
        continue
      }
      if (this.recent.has(envelope.eventId)) {
        duplicates += 1
        continue
      }
      this.remember(envelope.eventId)
      await this.options.bus.publish(this.normalize(envelope))
      published += 1
    }
    return { published, duplicates, rejected }
  }

  private parse(text: string): EventdEnvelope | undefined {
    let json: unknown
    try {
      json = JSON.parse(text) as unknown
    } catch {
      this.options.onRejected('invalid JSON', text)
      return undefined
    }
    const parsed = EventdEnvelopeSchema.safeParse(json)
    if (!parsed.success) {
      this.options.onRejected(`invalid envelope: ${parsed.error.issues.map(issue => issue.path.join('.') || '(root)').join(', ')}`, text)
      return undefined
    }
    return parsed.data
  }

  private remember(eventId: string): void {
    this.recent.add(eventId)
    if (this.recent.size > this.options.dedupeWindow) {
      const [oldest] = this.recent
      this.recent.delete(oldest as string)
    }
  }

  private priorityOf(type: string): EventPriority {
    let match: EventdPriorityRule | undefined
    for (const rule of this.options.priorities) {
      if (type.startsWith(rule.prefix) && (match === undefined || rule.prefix.length > match.prefix.length)) match = rule
    }
    return match?.priority ?? this.options.defaultPriority
  }
}
