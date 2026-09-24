import { describe, expect, it } from 'vitest'
import {
  BeliefGraph,
  CapabilityRegistry,
  EventBus,
  MemoryAuditSink,
  ModelRegistry,
  RuntimeSession,
  ToolRegistry,
} from '../src/index.ts'
import type { Action, AuditRecord, Belief, Capability, ModelProvider, RuntimeEvent, Tool } from '../src/index.ts'

const now = '2026-09-24T00:00:00.000Z'

function capability(id: string, tags: readonly string[] = []): Capability {
  return { id, kind: 'model', description: id, health: 'healthy', tags, metadata: {}, updatedAt: now }
}

function tool(id: string, capabilities: readonly string[]): Tool {
  return { id, capabilities, execute: async action => ({ actionId: action.id, status: 'success', output: null, startedAt: now, finishedAt: now }) }
}

function actionFor(capabilityId: string, toolId?: string): Action {
  return {
    id: 'a1',
    kind: 'probe',
    capability: capabilityId,
    ...(toolId === undefined ? {} : { tool: toolId }),
    input: {},
    impact: 'read',
    requiresVerification: false,
    transactional: false,
  }
}

function belief(id: string, subject = 'host'): Belief {
  return { id, subject, predicate: 'has_gpu', object: 'RX580', state: 'known', confidence: 1, provenance: [], updatedAt: now }
}

function event(type: string): RuntimeEvent<string> {
  return { id: `evt-${type}`, type, source: 'test', occurredAt: now, priority: 'normal', payload: type }
}

describe('CapabilityRegistry', () => {
  it('routes only healthy capabilities by id or tag', () => {
    const registry = new CapabilityRegistry()
    registry.register(capability('ollama.local', ['offline']))
    registry.register(capability('api.remote'))

    expect(registry.findHealthy('offline').map(next => next.id)).toEqual(['ollama.local'])
    expect(registry.findHealthy('api.remote').map(next => next.id)).toEqual(['api.remote'])

    const updated = registry.updateHealth('ollama.local', 'unavailable', '2026-09-24T01:00:00.000Z')

    expect(updated).toMatchObject({ health: 'unavailable', updatedAt: '2026-09-24T01:00:00.000Z' })
    expect(registry.get('ollama.local')).toEqual(updated)
    expect(registry.findHealthy('offline')).toEqual([])
    expect(registry.list()).toHaveLength(2)
  })

  it('rejects duplicates and unknown health updates, and disposes registrations', () => {
    const registry = new CapabilityRegistry()
    const dispose = registry.register(capability('c'))

    expect(() => registry.register(capability('c'))).toThrow('capability already registered: c')
    expect(() => registry.updateHealth('missing', 'healthy', now)).toThrow('unknown capability: missing')

    dispose()

    expect(registry.get('c')).toBeUndefined()
  })
})

describe('ToolRegistry', () => {
  it('resolves an explicitly named tool that exposes the capability', () => {
    const registry = new ToolRegistry()
    const systemd = tool('systemd', ['systemd.restart'])
    registry.register(systemd)

    expect(registry.resolve(actionFor('systemd.restart', 'systemd'))).toBe(systemd)
    expect(() => registry.resolve(actionFor('systemd.restart', 'nm'))).toThrow('unknown tool: nm')
    expect(() => registry.resolve(actionFor('fs.write', 'systemd'))).toThrow('tool systemd does not expose capability fs.write')
  })

  it('resolves an unnamed action only when exactly one tool matches', () => {
    const registry = new ToolRegistry()
    const first = tool('first', ['net.probe'])
    registry.register(first)

    expect(registry.resolve(actionFor('net.probe'))).toBe(first)
    expect(() => registry.resolve(actionFor('fs.read'))).toThrow('no tool exposes capability: fs.read')

    const dispose = registry.register(tool('second', ['net.probe']))

    expect(() => registry.resolve(actionFor('net.probe'))).toThrow('multiple tools expose capability net.probe; action must name a tool')

    dispose()

    expect(registry.resolve(actionFor('net.probe'))).toBe(first)
    expect(() => registry.register(tool('first', []))).toThrow('tool already registered: first')
  })
})

describe('ModelRegistry', () => {
  it('selects providers by feature and disposes registrations', () => {
    const registry = new ModelRegistry()
    const provider = (id: string, vision: boolean): ModelProvider => ({
      id,
      capabilities: { text: true, vision, tools: false, embeddings: false },
      generate: async () => ({ providerId: id, output: '', metadata: {} }),
    })
    const local = provider('local', false)
    registry.register(local)
    const dispose = registry.register(provider('remote', true))

    expect(registry.supporting('text').map(next => next.id)).toEqual(['local', 'remote'])
    expect(registry.supporting('vision').map(next => next.id)).toEqual(['remote'])
    expect(() => registry.register(provider('local', true))).toThrow('model provider already registered: local')

    dispose()

    expect(registry.get('remote')).toBeUndefined()
    expect(registry.get('local')).toBe(local)
  })
})

describe('BeliefGraph', () => {
  it('links only known beliefs and finds edges in both directions', () => {
    const graph = new BeliefGraph()
    graph.upsertBelief(belief('b1'))
    graph.upsertBelief(belief('b2', 'gpu'))
    const edge = { id: 'e1', fromBeliefId: 'b1', toBeliefId: 'b2', relation: 'depends_on' }

    expect(() => {
      graph.link({ ...edge, fromBeliefId: 'missing' })
    }).toThrow('belief edge references an unknown belief')
    expect(() => {
      graph.link({ ...edge, toBeliefId: 'missing' })
    }).toThrow('belief edge references an unknown belief')

    graph.link(edge)

    expect(graph.edgesFor('b1')).toEqual([edge])
    expect(graph.edgesFor('b2')).toEqual([edge])
    expect(graph.edgesFor('b3')).toEqual([])
    expect(graph.findBySubject('gpu').map(next => next.id)).toEqual(['b2'])
  })

  it('marks known beliefs contradicted and rejects unknown ids', () => {
    const graph = new BeliefGraph()
    graph.upsertBelief(belief('b1'))

    const contradicted = graph.markContradicted('b1', '2026-09-24T02:00:00.000Z')

    expect(contradicted).toMatchObject({ state: 'contradicted', updatedAt: '2026-09-24T02:00:00.000Z' })
    expect(graph.getBelief('b1')).toEqual(contradicted)
    expect(() => graph.markContradicted('missing', now)).toThrow('unknown belief: missing')
  })
})

describe('EventBus', () => {
  it('delivers to type subscribers before wildcard subscribers', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe('*', () => {
      seen.push('wildcard')
    })
    bus.subscribe<string>('network.changed', (received) => {
      seen.push(received.payload)
    })

    await bus.publish(event('network.changed'))
    await bus.publish(event('disk.changed'))

    expect(seen).toEqual(['network.changed', 'wildcard', 'wildcard'])
  })

  it('stops delivery at a throwing subscriber', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe('x', () => {
      throw new Error('handler failed')
    })
    bus.subscribe('*', () => {
      seen.push('wildcard')
    })

    await expect(bus.publish(event('x'))).rejects.toThrow('handler failed')
    expect(seen).toEqual([])
  })

  it('keeps a newer subscription when a stale disposer runs again', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    const handler = (): void => {
      seen.push('old')
    }
    const disposeOld = bus.subscribe('x', handler)
    disposeOld()
    bus.subscribe('x', () => {
      seen.push('new')
    })
    disposeOld()

    await bus.publish(event('x'))

    expect(seen).toEqual(['new'])
  })
})

describe('RuntimeSession', () => {
  it('replaces keyed entries, appends results, and snapshots independently', () => {
    const session = new RuntimeSession('s1', 'aris', now)
    const goal = { id: 'g1', description: 'g', priority: 1, createdAt: now, constraints: [], status: 'pending' } as const
    session.addGoal(goal)
    session.addGoal({ ...goal, status: 'active' })
    session.addObservation({ id: 'o1', kind: 'k', subject: 's', summary: 's', observedAt: now, confidence: 1, evidence: [], attributes: {} })
    session.addHypothesis({ id: 'h1', subject: 's', statement: 's', confidence: 0.5, state: 'suspected', evidenceIds: [] })
    session.addPlan({ id: 'p1', goalId: 'g1', createdAt: now, rationale: '', actions: [] })
    session.addResult({ actionId: 'a1', status: 'success', output: null })
    session.addResult({ actionId: 'a1', status: 'success', output: null })
    session.addUncertainty('link state unknown')
    session.addUncertainty('link state unknown')

    const snapshot = session.snapshot()
    session.addUncertainty('later')

    expect(snapshot).toMatchObject({
      sessionId: 's1',
      identityId: 'aris',
      createdAt: now,
      goals: [{ id: 'g1', status: 'active' }],
      observations: [{ id: 'o1' }],
      hypotheses: [{ id: 'h1' }],
      plans: [{ id: 'p1' }],
      uncertainties: ['link state unknown'],
    })
    expect(snapshot.results).toHaveLength(2)
  })
})

describe('MemoryAuditSink', () => {
  const record = (id: string, goalId: string, actionId?: string): AuditRecord => ({
    id,
    type: 't',
    occurredAt: now,
    goalId,
    ...(actionId === undefined ? {} : { actionId }),
    details: {},
  })

  it('evicts the oldest records beyond maxRecords and filters by goal and action', async () => {
    const sink = new MemoryAuditSink({ maxRecords: 2 })
    await sink.append(record('r1', 'g1', 'a1'))
    await sink.append(record('r2', 'g1', 'a2'))
    await sink.append(record('r3', 'g2'))

    expect(sink.snapshot().map(next => next.id)).toEqual(['r2', 'r3'])
    expect(sink.forGoal('g1').map(next => next.id)).toEqual(['r2'])
    expect(sink.forAction('a2').map(next => next.id)).toEqual(['r2'])
  })

  it('retains records under the default limit and rejects invalid limits', async () => {
    const sink = new MemoryAuditSink()
    await sink.append(record('r1', 'g1'))

    expect(sink.snapshot()).toHaveLength(1)
    expect(() => new MemoryAuditSink({ maxRecords: 0 })).toThrow('maxRecords must be a positive safe integer')
    expect(() => new MemoryAuditSink({ maxRecords: 1.5 })).toThrow('maxRecords must be a positive safe integer')
  })
})
