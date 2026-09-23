import type { RuntimeEvent } from '../contracts/types.ts'

export type RuntimeEventPublisher = (event: RuntimeEvent) => Promise<void> | void

/** Long-lived producer of normalized ARIS runtime events. */
export interface RuntimeEventSource {
  readonly id: string
  run(publish: RuntimeEventPublisher, signal?: AbortSignal): Promise<void>
}
