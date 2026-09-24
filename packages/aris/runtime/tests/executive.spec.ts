import { describe, expect, it, vi } from 'vitest'
import { ARISExecutive, MemoryAuditSink, RuntimeSession, ToolRegistry } from '../src/index.ts'
import type {
  Action,
  AuditSink,
  ExecutiveDependencies,
  Goal,
  Plan,
  Tool,
  ToolExecutionResult,
} from '../src/index.ts'

const now = '2026-09-24T00:00:00.000Z'

const goal: Goal = {
  id: 'goal-1',
  description: 'Recover networking',
  priority: 100,
  createdAt: now,
  constraints: [],
  status: 'pending',
}

function action(id: string, overrides: Partial<Action> = {}): Action {
  return {
    id,
    kind: 'service.restart',
    capability: 'systemd.restart',
    tool: 'systemd',
    input: { service: 'NetworkManager.service' },
    impact: 'privileged',
    requiresVerification: true,
    transactional: false,
    ...overrides,
  }
}

function toolResult(actionId: string, overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return { actionId, status: 'success', output: 'restarted', startedAt: now, finishedAt: now, ...overrides }
}

function harness(
  actions: readonly Action[],
  overrides: Partial<ExecutiveDependencies> = {},
  execute: Tool['execute'] = async next => toolResult(next.id),
) {
  const plan: Plan = { id: 'plan-1', goalId: goal.id, createdAt: now, rationale: 'test', actions }
  const tool = { id: 'systemd', capabilities: ['systemd.restart'], execute: vi.fn(execute) }
  const tools = new ToolRegistry()
  tools.register(tool)
  const audit = new MemoryAuditSink()
  const verify = vi.fn<ExecutiveDependencies['verifier']['verify']>(async () => ({ ok: true, reason: 'verified', confidence: 1 }))
  const executive = new ARISExecutive({
    planner: { plan: async () => plan },
    policy: { authorize: async () => ({ allowed: true, reason: 'allowed' }) },
    simulator: { simulate: async () => ({ safe: true, reason: 'safe', predictedEffects: ['restart'] }) },
    tools,
    verifier: { verify },
    audit,
    ...overrides,
  })
  const session = new RuntimeSession('session-1', 'aris', now)
  return { executive, session, audit, tool, verify, run: (signal?: AbortSignal) => executive.executeGoal(goal, session, signal) }
}

function auditTypes(audit: MemoryAuditSink): readonly string[] {
  return audit.snapshot().map(record => record.type)
}

describe('ARISExecutive', () => {
  it('completes a verified action and records the goal lifecycle', async () => {
    const h = harness([action('a1')])

    const result = await h.run()

    expect(result).toMatchObject({ goalId: 'goal-1', completed: true })
    expect(result.results).toEqual([
      { actionId: 'a1', status: 'success', output: 'restarted', verification: { ok: true, reason: 'verified', confidence: 1 } },
    ])
    expect(auditTypes(h.audit)).toEqual([
      'goal.plan.created',
      'action.execution.started',
      'action.execution.completed',
      'goal.execution.completed',
    ])
    expect(h.audit.forAction('a1').at(-1)?.details).toEqual({ verified: true })
    expect(h.session.snapshot()).toMatchObject({ goals: [{ id: 'goal-1', status: 'completed' }], plans: [{ id: 'plan-1' }] })
  })

  it('succeeds without calling the verifier when verification is not required', async () => {
    const h = harness([action('a1', { requiresVerification: false })])

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'success', output: 'restarted' }])
    expect(h.verify).not.toHaveBeenCalled()
    expect(h.audit.forAction('a1').at(-1)?.details).toEqual({ verified: false })
  })

  it('never reaches a tool when policy denies', async () => {
    const h = harness([action('a1')], { policy: { authorize: async () => ({ allowed: false, reason: 'needs approval' }) } })

    const result = await h.run()

    expect(result.completed).toBe(false)
    expect(result.results).toEqual([{ actionId: 'a1', status: 'denied', output: null, reason: 'needs approval' }])
    expect(h.tool.execute).not.toHaveBeenCalled()
    expect(auditTypes(h.audit)).toEqual(['goal.plan.created', 'action.denied', 'goal.execution.failed'])
    expect(h.session.snapshot().goals).toMatchObject([{ status: 'failed' }])
  })

  it.each([
    ['an Error', new Error('engine offline'), 'policy error: engine offline'],
    ['a non-Error value', 'engine offline', 'policy error: engine offline'],
  ])('denies without reaching a tool when policy throws %s', async (_label, thrown, reason) => {
    const h = harness([action('a1')], { policy: { authorize: async () => { throw thrown } } })

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'denied', output: null, reason }])
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it('blocks without reaching a tool when simulation is unsafe', async () => {
    const h = harness([action('a1')], {
      simulator: { simulate: async () => ({ safe: false, reason: 'drops SSH', predictedEffects: ['sshd down'] }) },
    })

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'blocked', output: null, reason: 'drops SSH' }])
    expect(h.audit.forAction('a1')[0]?.details).toEqual({ reason: 'drops SSH', predictedEffects: ['sshd down'] })
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it('blocks without reaching a tool when simulation throws', async () => {
    const h = harness([action('a1')], { simulator: { simulate: async () => { throw new Error('no snapshot') } } })

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'blocked', output: null, reason: 'simulation error: no snapshot' }])
    expect(h.audit.forAction('a1')[0]?.details).toEqual({ reason: 'simulation error: no snapshot', predictedEffects: [] })
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it('fails closed when tool resolution fails', async () => {
    const h = harness([action('a1', { tool: 'missing' })])

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'failure', output: null, reason: 'unknown tool: missing' }])
    expect(auditTypes(h.audit)).toEqual(['goal.plan.created', 'action.execution.failed', 'goal.execution.failed'])
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['throws', async () => { throw new Error('dbus timeout') }, { output: null, reason: 'dbus timeout' }],
    ['reports failure with an error', async () => toolResult('a1', { status: 'failure', output: 'rc=1', error: 'exit 1' }), { output: 'rc=1', reason: 'exit 1' }],
    ['reports failure without an error', async () => toolResult('a1', { status: 'failure', output: 'rc=1' }), { output: 'rc=1', reason: 'tool reported failure' }],
  ])('records a failure when the tool %s', async (_label, execute, expected) => {
    const h = harness([action('a1')], {}, execute)

    const result = await h.run()

    expect(result.results).toEqual([{ actionId: 'a1', status: 'failure', ...expected }])
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('refuses success when required verification rejects the result', async () => {
    const h = harness([action('a1')], {
      verifier: { verify: async () => ({ ok: false, reason: 'still offline', confidence: 0.9 }) },
    })

    const result = await h.run()

    expect(result.completed).toBe(false)
    expect(result.results).toEqual([{
      actionId: 'a1',
      status: 'unverified',
      output: 'restarted',
      reason: 'still offline',
      verification: { ok: false, reason: 'still offline', confidence: 0.9 },
    }])
    expect(h.audit.forAction('a1').find(record => record.type === 'action.verification.failed')?.details)
      .toEqual({ reason: 'still offline', confidence: 0.9 })
  })

  it('refuses success when the verifier throws', async () => {
    const h = harness([action('a1')], { verifier: { verify: async () => { throw new Error('probe crashed') } } })

    const result = await h.run()

    expect(result.results[0]).toMatchObject({ status: 'unverified', reason: 'verification error: probe crashed' })
  })

  it('stops at the first non-success action', async () => {
    const h = harness([action('a1', { tool: 'missing' }), action('a2')])

    const result = await h.run()

    expect(result.results.map(next => next.actionId)).toEqual(['a1'])
    expect(h.session.snapshot().results).toHaveLength(1)
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it('rejects a plan for another goal', async () => {
    const h = harness([], {
      planner: { plan: async () => ({ id: 'p', goalId: 'other', createdAt: now, rationale: '', actions: [] }) },
    })

    await expect(h.run()).rejects.toThrow('planner returned plan for other, expected goal-1')
  })

  it('rejects instead of denying when aborted during policy', async () => {
    const controller = new AbortController()
    const h = harness([action('a1')], {
      policy: {
        authorize: async () => {
          controller.abort(new Error('shutdown'))
          throw new Error('interrupted')
        },
      },
    })

    await expect(h.run(controller.signal)).rejects.toThrow('shutdown')
    expect(h.tool.execute).not.toHaveBeenCalled()
  })

  it('rejects before planning when already aborted', async () => {
    const h = harness([action('a1')])

    await expect(h.run(AbortSignal.abort(new Error('stopped')))).rejects.toThrow('stopped')
    expect(h.session.snapshot().goals).toEqual([])
  })

  it('never reaches a tool when the execution-start audit fails', async () => {
    const failing: AuditSink = {
      append: async (record) => {
        if (record.type === 'action.execution.started') throw new Error('audit disk full')
      },
    }
    const h = harness([action('a1')], { audit: failing })

    await expect(h.run()).rejects.toThrow('audit disk full')
    expect(h.tool.execute).not.toHaveBeenCalled()
  })
})
