import type {
  ActionResult,
  Goal,
  Hypothesis,
  Observation,
  Plan,
} from '../contracts/types.ts'

export interface SessionSnapshot {
  readonly sessionId: string
  readonly identityId: string
  readonly createdAt: string
  readonly goals: readonly Goal[]
  readonly observations: readonly Observation[]
  readonly hypotheses: readonly Hypothesis[]
  readonly plans: readonly Plan[]
  readonly results: readonly ActionResult[]
  readonly uncertainties: readonly string[]
}

export class RuntimeSession {
  private readonly goals = new Map<string, Goal>()
  private readonly observations = new Map<string, Observation>()
  private readonly hypotheses = new Map<string, Hypothesis>()
  private readonly plans = new Map<string, Plan>()
  private readonly results: ActionResult[] = []
  private readonly uncertainties = new Set<string>()

  constructor(
    readonly sessionId: string,
    readonly identityId: string,
    readonly createdAt: string,
  ) {}

  addGoal(goal: Goal): void {
    this.goals.set(goal.id, goal)
  }

  addObservation(observation: Observation): void {
    this.observations.set(observation.id, observation)
  }

  addHypothesis(hypothesis: Hypothesis): void {
    this.hypotheses.set(hypothesis.id, hypothesis)
  }

  addPlan(plan: Plan): void {
    this.plans.set(plan.id, plan)
  }

  addResult(result: ActionResult): void {
    this.results.push(result)
  }

  addUncertainty(uncertainty: string): void {
    this.uncertainties.add(uncertainty)
  }

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
