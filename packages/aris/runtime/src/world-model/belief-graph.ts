/** In-process operational belief graph. */

import type { Belief, BeliefEdge } from '../contracts/types.ts'

/** Beliefs keyed by id plus directed edges between known beliefs. */
export class BeliefGraph {
  private readonly beliefs = new Map<string, Belief>()
  private readonly edges = new Map<string, BeliefEdge>()

  /**
   * Add or replace a belief.
   *
   * @param belief - Belief to store.
   */
  upsertBelief(belief: Belief): void {
    this.beliefs.set(belief.id, belief)
  }

  /**
   * Look up a belief.
   *
   * @param id - Belief id.
   * @returns The belief, or `undefined`.
   */
  getBelief(id: string): Belief | undefined {
    return this.beliefs.get(id)
  }

  /**
   * Find beliefs about a subject.
   *
   * @param subject - Subject to match exactly.
   * @returns Beliefs whose `subject` equals `subject`.
   */
  findBySubject(subject: string): readonly Belief[] {
    return [...this.beliefs.values()].filter(belief => belief.subject === subject)
  }

  /**
   * Add or replace an edge; both endpoints must already exist.
   *
   * @param edge - Edge to store.
   */
  link(edge: BeliefEdge): void {
    if (!this.beliefs.has(edge.fromBeliefId) || !this.beliefs.has(edge.toBeliefId)) {
      throw new Error('belief edge references an unknown belief')
    }
    this.edges.set(edge.id, edge)
  }

  /**
   * List edges touching a belief in either direction.
   *
   * @param beliefId - Belief id.
   * @returns Edges whose source or target is `beliefId`.
   */
  edgesFor(beliefId: string): readonly BeliefEdge[] {
    return [...this.edges.values()].filter(
      edge => edge.fromBeliefId === beliefId || edge.toBeliefId === beliefId,
    )
  }

  /**
   * Mark a belief contradicted; unknown ids throw.
   *
   * @param id - Belief id.
   * @param updatedAt - When the contradiction was observed.
   * @returns The updated belief.
   */
  markContradicted(id: string, updatedAt: string): Belief {
    const current = this.beliefs.get(id)
    if (current === undefined) throw new Error(`unknown belief: ${id}`)
    const next: Belief = { ...current, state: 'contradicted', updatedAt }
    this.beliefs.set(id, next)
    return next
  }
}
