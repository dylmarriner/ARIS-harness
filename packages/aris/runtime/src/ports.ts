/** Replaceable subsystem ports the ARIS Executive composes. */

import type {
  Action,
  AuditRecord,
  AuthorizationDecision,
  Goal,
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
  Plan,
  SimulationResult,
  ToolExecutionResult,
  VerificationResult,
} from './contracts/types.ts'
import type { SessionSnapshot } from './runtime/session.ts'

/** Model backend; proposes output and never holds execution authority. */
export interface ModelProvider {
  /** Registry key; unique within one `ModelRegistry`. */
  readonly id: string
  /** Static feature flags used for capability-based selection. */
  readonly capabilities: ModelCapabilities
  /**
   * Generate one response.
   *
   * @param request - Structured request translated to the provider format at this boundary.
   * @param signal - Aborts the provider call.
   * @returns The provider response.
   */
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>
}

/** Executes actions for the capabilities it advertises. */
export interface Tool {
  /** Registry key; unique within one `ToolRegistry`. */
  readonly id: string
  /** Capability ids this tool can execute. */
  readonly capabilities: readonly string[]
  /**
   * Execute an action the Executive has already authorized and simulated.
   *
   * @param action - Authorized action.
   * @param signal - Aborts execution.
   * @returns Execution outcome; `success` is not verification.
   */
  execute(action: Action, signal?: AbortSignal): Promise<ToolExecutionResult>
}

/** Maps an action to exactly one tool or throws. */
export interface ToolResolver {
  /**
   * Resolve the tool for an action; ambiguous or unknown resolution throws.
   *
   * @param action - Action to resolve.
   * @returns The single tool that executes the action.
   */
  resolve(action: Action): Tool
}

/** Produces a plan for a goal; plans are proposals, not authority. */
export interface Planner {
  /**
   * Plan a goal.
   *
   * @param goal - Goal to plan.
   * @param session - Current session state.
   * @param signal - Aborts planning.
   * @returns A plan whose `goalId` must equal `goal.id`.
   */
  plan(goal: Goal, session: SessionSnapshot, signal?: AbortSignal): Promise<Plan>
}

/** Authorizes an action before simulation and execution. */
export interface PolicyEngine {
  /**
   * Decide whether an action may proceed.
   *
   * @param goal - Goal the action serves.
   * @param action - Proposed action.
   * @param session - Current session state.
   * @returns The decision; `allowed: false` stops the action before any tool.
   */
  authorize(goal: Goal, action: Action, session: SessionSnapshot): Promise<AuthorizationDecision>
}

/** Predicts action effects before execution. */
export interface Simulator {
  /**
   * Simulate an authorized action.
   *
   * @param goal - Goal the action serves.
   * @param action - Authorized action.
   * @param session - Current session state.
   * @param signal - Aborts simulation.
   * @returns The prediction; `safe: false` stops the action before any tool.
   */
  simulate(goal: Goal, action: Action, session: SessionSnapshot, signal?: AbortSignal): Promise<SimulationResult>
}

/** Checks whether an executed action had its intended effect. */
export interface Verifier {
  /**
   * Verify an execution result.
   *
   * @param goal - Goal the action serves.
   * @param action - Executed action.
   * @param result - Tool execution result.
   * @param session - Current session state.
   * @param signal - Aborts verification.
   * @returns The verdict; `ok: false` marks the action `unverified`.
   */
  verify(
    goal: Goal,
    action: Action,
    result: ToolExecutionResult,
    session: SessionSnapshot,
    signal?: AbortSignal,
  ): Promise<VerificationResult>
}

/** Append-only destination for Executive audit records. */
export interface AuditSink {
  /**
   * Append one record.
   *
   * @param record - Record to append.
   */
  append(record: AuditRecord): Promise<void>
}

/** Answers standing permission grants. */
export interface PermissionService {
  /**
   * Check a standing grant.
   *
   * @param subjectId - Identity requesting the capability.
   * @param capability - Capability id.
   * @returns Whether a grant covers the capability.
   */
  hasPermission(subjectId: string, capability: string): Promise<boolean>
}
