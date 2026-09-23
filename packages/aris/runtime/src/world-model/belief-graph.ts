import type { Belief, BeliefEdge } from '../contracts/types.ts'

export class BeliefGraph {
  private readonly beliefs = new Map<string, Belief>()
  private readonly edges = new Map<string, BeliefEdge>()

  upsertBelief(belief: Belief): void {
    this.beliefs.set(belief.id, belief)
  }

  getBelief(id: string): Belief | undefined {
    return this.beliefs.get(id)
  }

  findBySubject(subject: string): readonly Belief[] {
    return [...this.beliefs.values()].filter(belief => belief.subject === subject)
  }

  listBeliefs(): readonly Belief[] {
    return [...this.beliefs.values()]
  }

  link(edge: BeliefEdge): void {
    if (!this.beliefs.has(edge.fromBeliefId) || !this.beliefs.has(edge.toBeliefId)) {
      throw new Error('belief edge references an unknown belief')
    }
    this.edges.set(edge.id, edge)
  }

  edgesFor(beliefId: string): readonly BeliefEdge[] {
    return [...this.edges.values()].filter(
      edge => edge.fromBeliefId === beliefId || edge.toBeliefId === beliefId,
    )
  }

  markContradicted(id: string, updatedAt: string): Belief {
    const current = this.beliefs.get(id)
    if (current === undefined) throw new Error(`unknown belief: ${id}`)
    const next: Belief = {
      ...current,
      state: 'contradicted',
      updatedAt,
    }
    this.beliefs.set(id, next)
    return next
  }
}
