/** Bounded in-memory audit sink. */

import type { AuditRecord } from '../contracts/types.ts'
import type { AuditSink } from '../ports.ts'

/** {@link MemoryAuditSink} options. */
export interface MemoryAuditOptions {
  /** Retained record limit; oldest records are evicted first. Defaults to 10,000. */
  readonly maxRecords?: number
}

/**
 * Bounded in-process audit sink for tests, diagnostics, and short-lived runtimes.
 * Durable deployments should compose a persistent AuditSink instead.
 */
export class MemoryAuditSink implements AuditSink {
  private readonly records: AuditRecord[] = []
  private readonly maxRecords: number

  /**
   * @param options - Retention options; `maxRecords` must be a positive safe integer.
   */
  constructor(options: MemoryAuditOptions = {}) {
    this.maxRecords = options.maxRecords ?? 10_000
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new RangeError('maxRecords must be a positive safe integer')
    }
  }

  /**
   * Append a record, evicting the oldest beyond `maxRecords`.
   *
   * @param record - Record to append.
   */
  append(record: AuditRecord): Promise<void> {
    this.records.push(record)
    const overflow = this.records.length - this.maxRecords
    if (overflow > 0) this.records.splice(0, overflow)
    return Promise.resolve()
  }

  /**
   * Copy retained records.
   *
   * @returns Retained records, oldest first.
   */
  snapshot(): readonly AuditRecord[] {
    return [...this.records]
  }

  /**
   * Filter retained records by goal.
   *
   * @param goalId - Goal id.
   * @returns Records whose `goalId` matches.
   */
  forGoal(goalId: string): readonly AuditRecord[] {
    return this.records.filter(record => record.goalId === goalId)
  }

  /**
   * Filter retained records by action.
   *
   * @param actionId - Action id.
   * @returns Records whose `actionId` matches.
   */
  forAction(actionId: string): readonly AuditRecord[] {
    return this.records.filter(record => record.actionId === actionId)
  }
}
