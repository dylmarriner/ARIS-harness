/** Model providers keyed by provider id. */

import type { ModelProvider } from '../ports.ts'

/** Model feature flag a provider can be selected by. */
export type ModelFeature = 'text' | 'vision' | 'tools' | 'embeddings'

/** Registry that selects providers by feature, never by brand. */
export class ModelRegistry {
  private readonly providers = new Map<string, ModelProvider>()

  /**
   * Register a provider; duplicate ids throw.
   *
   * @param provider - Provider to add.
   * @returns Disposer that removes this registration.
   */
  register(provider: ModelProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`model provider already registered: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
    return () => {
      this.providers.delete(provider.id)
    }
  }

  /**
   * Look up a provider.
   *
   * @param id - Provider id.
   * @returns The provider, or `undefined`.
   */
  get(id: string): ModelProvider | undefined {
    return this.providers.get(id)
  }

  /**
   * List providers that support a feature.
   *
   * @param feature - Required feature.
   * @returns Providers whose capabilities enable `feature`.
   */
  supporting(feature: ModelFeature): readonly ModelProvider[] {
    return [...this.providers.values()].filter(provider => provider.capabilities[feature])
  }
}
