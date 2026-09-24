/** Health-aware model routing by required capability, with audited fallback. */

import type { CapabilityHealth, ModelRequest, ModelResponse } from '../contracts/types.ts'
import type { CapabilityRegistry } from '../capabilities/registry.ts'
import type { ModelFeature, ModelRegistry } from '../models/registry.ts'
import { ModelProviderError } from '../models/provider-error.ts'
import type { AuditSink, ModelProvider } from '../ports.ts'

/** What a request needs from a model; never a brand. */
export interface ModelRequirements {
  /** Features every candidate must support. */
  readonly features: readonly ModelFeature[]
  /** `local-only` excludes providers whose locality is `remote`. */
  readonly locality: 'local-only' | 'any'
  /** Minimum context window; providers that do not report one are excluded when set. */
  readonly minContextTokens?: number
}

/** One provider considered for a request. */
export interface ModelAttempt {
  /** Provider id. */
  readonly providerId: string
  /** `skipped` providers were not called. */
  readonly status: 'success' | 'failure' | 'skipped'
  /** Why the provider was skipped or failed. */
  readonly reason?: string
  /** Call duration for called providers. */
  readonly latencyMs?: number
}

/** Successful routing outcome. */
export interface ModelRoute {
  /** Response of the first provider that succeeded. */
  readonly response: ModelResponse
  /** Every provider considered, in routing order. */
  readonly attempts: readonly ModelAttempt[]
}

/** No provider produced a response. */
export class ModelRoutingError extends Error {
  /**
   * @param requestId - Request that could not be routed.
   * @param attempts - Every provider considered.
   */
  constructor(readonly requestId: string, readonly attempts: readonly ModelAttempt[]) {
    super(`no model provider served request ${requestId}`)
    this.name = 'ModelRoutingError'
  }
}

/** Construction options for {@link ModelRouter}. */
export interface ModelRouterOptions {
  /** Providers to route among. */
  readonly models: ModelRegistry
  /** Receives one `model:<providerId>` capability per routed provider. */
  readonly capabilities: CapabilityRegistry
  /** Receives `model.attempt` and `model.route.failed` records. */
  readonly audit: AuditSink
  /** Provider ids in routing order; a provider absent from this list is never routed. */
  readonly preference: readonly string[]
}

/**
 * Capability id under which the router tracks a provider's health.
 *
 * @param providerId - Provider id.
 * @returns The capability id.
 */
export function modelCapabilityId(providerId: string): string {
  return `model:${providerId}`
}

/**
 * Routes model requests to the first healthy provider that satisfies the
 * requirements, falling back on {@link ModelProviderError}.
 *
 * Only providers whose capability entry is `healthy` are called, so
 * {@link ModelRouter.refreshHealth} must run before the first request. A call
 * that fails as `unavailable` marks the provider `unavailable`; any other
 * provider error marks it `degraded`. A caller abort and non-provider
 * exceptions reject without fallback. The router selects providers; it never
 * executes tool calls a model proposes.
 */
export class ModelRouter {
  private readonly registrations = new Map<string, () => void>()

  /**
   * @param options - Router configuration.
   */
  constructor(private readonly options: ModelRouterOptions) {}

  /**
   * Probe every preferred registered provider and record its health.
   *
   * @param signal - Aborts the probes.
   * @returns Health per probed provider id.
   */
  async refreshHealth(signal?: AbortSignal): Promise<ReadonlyMap<string, CapabilityHealth>> {
    const results = new Map<string, CapabilityHealth>()
    for (const providerId of this.options.preference) {
      const provider = this.options.models.get(providerId)
      if (provider === undefined) continue
      const health = await provider.health(signal)
      const state: CapabilityHealth = health.available ? 'healthy' : 'unavailable'
      this.record(provider, state, { models: health.models, ...(health.detail === undefined ? {} : { detail: health.detail }) })
      results.set(providerId, state)
    }
    return results
  }

  /**
   * Generate with the first provider that succeeds.
   *
   * @param request - Structured request.
   * @param requirements - Required model features.
   * @param signal - Aborts routing and the in-flight call.
   * @returns The response and every attempt; rejects with {@link ModelRoutingError} when no provider succeeds.
   */
  async generate(request: ModelRequest, requirements: ModelRequirements, signal?: AbortSignal): Promise<ModelRoute> {
    const attempts: ModelAttempt[] = []
    for (const providerId of this.options.preference) {
      signal?.throwIfAborted()
      const skip = this.skipReason(providerId, requirements)
      if (skip !== undefined) {
        attempts.push({ providerId, status: 'skipped', reason: skip })
        continue
      }
      const provider = this.options.models.get(providerId) as ModelProvider
      const started = performance.now()
      try {
        const response = await provider.generate(request, signal)
        const attempt: ModelAttempt = { providerId, status: 'success', latencyMs: performance.now() - started }
        attempts.push(attempt)
        await this.auditAttempt(request, attempt)
        return { response, attempts }
      } catch (error) {
        if (!(error instanceof ModelProviderError)) throw error
        const attempt: ModelAttempt = { providerId, status: 'failure', reason: `${error.code}: ${error.message}`, latencyMs: performance.now() - started }
        attempts.push(attempt)
        this.record(provider, error.code === 'unavailable' ? 'unavailable' : 'degraded', { detail: error.message })
        await this.auditAttempt(request, attempt)
      }
    }
    await this.options.audit.append({
      id: `${request.requestId}:route-failed`,
      type: 'model.route.failed',
      occurredAt: new Date().toISOString(),
      details: { requestId: request.requestId, traceId: request.traceId, purpose: request.purpose, attempts },
    })
    throw new ModelRoutingError(request.requestId, attempts)
  }

  private skipReason(providerId: string, requirements: ModelRequirements): string | undefined {
    const provider = this.options.models.get(providerId)
    if (provider === undefined) return 'not registered'
    const health = this.options.capabilities.get(modelCapabilityId(providerId))?.health ?? 'unknown'
    if (health !== 'healthy') return `health ${health}`
    const { capabilities } = provider
    if (requirements.locality === 'local-only' && capabilities.locality !== 'local') return 'remote provider excluded by local-only'
    const missing = requirements.features.filter(feature => !capabilities[feature])
    if (missing.length > 0) return `missing features: ${missing.join(', ')}`
    if (requirements.minContextTokens !== undefined && (capabilities.maxContextTokens ?? 0) < requirements.minContextTokens) {
      return `context window below ${requirements.minContextTokens}`
    }
    return undefined
  }

  private record(provider: ModelProvider, health: CapabilityHealth, metadata: Readonly<Record<string, unknown>>): void {
    const id = modelCapabilityId(provider.id)
    const updatedAt = new Date().toISOString()
    this.registrations.get(id)?.()
    this.registrations.set(id, this.options.capabilities.register({
      id,
      kind: 'model',
      description: `model provider ${provider.id}`,
      health,
      tags: ['model', provider.capabilities.locality],
      metadata,
      updatedAt,
    }))
  }

  /** Remove every capability entry this router registered. */
  dispose(): void {
    for (const dispose of this.registrations.values()) dispose()
    this.registrations.clear()
  }

  private async auditAttempt(request: ModelRequest, attempt: ModelAttempt): Promise<void> {
    await this.options.audit.append({
      id: `${request.requestId}:${attempt.providerId}`,
      type: 'model.attempt',
      occurredAt: new Date().toISOString(),
      details: { requestId: request.requestId, traceId: request.traceId, purpose: request.purpose, ...attempt },
    })
  }
}
