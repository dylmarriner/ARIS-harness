import type {
  Action,
  ActionResult,
  AuditRecord,
  Goal,
  Plan,
  ToolExecutionResult,
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
import { RuntimeSession } from '../runtime/session.ts'

export interface ExecutiveDependencies {
  readonly planner: Planner
  readonly policy: PolicyEngine
  readonly simulator: Simulator
  readonly tools: ToolResolver
  readonly verifier: Verifier
  readonly audit: AuditSink
}

export interface GoalExecution {
  readonly goalId: string
  readonly plan: Plan
  readonly results: readonly ActionResult[]
  readonly completed: boolean
}

export class ARISExecutive {
  constructor(private readonly dependencies: ExecutiveDependencies) {}

  async executeGoal(
    goal: Goal,
    session: RuntimeSession,
    signal?: AbortSignal,
  ): Promise<GoalExecution> {
    signal?.throwIfAborted()
    session.addGoal(goal)

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
        return { goalId: goal.id, plan, results, completed: false }
      }
    }

    await this.audit('goal.execution.completed', goal.id, undefined, {
      actionCount: results.length,
    })
    return { goalId: goal.id, plan, results, completed: true }
  }

  private async executeAction(
    goal: Goal,
    action: Action,
    session: RuntimeSession,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    const decision = await this.dependencies.policy.authorize(
      goal,
      action,
      session.snapshot(),
    )
    if (!decision.allowed) {
      await this.audit('action.denied', goal.id, action.id, { reason: decision.reason })
      return {
        actionId: action.id,
        status: 'denied',
        output: null,
        reason: decision.reason,
      }
    }

    const simulation = await this.dependencies.simulator.simulate(
      goal,
      action,
      session.snapshot(),
      signal,
    )
    if (!simulation.safe) {
      await this.audit('action.blocked', goal.id, action.id, {
        reason: simulation.reason,
        predictedEffects: simulation.predictedEffects,
      })
      return {
        actionId: action.id,
        status: 'blocked',
        output: null,
        reason: simulation.reason,
      }
    }

    let execution: ToolExecutionResult
    try {
      const tool = this.dependencies.tools.resolve(action)
      await this.audit('action.execution.started', goal.id, action.id, {
        toolId: tool.id,
        capability: action.capability,
      })
      execution = await tool.execute(action, signal)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.audit('action.execution.failed', goal.id, action.id, { reason })
      return {
        actionId: action.id,
        status: 'failure',
        output: null,
        reason,
      }
    }

    if (execution.status === 'failure') {
      const reason = execution.error ?? 'tool reported failure'
      await this.audit('action.execution.failed', goal.id, action.id, { reason })
      return {
        actionId: action.id,
        status: 'failure',
        output: execution.output,
        reason,
      }
    }

    let verification: VerificationResult | undefined
    if (action.requiresVerification) {
      verification = await this.dependencies.verifier.verify(
        goal,
        action,
        execution,
        session.snapshot(),
        signal,
      )
      if (!verification.ok) {
        await this.audit('action.verification.failed', goal.id, action.id, {
          reason: verification.reason,
          confidence: verification.confidence,
        })
        return {
          actionId: action.id,
          status: 'unverified',
          output: execution.output,
          reason: verification.reason,
          verification,
        }
      }
    }

    await this.audit('action.execution.completed', goal.id, action.id, {
      verified: verification?.ok ?? false,
    })

    return {
      actionId: action.id,
      status: 'success',
      output: execution.output,
      ...(verification === undefined ? {} : { verification }),
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
