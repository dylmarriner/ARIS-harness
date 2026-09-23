import type { ModelProvider } from '../ports.ts'

export class ModelRegistry {
  private readonly providers = new Map<string, ModelProvider>()

  register(provider: ModelProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`model provider already registered: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id)
  }

  list(): readonly ModelProvider[] {
    return [...this.providers.values()]
  }

  supporting(capability: 'text' | 'vision' | 'tools' | 'embeddings'): readonly ModelProvider[] {
    return this.list().filter(provider => provider.capabilities[capability])
  }
}
