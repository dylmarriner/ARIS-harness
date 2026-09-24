/** In-process working state of one ARIS runtime session. */

import type {
  ActionResult,
  Goal,
  Hypothesis,
  Observation,
  Plan,
} from '../contracts/types.ts'

/** Immutable copy of session state handed to ports. */
export interface SessionSnapshot {
  /** Session id. */
  readonly sessionId: string
  /** Identity the session acts as. */
  readonly identityId: string
  /** When the session started. */
  readonly createdAt: string
  /** Goals, latest version per id. */
  readonly goals: readonly Goal[]
  /** Observations, latest version per id. */
  readonly observations: readonly Observation[]
  /** Hypotheses, latest version per id. */
  readonly hypotheses: readonly Hypothesis[]
  /** Plans, latest version per id. */
  readonly plans: readonly Plan[]
  /** Action results in completion order. */
  readonly results: readonly ActionResult[]
  /** Distinct open uncertainties. */
  readonly uncertainties: readonly string[]
}

/** Mutable session state; keyed collections replace entries with the same id. */
export class RuntimeSession {
  private readonly goals = new Map<string, Goal>()
  private readonly observations = new Map<string, Observation>()
  private readonly hypotheses = new Map<string, Hypothesis>()
  private readonly plans = new Map<string, Plan>()
  private readonly results: ActionResult[] = []
  private readonly uncertainties = new Set<string>()

  /**
   * @param sessionId - Session id.
   * @param identityId - Identity the session acts as.
   * @param createdAt - When the session started.
   */
  constructor(
    readonly sessionId: string,
    readonly identityId: string,
    readonly createdAt: string,
  ) {}

  /**
   * Add or replace a goal.
   *
   * @param goal - Goal to store.
   */
  addGoal(goal: Goal): void {
    this.goals.set(goal.id, goal)
  }

  /**
   * Add or replace an observation.
   *
   * @param observation - Observation to store.
   */
  addObservation(observation: Observation): void {
    this.observations.set(observation.id, observation)
  }

  /**
   * Add or replace a hypothesis.
   *
   * @param hypothesis - Hypothesis to store.
   */
  addHypothesis(hypothesis: Hypothesis): void {
    this.hypotheses.set(hypothesis.id, hypothesis)
  }

  /**
   * Add or replace a plan.
   *
   * @param plan - Plan to store.
   */
  addPlan(plan: Plan): void {
    this.plans.set(plan.id, plan)
  }

  /**
   * Append an action result.
   *
   * @param result - Result to append.
   */
  addResult(result: ActionResult): void {
    this.results.push(result)
  }

  /**
   * Record an open uncertainty; duplicates collapse.
   *
   * @param uncertainty - Uncertainty description.
   */
  addUncertainty(uncertainty: string): void {
    this.uncertainties.add(uncertainty)
  }

  /**
   * Copy current state.
   *
   * @returns A snapshot unaffected by later mutation.
   */
  snapshot(): SessionSnapshot {
    return {
      sessionId: this.sessionId,
      identityId: this.identityId,
      createdAt: this.createdAt,
      goals: [...this.goals.values()],
      observations: [...this.observations.values()],
      hypotheses: [...this.hypotheses.values()],
      plans: [...this.plans.values()],
      results: [...this.results],
      uncertainties: [...this.uncertainties],
    }
  }
}
