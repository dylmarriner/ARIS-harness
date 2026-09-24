/** Grant-then-approval policy engine. */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { Action, AuthorizationDecision, Goal } from '../contracts/types.ts'
import type { PermissionService, PolicyEngine } from '../ports.ts'
import type { SessionSnapshot } from '../runtime/session.ts'

/** Asks a human for one-shot approval. */
export interface ApprovalRequester {
  /**
   * Request approval for one action.
   *
   * @param action - Action awaiting approval.
   * @param reason - Why approval is required.
   * @returns The approval outcome; only `allowed-once` authorizes.
   */
  request(action: Action, reason: string): Promise<ApprovalOutcome>
}

/** {@link ApprovalPolicyEngine} options. */
export interface ApprovalPolicyOptions {
  /** Identity whose standing grants are checked. */
  readonly subjectId: string
  /** Standing grants; omitted means no grants. */
  readonly permissions?: PermissionService
  /** One-shot approval path; omitted means ungranted actions are denied. */
  readonly approval?: ApprovalRequester
  /** Allow `read` actions without grants or approval. Defaults to `true`. */
  readonly allowReadByDefault?: boolean
}

/**
 * Deterministic ARIS policy layer that reuses the Harness approval vocabulary.
 * Permission grants are checked first; interactive approval is one-shot only.
 */
export class ApprovalPolicyEngine implements PolicyEngine {
  private readonly allowReadByDefault: boolean

  /**
   * @param options - Grant and approval sources.
   */
  constructor(private readonly options: ApprovalPolicyOptions) {
    this.allowReadByDefault = options.allowReadByDefault ?? true
  }

  /**
   * Authorize an action: default read allowance, then standing grant, then one-shot approval.
   *
   * @param _goal - Unused.
   * @param action - Action to authorize.
   * @param _session - Unused.
   * @returns The decision; absent grant and approval deny.
   */
  async authorize(
    _goal: Goal,
    action: Action,
    _session: SessionSnapshot,
  ): Promise<AuthorizationDecision> {
    if (action.impact === 'read' && this.allowReadByDefault) {
      return { allowed: true, reason: 'read-only action allowed by runtime policy' }
    }

    if (this.options.permissions !== undefined) {
      const permitted = await this.options.permissions.hasPermission(
        this.options.subjectId,
        action.capability,
      )
      if (permitted) {
        return {
          allowed: true,
          reason: `permission grant covers ${action.capability}`,
          scope: action.capability,
        }
      }
    }

    const approval = this.options.approval
    if (approval === undefined) {
      return {
        allowed: false,
        reason: `no permission grant or approval path for ${action.capability}`,
      }
    }

    const reason = `${action.impact} action requires one-shot approval for ${action.capability}`
    const outcome = await approval.request(action, reason)
    if (outcome === 'allowed-once') {
      return { allowed: true, reason, scope: action.id }
    }
    return {
      allowed: false,
      reason: `approval ${outcome} for ${action.capability}`,
    }
  }
}
