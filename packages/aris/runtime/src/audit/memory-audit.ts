import type { AuditRecord } from '../contracts/types.ts'
import type { AuditSink } from '../ports.ts'

export interface MemoryAuditOptions {
  readonly maxRecords?: number
}

/**
 * Bounded in-process audit sink for tests, diagnostics, and short-lived runtimes.
 * Durable deployments should compose a persistent AuditSink instead.
 */
export class MemoryAuditSink implements AuditSink {
  private readonly records: AuditRecord[] = []
  private readonly maxRecords: number

  constructor(options: MemoryAuditOptions = {}) {
    this.maxRecords = options.maxRecords ?? 10_000
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new RangeError('maxRecords must be a positive safe integer')
    }
  }

  append(record: AuditRecord): Promise<void> {
    this.records.push(record)
    const overflow = this.records.length - this.maxRecords
    if (overflow > 0) this.records.splice(0, overflow)
    return Promise.resolve()
  }

  snapshot(): readonly AuditRecord[] {
    return [...this.records]
  }

  forGoal(goalId: string): readonly AuditRecord[] {
    return this.records.filter(record => record.goalId === goalId)
  }

  forAction(actionId: string): readonly AuditRecord[] {
    return this.records.filter(record => record.actionId === actionId)
  }
}
