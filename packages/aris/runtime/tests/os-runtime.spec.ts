import { describe, expect, it } from 'vitest'
import {
  ApprovalPolicyEngine,
  EventBus,
  EventRuntime,
  ImpactSimulator,
  MemoryAuditSink,
  PriorityAttentionGate,
  RuntimeSession,
  normalizeJournalEntry,
  normalizeNetworkManagerLine,
} from '../src/index.ts'
import type { Action, AuditRecord, RuntimeEvent } from '../src/index.ts'

function session(): RuntimeSession {
  return new RuntimeSession('session-1', 'identity-1', '2026-09-24T00:00:00.000Z')
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: 'action-1',
    kind: 'test',
    capability: 'system.read',
    input: {},
    impact: 'read',
    requiresVerification: false,
    transactional: false,
    ...overrides,
  }
}

describe('ARIS OS event runtime', () => {
  it('normalizes journald priority and timestamp', () => {
    const event = normalizeJournalEntry({
      _SYSTEMD_UNIT: 'NetworkManager.service',
      PRIORITY: '3',
      MESSAGE: 'link changed',
      __REALTIME_TIMESTAMP: '1700000000000000',
    })
    expect(event.source).toBe('journald:NetworkManager.service')
    expect(event.priority).toBe('high')
    expect(event.occurredAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('raises NetworkManager failures above ordinary changes', () => {
    expect(normalizeNetworkManagerLine('wlan0: disconnected').priority).toBe('high')
    expect(normalizeNetworkManagerLine('wlan0: connected').priority).toBe('normal')
  })

  it('broadcasts all events but only emits attention for accepted events', async () => {
    const bus = new EventBus()
    const seen: RuntimeEvent[] = []
    bus.subscribe('*', event => { seen.push(event) })
    const runtime = new EventRuntime({
      sources: [],
      bus,
      attention: new PriorityAttentionGate({ minimumPriority: 'high' }),
      session: session(),
    })

    const accepted = await runtime.ingest({
      id: 'evt-1',
      type: 'linux.filesystem.change',
      source: 'filesystem:/tmp',
      occurredAt: '2026-09-24T00:00:00.000Z',
      priority: 'normal',
      payload: {},
    })
    expect(accepted).toBe(false)
    expect(seen.map(event => event.type)).toEqual(['linux.filesystem.change'])

    const urgent = await runtime.ingest({
      id: 'evt-2',
      type: 'linux.network-manager.change',
      source: 'network-manager',
      occurredAt: '2026-09-24T00:00:01.000Z',
      priority: 'high',
      payload: {},
    })
    expect(urgent).toBe(true)
    expect(seen.map(event => event.type)).toEqual([
      'linux.filesystem.change',
      'linux.network-manager.change',
      'attention.requested',
    ])
  })

  it('coalesces noisy non-critical events but never suppresses critical events', async () => {
    const gate = new PriorityAttentionGate({ cooldownMs: 1_000 })
    const snapshot = session().snapshot()
    const base: RuntimeEvent = {
      id: 'evt-1',
      type: 'linux.journal.entry',
      source: 'journald:test.service',
      occurredAt: '2026-09-24T00:00:00.000Z',
      priority: 'normal',
      payload: {},
    }
    expect(await gate.shouldProcess(base, snapshot)).toBe(true)
    expect(await gate.shouldProcess({ ...base, id: 'evt-2', occurredAt: '2026-09-24T00:00:00.100Z' }, snapshot)).toBe(false)
    expect(await gate.shouldProcess({ ...base, id: 'evt-3', priority: 'critical' }, snapshot)).toBe(true)
  })
})

describe('ARIS authority providers', () => {
  it('fails closed when a mutating action has no simulator', async () => {
    const simulator = new ImpactSimulator()
    const result = await simulator.simulate(
      {
        id: 'goal-1',
        description: 'test',
        priority: 1,
        createdAt: '2026-09-24T00:00:00.000Z',
        constraints: [],
        status: 'active',
      },
      action({ impact: 'write', capability: 'filesystem.write' }),
      session().snapshot(),
    )
    expect(result.safe).toBe(false)
  })

  it('uses one-shot approval for ungranted mutations', async () => {
    let requests = 0
    const policy = new ApprovalPolicyEngine({
      subjectId: 'identity-1',
      approval: {
        async request() {
          requests += 1
          return 'allowed-once'
        },
      },
    })
    const decision = await policy.authorize(
      {
        id: 'goal-1',
        description: 'test',
        priority: 1,
        createdAt: '2026-09-24T00:00:00.000Z',
        constraints: [],
        status: 'active',
      },
      action({ impact: 'privileged', capability: 'service.restart' }),
      session().snapshot(),
    )
    expect(decision.allowed).toBe(true)
    expect(requests).toBe(1)
  })

  it('keeps only the configured bounded audit history', async () => {
    const audit = new MemoryAuditSink({ maxRecords: 2 })
    for (const id of ['1', '2', '3']) {
      const record: AuditRecord = {
        id,
        type: 'test',
        occurredAt: '2026-09-24T00:00:00.000Z',
        details: {},
      }
      await audit.append(record)
    }
    expect(audit.snapshot().map(record => record.id)).toEqual(['2', '3'])
  })
})
