import { describe, expect, it } from 'vitest'
import {
  ARISExecutive,
  BeliefGraph,
  CapabilityRegistry,
  EventBus,
  RuntimeSession,
  ToolRegistry,
} from '../src/index.ts'
import type {
  Action,
  AuditRecord,
  Goal,
  Plan,
  ToolExecutionResult,
} from '../src/index.ts'
import type {
  AuditSink,
  Planner,
  PolicyEngine,
  Simulator,
  Tool,
  Verifier,
} from '../src/index.ts'

const now = '2026-09-23T09:47:00.000Z'

describe('ARIS runtime foundation', () => {
  it('tracks dynamic capability health', () => {
    const registry = new CapabilityRegistry()
    registry.register({
      id: 'ollama.local',
      kind: 'model',
      description: 'Local Ollama runtime',
      health: 'healthy',
      tags: ['text', 'offline'],
      metadata: {},
      updatedAt: now,
    })

    expect(registry.findHealthy('offline')).toHaveLength(1)
    registry.updateHealth('ollama.local', 'unavailable', now)
    expect(registry.findHealthy('offline')).toHaveLength(0)
  })

  it('publishes typed runtime events', async () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe('network.changed', event => {
      seen.push(String(event.payload))
    })

    await bus.publish({
      id: 'evt-1',
      type: 'network.changed',
      source: 'NetworkManager',
      occurredAt: now,
      priority: 'high',
      payload: 'wlan0 disconnected',
    })

    expect(seen).toEqual(['wlan0 disconnected'])
  })

  it('requires known beliefs before linking them', () => {
    const graph = new BeliefGraph()
    graph.upsertBelief({
      id: 'b1',
      subject: 'linnyux',
      predicate: 'has_gpu',
      object: 'RX580',
      state: 'known',
      confidence: 1,
      provenance: [],
      updatedAt: now,
    })

    expect(() => graph.link({
      id: 'e1',
      fromBeliefId: 'b1',
      toBeliefId: 'missing',
      relation: 'depends_on',
    })).toThrow('unknown belief')
  })

  it('keeps authority outside the model and blocks denied actions before tool execution', async () => {
    const action: Action = {
      id: 'action-1',
      kind: 'service.restart',
      capability: 'systemd.restart',
      tool: 'systemd',
      input: { service: 'NetworkManager.service' },
      impact: 'privileged',
      requiresVerification: true,
      transactional: false,
    }
    const goal: Goal = {
      id: 'goal-1',
      description: 'Recover networking',
      priority: 100,
      createdAt: now,
      constraints: [],
      status: 'active',
    }
    const plan: Plan = {
      id: 'plan-1',
      goalId: goal.id,
      createdAt: now,
      rationale: 'Restart networking only if policy allows it.',
      actions: [action],
    }

    let toolRuns = 0
    const tool: Tool = {
      id: 'systemd',
      capabilities: ['systemd.restart'],
      async execute(): Promise<ToolExecutionResult> {
        toolRuns += 1
        return {
          actionId: action.id,
          status: 'success',
          output: 'restarted',
          startedAt: now,
          finishedAt: now,
        }
      },
    }
    const tools = new ToolRegistry()
    tools.register(tool)

    const planner: Planner = {
      async plan() { return plan },
    }
    const policy: PolicyEngine = {
      async authorize() { return { allowed: false, reason: 'requires elevated approval' } },
    }
    const simulator: Simulator = {
      async simulate() { return { safe: true, reason: 'safe', predictedEffects: [] } },
    }
    const verifier: Verifier = {
      async verify() { return { ok: true, reason: 'verified', confidence: 1 } },
    }
    const records: AuditRecord[] = []
    const audit: AuditSink = {
      async append(record) { records.push(record) },
    }

    const executive = new ARISExecutive({
      planner,
      policy,
      simulator,
      tools,
      verifier,
      audit,
    })
    const session = new RuntimeSession('session-1', 'aris', now)
    const result = await executive.executeGoal(goal, session)

    expect(result.completed).toBe(false)
    expect(result.results[0]?.status).toBe('denied')
    expect(toolRuns).toBe(0)
    expect(records.some(record => record.type === 'action.denied')).toBe(true)
  })
})
