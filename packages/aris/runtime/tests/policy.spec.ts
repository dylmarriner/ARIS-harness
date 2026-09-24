import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalPolicyEngine, DshApprovalBridge, ImpactSimulator, RuntimeSession } from '../src/index.ts'
import type { Action, ApprovalRequester, Goal, ImpactLevel } from '../src/index.ts'

const now = '2026-09-24T00:00:00.000Z'
const goal: Goal = { id: 'g1', description: 'g', priority: 1, createdAt: now, constraints: [], status: 'active' }
const session = new RuntimeSession('s1', 'aris', now).snapshot()

function action(impact: ImpactLevel, tool?: string): Action {
  return {
    id: 'a1',
    kind: 'k',
    capability: 'nm.reconnect',
    ...(tool === undefined ? {} : { tool }),
    input: {},
    impact,
    requiresVerification: false,
    transactional: false,
  }
}

function approver(outcome: Awaited<ReturnType<ApprovalRequester['request']>>): ApprovalRequester {
  return { request: async () => outcome }
}

describe('ApprovalPolicyEngine', () => {
  it('allows read actions by default', async () => {
    const engine = new ApprovalPolicyEngine({ subjectId: 'aris' })

    await expect(engine.authorize(goal, action('read'), session))
      .resolves.toEqual({ allowed: true, reason: 'read-only action allowed by runtime policy' })
  })

  it('denies ungranted actions without an approval path, including reads when the default is off', async () => {
    const engine = new ApprovalPolicyEngine({ subjectId: 'aris', allowReadByDefault: false })

    await expect(engine.authorize(goal, action('read'), session))
      .resolves.toEqual({ allowed: false, reason: 'no permission grant or approval path for nm.reconnect' })
  })

  it('allows a standing grant scoped to the capability without asking for approval', async () => {
    const hasPermission = vi.fn(async () => true)
    const request = vi.fn(async () => 'rejected' as const)
    const engine = new ApprovalPolicyEngine({ subjectId: 'aris', permissions: { hasPermission }, approval: { request } })

    await expect(engine.authorize(goal, action('privileged'), session))
      .resolves.toEqual({ allowed: true, reason: 'permission grant covers nm.reconnect', scope: 'nm.reconnect' })
    expect(hasPermission).toHaveBeenCalledWith('aris', 'nm.reconnect')
    expect(request).not.toHaveBeenCalled()
  })

  it('scopes one-shot approval to the action when no grant covers it', async () => {
    const engine = new ApprovalPolicyEngine({
      subjectId: 'aris',
      permissions: { hasPermission: async () => false },
      approval: approver('allowed-once'),
    })

    await expect(engine.authorize(goal, action('write'), session)).resolves.toEqual({
      allowed: true,
      reason: 'write action requires one-shot approval for nm.reconnect',
      scope: 'a1',
    })
  })

  it('denies when approval is not granted', async () => {
    const engine = new ApprovalPolicyEngine({ subjectId: 'aris', approval: approver('cancelled') })

    await expect(engine.authorize(goal, action('privileged'), session))
      .resolves.toEqual({ allowed: false, reason: 'approval cancelled for nm.reconnect' })
  })
})

describe('ImpactSimulator', () => {
  it('passes read actions and blocks mutating actions without a resolver', async () => {
    const simulator = new ImpactSimulator()

    await expect(simulator.simulate(goal, action('read'), session)).resolves.toEqual({
      safe: true,
      reason: 'read-only action does not require a mutation simulator',
      predictedEffects: [],
    })
    await expect(simulator.simulate(goal, action('write'), session)).resolves.toEqual({
      safe: false,
      reason: 'no simulator registered for mutating capability nm.reconnect',
      predictedEffects: [],
    })
  })

  it.each([
    ['synchronous', () => ['wlan0 reconnects']],
    ['asynchronous', async () => ['wlan0 reconnects']],
  ])('reports effects from a %s resolver', async (_label, resolver) => {
    const simulator = new ImpactSimulator({ resolvers: { 'nm.reconnect': resolver } })

    await expect(simulator.simulate(goal, action('privileged'), session)).resolves.toEqual({
      safe: true,
      reason: 'capability-specific simulation completed',
      predictedEffects: ['wlan0 reconnects'],
    })
  })

  it('rejects when aborted before or during resolution', async () => {
    const controller = new AbortController()
    const simulator = new ImpactSimulator({
      resolvers: {
        'nm.reconnect': () => {
          controller.abort(new Error('during'))
          return []
        },
      },
    })

    await expect(simulator.simulate(goal, action('write'), session, AbortSignal.abort(new Error('before'))))
      .rejects.toThrow('before')
    await expect(simulator.simulate(goal, action('write'), session, controller.signal)).rejects.toThrow('during')
  })
})

describe('DshApprovalBridge', () => {
  it('asks the Harness approval service about the named tool, or the capability when unnamed', async () => {
    const request = vi.fn(async () => 'allowed-once' as const)
    const agent = {} as Agent
    // The bridge calls only `request`; a partial service suffices for this unit.
    const bridge = new DshApprovalBridge({ request } as unknown as ApprovalService, agent)

    await expect(bridge.request(action('write', 'nmcli'), 'why')).resolves.toBe('allowed-once')
    await bridge.request(action('write'), 'why')

    expect(request.mock.calls).toEqual([
      [{ agent, toolName: 'nmcli', reason: 'why' }],
      [{ agent, toolName: 'nm.reconnect', reason: 'why' }],
    ])
  })
})
