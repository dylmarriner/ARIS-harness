/** Bridge from ARIS policy to the inherited Harness approval service. */

import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { Action } from '../contracts/types.ts'
import type { ApprovalRequester } from './approval-policy.ts'

/** {@link ApprovalRequester} backed by `@deepseek-ai/dsh-user-approval`. */
export class DshApprovalBridge implements ApprovalRequester {
  /**
   * @param approval - Harness approval service.
   * @param agent - Agent the approval prompt is attributed to.
   */
  constructor(
    private readonly approval: ApprovalService,
    private readonly agent: Agent,
  ) {}

  /**
   * Request approval, naming the action's tool or, when unnamed, its capability.
   *
   * @param action - Action awaiting approval.
   * @param reason - Why approval is required.
   * @returns The Harness approval outcome.
   */
  request(action: Action, reason: string): Promise<ApprovalOutcome> {
    return this.approval.request({
      agent: this.agent,
      toolName: action.tool ?? action.capability,
      reason,
    })
  }
}
