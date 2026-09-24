import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWorldStateSnapshot,
  AttentionGate,
  BeliefGraph,
  EVENTD_SOURCE_ID,
  EventBus,
  EventdIngestor,
  loadWorldStateSnapshot,
} from '../src/index.ts'
import type { AttentionGateOptions, CognitionWake, EventdIngestorOptions, RuntimeEvent, WorldStateSnapshot } from '../src/index.ts'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'v1',
    eventId: '11111111-1111-4111-8111-111111111111',
    type: 'network.manager-changed',
    producer: 'aris-eventd.network-manager',
    occurredAt: '2026-09-24T01:00:00.000Z',
    correlationId: '22222222-2222-4222-8222-222222222222',
    causationId: null,
    sensitivity: 'internal',
    payload: { state: 'disconnected' },
    ...overrides,
  }
}

async function* stream(...messages: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  yield* messages
}

function ingestor(bus: EventBus, overrides: Partial<EventdIngestorOptions> = {}): { ingestor: EventdIngestor; rejected: string[] } {
  const rejected: string[] = []
  return {
    rejected,
    ingestor: new EventdIngestor({
      bus,
      priorities: [
        { prefix: 'system.', priority: 'high' },
        { prefix: 'system.thermal-critical', priority: 'critical' },
        { prefix: 'network.', priority: 'normal' },
        { prefix: 'process.', priority: 'low' },
      ],
      defaultPriority: 'normal',
      dedupeWindow: 2,
      onRejected: reason => rejected.push(reason),
      ...overrides,
    }),
  }
}

describe('EventdIngestor', () => {
  it('requires a positive dedupe window', () => {
    expect(() => ingestor(new EventBus(), { dedupeWindow: 0 })).toThrow('eventd dedupeWindow must be a positive integer')
    expect(() => ingestor(new EventBus(), { dedupeWindow: 1.5 })).toThrow('eventd dedupeWindow must be a positive integer')
  })

  it('normalizes envelopes with the longest matching priority rule', () => {
    const { ingestor: subject } = ingestor(new EventBus())
    const full = subject.normalize(envelope({
      type: 'system.thermal-critical',
      sourceNodeId: '33333333-3333-4333-8333-333333333333',
      confidence: 0.9,
      entityRefs: [{ kind: 'sensor', id: 'cpu0' }],
    }) as never)
    expect(full).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'system.thermal-critical',
      source: 'aris-eventd.network-manager',
      occurredAt: '2026-09-24T01:00:00.000Z',
      priority: 'critical',
      payload: {
        producer: 'aris-eventd.network-manager',
        sourceNodeId: '33333333-3333-4333-8333-333333333333',
        correlationId: '22222222-2222-4222-8222-222222222222',
        causationId: null,
        sensitivity: 'internal',
        confidence: 0.9,
        entities: ['sensor:cpu0'],
        data: { state: 'disconnected' },
      },
    })
    expect(subject.normalize(envelope({ type: 'system.power' }) as never).priority).toBe('high')
    expect(subject.normalize(envelope({ type: 'device.added' }) as never)).toMatchObject({ priority: 'normal', payload: { entities: [] } })
  })

  it('publishes text and byte messages, drops redeliveries, and rejects invalid messages', async () => {
    const bus = new EventBus()
    const seen: RuntimeEvent[] = []
    bus.subscribe('*', (event) => { seen.push(event) })
    const { ingestor: subject, rejected } = ingestor(bus)

    const first = JSON.stringify(envelope())
    const second = new TextEncoder().encode(JSON.stringify(envelope({ eventId: '44444444-4444-4444-8444-444444444444', type: 'process.started' })))
    const third = JSON.stringify(envelope({ eventId: '55555555-5555-4555-8555-555555555555' }))
    const stats = await subject.consume(stream(first, second, first, '{', JSON.stringify({ schemaVersion: 'v2' }), JSON.stringify([]), third, first))

    expect(stats).toEqual({ published: 4, duplicates: 1, rejected: 3 })
    expect(seen.map(event => [event.type, event.priority])).toEqual([
      ['network.manager-changed', 'normal'],
      ['process.started', 'low'],
      ['network.manager-changed', 'normal'],
      ['network.manager-changed', 'normal'],
    ])
    expect(rejected[0]).toBe('invalid JSON')
    expect(rejected[1]).toMatch(/^invalid envelope: schemaVersion, eventId/)
    expect(rejected[2]).toBe('invalid envelope: (root)')
  })

  it('stops before the next message once the signal aborts', async () => {
    const controller = new AbortController()
    const bus = new EventBus()
    bus.subscribe('*', () => { controller.abort() })
    const { ingestor: subject } = ingestor(bus)
    const stats = await subject.consume(stream(JSON.stringify(envelope()), JSON.stringify(envelope({ eventId: '44444444-4444-4444-8444-444444444444' }))), controller.signal)
    expect(stats.published).toBe(1)
  })
})

function runtimeEvent(type: string, priority: RuntimeEvent['priority']): RuntimeEvent {
  return { id: type, type, source: 'test', occurredAt: '2026-09-24T01:00:00.000Z', priority, payload: {} }
}

function gate(overrides: Partial<AttentionGateOptions> = {}): AttentionGate {
  return new AttentionGate({
    minPriority: 'high',
    bypassPriority: 'critical',
    cooldownMs: 1_000,
    keyOf: event => event.type,
    isGoalRelevant: event => event.type.startsWith('network.'),
    ...overrides,
  })
}

describe('AttentionGate', () => {
  it('rejects a negative cooldown', () => {
    expect(() => gate({ cooldownMs: -1 })).toThrow('attention cooldownMs must be non-negative')
  })

  it('admits by priority or goal relevance, suppresses repeats, and lets critical events bypass cooldown', () => {
    vi.useFakeTimers()
    const subject = gate()
    expect(subject.evaluate(runtimeEvent('process.started', 'low'))).toEqual({ wake: false, reason: 'below-threshold', key: 'process.started' })
    expect(subject.evaluate(runtimeEvent('network.manager-changed', 'low'))).toMatchObject({ wake: true, reason: 'admitted' })
    expect(subject.evaluate(runtimeEvent('service.failed', 'high'))).toMatchObject({ wake: true, reason: 'admitted' })
    expect(subject.evaluate(runtimeEvent('service.failed', 'high'))).toMatchObject({ wake: false, reason: 'cooldown' })
    expect(subject.evaluate(runtimeEvent('system.thermal-critical', 'critical'))).toMatchObject({ wake: true, reason: 'bypass' })
    expect(subject.evaluate(runtimeEvent('system.thermal-critical', 'critical'))).toMatchObject({ wake: true, reason: 'bypass' })

    vi.advanceTimersByTime(500)
    expect(subject.evaluate(runtimeEvent('network.manager-changed', 'low'))).toMatchObject({ reason: 'cooldown' })
    vi.advanceTimersByTime(600)
    expect(subject.evaluate(runtimeEvent('service.failed', 'high'))).toMatchObject({ wake: true, reason: 'admitted' })
  })

  it('never suppresses repeats with a zero cooldown', () => {
    const subject = gate({ cooldownMs: 0 })
    expect(subject.evaluate(runtimeEvent('service.failed', 'high')).wake).toBe(true)
    expect(subject.evaluate(runtimeEvent('service.failed', 'high')).wake).toBe(true)
  })

  it('delivers admitted bus events until disposed', async () => {
    const bus = new EventBus()
    const wakes: CognitionWake[] = []
    const dispose = gate().attach(bus, (wake) => { wakes.push(wake) })
    await bus.publish(runtimeEvent('process.started', 'low'))
    await bus.publish(runtimeEvent('service.failed', 'high'))
    dispose()
    await bus.publish(runtimeEvent('system.thermal-critical', 'critical'))
    expect(wakes.map(wake => [wake.event.type, wake.decision.reason])).toEqual([['service.failed', 'admitted']])
  })
})

function snapshot(): WorldStateSnapshot {
  const entity = (kind: string, id: string, sensitivity: 'internal' | 'restricted', attributes: Record<string, unknown>) => ({
    schemaVersion: 'v1' as const,
    ref: { kind, id },
    sensitivity,
    attributes,
    confidence: 0.95,
    observedAt: '2026-09-24T01:00:00.000Z',
    updatedAt: '2026-09-24T01:00:01.000Z',
    sourceEventIds: ['11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444'],
  })
  return {
    schemaVersion: 'v1',
    revision: 7,
    generatedAt: '2026-09-24T01:00:02.000Z',
    entities: [
      entity('network-interface', 'wlan0', 'internal', { state: 'down', carrier: false }),
      entity('session', 'c2', 'restricted', { user: 'dylan' }),
    ],
    recentEventIds: [],
  }
}

describe('eventd world state', () => {
  it('upserts one belief per attribute and skips entities above the sensitivity ceiling', () => {
    const graph = new BeliefGraph()
    expect(applyWorldStateSnapshot(graph, snapshot(), 'sensitive')).toBe(2)
    expect(graph.findBySubject('network-interface:wlan0')).toEqual([
      {
        id: 'network-interface:wlan0#state',
        subject: 'network-interface:wlan0',
        predicate: 'state',
        object: 'down',
        state: 'known',
        confidence: 0.95,
        provenance: [{ sourceKind: 'sensor', sourceId: EVENTD_SOURCE_ID, observedAt: '2026-09-24T01:00:00.000Z', detail: '11111111-1111-4111-8111-111111111111,44444444-4444-4444-8444-444444444444' }],
        updatedAt: '2026-09-24T01:00:01.000Z',
      },
      expect.objectContaining({ id: 'network-interface:wlan0#carrier', object: false }),
    ])
    expect(graph.findBySubject('session:c2')).toEqual([])
    expect(applyWorldStateSnapshot(new BeliefGraph(), snapshot(), 'restricted')).toBe(3)
  })

  it('loads a checkpoint, treats a missing file as absent, and rejects invalid content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aris-world-'))
    directories.push(directory)
    const path = join(directory, 'world-state.json')
    await expect(loadWorldStateSnapshot(path)).resolves.toBeUndefined()

    const { entities, ...rest } = snapshot()
    const [first] = entities
    const { sensitivity: _omitted, ...withoutSensitivity } = first as NonNullable<typeof first>
    await writeFile(path, JSON.stringify({ ...rest, entities: [withoutSensitivity] }))
    const loaded = await loadWorldStateSnapshot(path)
    expect(loaded?.entities[0]?.sensitivity).toBe('internal')

    await writeFile(path, JSON.stringify({ ...rest, schemaVersion: 'v2', entities }))
    await expect(loadWorldStateSnapshot(path)).rejects.toThrow()
    await expect(loadWorldStateSnapshot(directory)).rejects.toMatchObject({ code: 'EISDIR' })
  })
})
