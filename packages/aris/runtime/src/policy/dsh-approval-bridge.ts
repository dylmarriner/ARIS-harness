import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { Action } from '../contracts/types.ts'
import type { ApprovalRequester } from './approval-policy.ts'

/** Reuses the inherited Harness approval/audit service inside ARIS policy. */
export class DshApprovalBridge implements ApprovalRequester {
  constructor(
    private readonly approval: ApprovalService,
    private readonly agent: Agent,
  ) {}

  async request(action: Action, reason: string): Promise<ApprovalOutcome> {
    return this.approval.request({
      agent: this.agent,
      toolName: action.tool ?? action.capability,
      reason,
    })
  }
}
