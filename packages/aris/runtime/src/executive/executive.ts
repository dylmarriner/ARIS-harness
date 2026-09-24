/** Deterministic ARIS Executive: the only path from a plan to tool execution. */

import type {
  Action,
  ActionResult,
  AuditRecord,
  Goal,
  Plan,
  VerificationResult,
} from '../contracts/types.ts'
import type {
  AuditSink,
  Planner,
  PolicyEngine,
  Simulator,
  ToolResolver,
  Verifier,
} from '../ports.ts'
import type { RuntimeSession } from '../runtime/session.ts'

/** Port call outcome; `reason` carries the thrown error's message. */
type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

/** Ports the Executive composes. */
export interface ExecutiveDependencies {
  /** Proposes plans. */
  readonly planner: Planner
  /** Authorizes each action before simulation. */
  readonly policy: PolicyEngine
  /** Predicts each authorized action's effects before execution. */
  readonly simulator: Simulator
  /** Resolves each action to exactly one tool. */
  readonly tools: ToolResolver
  /** Checks actions that require verification. */
  readonly verifier: Verifier
  /** Receives every audit record; a failing append aborts the goal. */
  readonly audit: AuditSink
}

/** Outcome of {@link ARISExecutive.executeGoal}. */
export interface GoalExecution {
  /** Goal id. */
  readonly goalId: string
  /** Plan the Executive ran. */
  readonly plan: Plan
  /** Results of the actions that ran, in order; execution stops at the first non-success. */
  readonly results: readonly ActionResult[]
  /** Whether every action succeeded. */
  readonly completed: boolean
}

/**
 * Runs each planned action through policy, simulation, tool resolution,
 * execution, and verification, auditing every transition.
 *
 * No tool runs unless policy allowed and simulation passed. Exceptions from
 * policy, simulation, and verification fail closed as `denied`, `blocked`, and
 * `unverified`. An aborted `signal` and planner or audit failures reject.
 */
export class ARISExecutive {
  /**
   * @param dependencies - Composed ports.
   */
  constructor(private readonly dependencies: ExecutiveDependencies) {}

  /**
   * Plan and execute a goal, recording the goal as `active`, then `completed` or `failed`, in `session`.
   *
   * @param goal - Goal to pursue.
   * @param session - Session that receives goal, plan, and result state.
   * @param signal - Aborts between and within stages.
   * @returns The plan and per-action results.
   */
  async executeGoal(goal: Goal, session: RuntimeSession, signal?: AbortSignal): Promise<GoalExecution> {
    signal?.throwIfAborted()
    session.addGoal({ ...goal, status: 'active' })

    const plan = await this.dependencies.planner.plan(goal, session.snapshot(), signal)
    if (plan.goalId !== goal.id) {
      throw new Error(`planner returned plan for ${plan.goalId}, expected ${goal.id}`)
    }
    session.addPlan(plan)
    await this.audit('goal.plan.created', goal.id, undefined, { planId: plan.id })

    const results: ActionResult[] = []
    for (const action of plan.actions) {
      signal?.throwIfAborted()
      const result = await this.executeAction(goal, action, session, signal)
      session.addResult(result)
      results.push(result)
      if (result.status !== 'success') {
        session.addGoal({ ...goal, status: 'failed' })
        await this.audit('goal.execution.failed', goal.id, action.id, { status: result.status })
        return { goalId: goal.id, plan, results, completed: false }
      }
    }

    session.addGoal({ ...goal, status: 'completed' })
    await this.audit('goal.execution.completed', goal.id, undefined, { actionCount: results.length })
    return { goalId: goal.id, plan, results, completed: true }
  }

  private async executeAction(
    goal: Goal,
    action: Action,
    session: RuntimeSession,
    signal: AbortSignal | undefined,
  ): Promise<ActionResult> {
    const { policy, simulator, tools, verifier } = this.dependencies

    const decision = await this.attempt(signal, () => policy.authorize(goal, action, session.snapshot()))
    if (!decision.ok || !decision.value.allowed) {
      const reason = decision.ok ? decision.value.reason : `policy error: ${decision.reason}`
      await this.audit('action.denied', goal.id, action.id, { reason })
      return { actionId: action.id, status: 'denied', output: null, reason }
    }

    const simulation = await this.attempt(signal, () => simulator.simulate(goal, action, session.snapshot(), signal))
    if (!simulation.ok || !simulation.value.safe) {
      const reason = simulation.ok ? simulation.value.reason : `simulation error: ${simulation.reason}`
      const predictedEffects = simulation.ok ? simulation.value.predictedEffects : []
      await this.audit('action.blocked', goal.id, action.id, { reason, predictedEffects })
      return { actionId: action.id, status: 'blocked', output: null, reason }
    }

    const tool = await this.attempt(signal, () => tools.resolve(action))
    if (!tool.ok) return this.executionFailed(goal, action, tool.reason, null)
    await this.audit('action.execution.started', goal.id, action.id, { toolId: tool.value.id, capability: action.capability })
    const execution = await this.attempt(signal, () => tool.value.execute(action, signal))
    if (!execution.ok) return this.executionFailed(goal, action, execution.reason, null)
    if (execution.value.status === 'failure') {
      return this.executionFailed(goal, action, execution.value.error ?? 'tool reported failure', execution.value.output)
    }

    if (!action.requiresVerification) {
      await this.audit('action.execution.completed', goal.id, action.id, { verified: false })
      return { actionId: action.id, status: 'success', output: execution.value.output }
    }

    const verification = await this.verify(signal, () =>
      verifier.verify(goal, action, execution.value, session.snapshot(), signal))
    if (!verification.ok) {
      await this.audit('action.verification.failed', goal.id, action.id, {
        reason: verification.reason,
        confidence: verification.confidence,
      })
      return { actionId: action.id, status: 'unverified', output: execution.value.output, reason: verification.reason, verification }
    }

    await this.audit('action.execution.completed', goal.id, action.id, { verified: true })
    return { actionId: action.id, status: 'success', output: execution.value.output, verification }
  }

  private async executionFailed(goal: Goal, action: Action, reason: string, output: unknown): Promise<ActionResult> {
    await this.audit('action.execution.failed', goal.id, action.id, { reason })
    return { actionId: action.id, status: 'failure', output, reason }
  }

  private async verify(
    signal: AbortSignal | undefined,
    run: () => Promise<VerificationResult>,
  ): Promise<VerificationResult> {
    const result = await this.attempt(signal, run)
    return result.ok ? result.value : { ok: false, reason: `verification error: ${result.reason}`, confidence: 0 }
  }

  /** Run a port call, converting its failure to a value unless `signal` aborted. */
  private async attempt<T>(
    signal: AbortSignal | undefined,
    run: () => T | Promise<T>,
  ): Promise<Attempt<T>> {
    try {
      return { ok: true, value: await run() }
    } catch (error) {
      signal?.throwIfAborted()
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private async audit(
    type: string,
    goalId: string,
    actionId: string | undefined,
    details: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const record: AuditRecord = {
      id: globalThis.crypto.randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      goalId,
      ...(actionId === undefined ? {} : { actionId }),
      details,
    }
    await this.dependencies.audit.append(record)
  }
}
