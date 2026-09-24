/** Fail-closed pre-execution simulation. */

import type { Action, Goal, SimulationResult } from '../contracts/types.ts'
import type { SessionSnapshot } from '../runtime/session.ts'
import type { Simulator } from '../ports.ts'

/** Capability-specific effect predictor; returns predicted effect descriptions. */
export type EffectResolver = (
  goal: Goal,
  action: Action,
  session: SessionSnapshot,
  signal?: AbortSignal,
) => Promise<readonly string[]> | readonly string[]

/** {@link ImpactSimulator} options. */
export interface ImpactSimulatorOptions {
  /** Effect resolvers keyed by capability id. */
  readonly resolvers?: Readonly<Record<string, EffectResolver>>
}

/**
 * Fail-closed simulation boundary. Read-only actions are safe by default;
 * mutating actions require an explicit capability-specific effect resolver.
 */
export class ImpactSimulator implements Simulator {
  private readonly resolvers: Readonly<Record<string, EffectResolver>>

  /**
   * @param options - Effect resolvers.
   */
  constructor(options: ImpactSimulatorOptions = {}) {
    this.resolvers = options.resolvers ?? {}
  }

  /**
   * Simulate an action with its capability's resolver.
   *
   * @param goal - Goal the action serves.
   * @param action - Action to simulate.
   * @param session - Current session state.
   * @param signal - Aborts simulation.
   * @returns `safe: true` for resolved or read-only actions; `safe: false` for mutating actions without a resolver.
   */
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
