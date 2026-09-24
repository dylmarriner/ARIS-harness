/** Live capability state keyed by capability id. */

import type { Capability, CapabilityHealth } from '../contracts/types.ts'

/** Health-aware registry; unhealthy entries drop out of {@link CapabilityRegistry.findHealthy}. */
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>()

  /**
   * Register a capability; duplicate ids throw.
   *
   * @param capability - Capability to add.
   * @returns Disposer that removes this registration.
   */
  register(capability: Capability): () => void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`capability already registered: ${capability.id}`)
    }
    this.capabilities.set(capability.id, capability)
    return () => {
      this.capabilities.delete(capability.id)
    }
  }

  /**
   * Look up a capability.
   *
   * @param id - Capability id.
   * @returns The current entry, or `undefined`.
   */
  get(id: string): Capability | undefined {
    return this.capabilities.get(id)
  }

  /**
   * List every registered capability regardless of health.
   *
   * @returns Registered capabilities in registration order.
   */
  list(): readonly Capability[] {
    return [...this.capabilities.values()]
  }

  /**
   * Find healthy capabilities by exact id or tag.
   *
   * @param tagOrId - Capability id or tag.
   * @returns Matching capabilities whose health is `healthy`.
   */
  findHealthy(tagOrId: string): readonly Capability[] {
    return this.list().filter(capability =>
      capability.health === 'healthy'
      && (capability.id === tagOrId || capability.tags.includes(tagOrId)))
  }

  /**
   * Replace a capability's health; unknown ids throw.
   *
   * @param id - Capability id.
   * @param health - New health.
   * @param updatedAt - Time of the health observation.
   * @returns The updated entry.
   */
  updateHealth(id: string, health: CapabilityHealth, updatedAt: string): Capability {
    const current = this.capabilities.get(id)
    if (current === undefined) throw new Error(`unknown capability: ${id}`)
    const next: Capability = { ...current, health, updatedAt }
    this.capabilities.set(id, next)
    return next
  }
}
