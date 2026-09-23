import type { RuntimeEvent } from '../../contracts/types.ts'
import type { RuntimeEventPublisher, RuntimeEventSource } from '../source.ts'
import { runLineProcess } from './line-process.ts'

export function normalizeNetworkManagerLine(line: string): RuntimeEvent<{ readonly message: string }> {
  const normalized = line.toLowerCase()
  const priority = normalized.includes('failed')
    || normalized.includes('disconnected')
    || normalized.includes('unavailable')
    ? 'high'
    : 'normal'

  return {
    id: globalThis.crypto.randomUUID(),
    type: 'linux.network-manager.change',
    source: 'network-manager',
    occurredAt: new Date().toISOString(),
    priority,
    payload: { message: line },
  }
}

/** Streams NetworkManager state changes through nmcli's native monitor mode. */
export class NetworkManagerEventSource implements RuntimeEventSource {
  readonly id = 'linux.network-manager'

  async run(publish: RuntimeEventPublisher, signal?: AbortSignal): Promise<void> {
    await runLineProcess(
      'nmcli',
      ['monitor'],
      async (line) => publish(normalizeNetworkManagerLine(line)),
      signal,
    )
  }
}
