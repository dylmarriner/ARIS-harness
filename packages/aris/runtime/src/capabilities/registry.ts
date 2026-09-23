import type { Capability, CapabilityHealth } from '../contracts/types.ts'

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>()

  register(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`capability already registered: ${capability.id}`)
    }
    this.capabilities.set(capability.id, capability)
  }

  upsert(capability: Capability): void {
    this.capabilities.set(capability.id, capability)
  }

  remove(id: string): boolean {
    return this.capabilities.delete(id)
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id)
  }

  list(): readonly Capability[] {
    return [...this.capabilities.values()]
  }

  findHealthy(tagOrId: string): readonly Capability[] {
    return this.list().filter(capability =>
      capability.health === 'healthy'
      && (capability.id === tagOrId || capability.tags.includes(tagOrId)))
  }

  updateHealth(id: string, health: CapabilityHealth, updatedAt: string): Capability {
    const current = this.capabilities.get(id)
    if (current === undefined) throw new Error(`unknown capability: ${id}`)
    const next: Capability = { ...current, health, updatedAt }
    this.capabilities.set(id, next)
    return next
  }
}
