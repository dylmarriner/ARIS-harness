import type { Action, Goal, SimulationResult } from '../contracts/types.ts'
import type { SessionSnapshot } from '../runtime/session.ts'
import type { Simulator } from '../ports.ts'

export type EffectResolver = (
  goal: Goal,
  action: Action,
  session: SessionSnapshot,
  signal?: AbortSignal,
) => Promise<readonly string[]> | readonly string[]

export interface ImpactSimulatorOptions {
  readonly resolvers?: Readonly<Record<string, EffectResolver>>
}

/**
 * Fail-closed simulation boundary. Read-only actions are safe by default;
 * mutating actions require an explicit capability-specific effect resolver.
 */
export class ImpactSimulator implements Simulator {
  private readonly resolvers: Readonly<Record<string, EffectResolver>>

  constructor(options: ImpactSimulatorOptions = {}) {
    this.resolvers = options.resolvers ?? {}
  }

  async simulate(
    goal: Goal,
    action: Action,
    session: SessionSnapshot,
    signal?: AbortSignal,
  ): Promise<SimulationResult> {
    signal?.throwIfAborted()
    const resolver = this.resolvers[action.capability]

    if (resolver === undefined) {
      if (action.impact === 'read') {
        return {
          safe: true,
          reason: 'read-only action does not require a mutation simulator',
          predictedEffects: [],
        }
      }
      return {
        safe: false,
        reason: `no simulator registered for mutating capability ${action.capability}`,
        predictedEffects: [],
      }
    }

    const predictedEffects = await resolver(goal, action, session, signal)
    signal?.throwIfAborted()
    return {
      safe: true,
      reason: 'capability-specific simulation completed',
      predictedEffects,
    }
  }
}
