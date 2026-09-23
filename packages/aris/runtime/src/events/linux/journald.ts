import type { EventPriority, RuntimeEvent } from '../../contracts/types.ts'
import type { RuntimeEventPublisher, RuntimeEventSource } from '../source.ts'
import { runLineProcess } from './line-process.ts'

function priorityFromJournal(value: unknown): EventPriority {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  if (!Number.isFinite(parsed)) return 'normal'
  if (parsed <= 2) return 'critical'
  if (parsed === 3) return 'high'
  if (parsed === 4) return 'normal'
  return 'low'
}

function journalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return new Date().toISOString()
  const micros = Number(value)
  if (!Number.isFinite(micros)) return new Date().toISOString()
  return new Date(micros / 1000).toISOString()
}

export function normalizeJournalEntry(
  entry: Readonly<Record<string, unknown>>,
): RuntimeEvent<Readonly<Record<string, unknown>>> {
  return {
    id: globalThis.crypto.randomUUID(),
    type: 'linux.journal.entry',
    source: typeof entry._SYSTEMD_UNIT === 'string'
      ? `journald:${entry._SYSTEMD_UNIT}`
      : 'journald',
    occurredAt: journalTimestamp(entry.__REALTIME_TIMESTAMP),
    priority: priorityFromJournal(entry.PRIORITY),
    payload: entry,
  }
}

/** Streams the system journal without invoking a model or polling. */
export class JournaldEventSource implements RuntimeEventSource {
  readonly id = 'linux.journald'

  async run(publish: RuntimeEventPublisher, signal?: AbortSignal): Promise<void> {
    await runLineProcess(
      'journalctl',
      ['--follow', '--output=json', '--no-pager', '--lines=0'],
      async (line) => {
        let entry: unknown
        try {
          entry = JSON.parse(line)
        } catch {
          await publish({
            id: globalThis.crypto.randomUUID(),
            type: 'linux.journal.parse-failed',
            source: 'journald',
            occurredAt: new Date().toISOString(),
            priority: 'normal',
            payload: { reason: 'journalctl emitted invalid JSON' },
          })
          return
        }
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return
        await publish(normalizeJournalEntry(entry as Readonly<Record<string, unknown>>))
      },
      signal,
    )
  }
}
