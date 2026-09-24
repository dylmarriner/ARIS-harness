/**
 * Model provider for ARIS OS `aris-modeld`: HTTP over the daemon's Unix
 * socket, serving local models only.
 */

import { request as httpRequest } from 'node:http'
import { z } from 'zod'
import type { ModelCapabilities, ModelProviderHealth, ModelRequest, ModelResponse } from '../contracts/types.ts'
import type { ModelProvider } from '../ports.ts'
import { toChatMessages } from './chat-messages.ts'
import { budgetSignal, ModelProviderError, parseStructuredOutput, transportError, unreachableHealth } from './provider-error.ts'

/**
 * ARIS `ModelDescriptor` (`@aris/contracts`, schema `v1`) sent with every
 * `POST /v1/invoke`. modeld rejects descriptors that are not `local` or whose
 * `provider` differs from its configured provider.
 */
export interface ArisModelDescriptor {
  /** Contract version. */
  readonly schemaVersion: 'v1'
  /** Registry id of the descriptor. */
  readonly id: string
  /** modeld provider name (`ARIS_MODELD_PROVIDER`). */
  readonly provider: string
  /** Upstream model id. */
  readonly modelId: string
  /** Model family. */
  readonly family: string
  /** Context window in tokens. */
  readonly contextWindow: number
  /** Supported modalities. */
  readonly modalities: readonly ('text' | 'vision' | 'audio' | 'video' | 'embedding' | 'reranking')[]
  /** Tool-call support. */
  readonly toolCalling: boolean
  /** Response-schema support. */
  readonly structuredOutput: boolean
  /** Sampling controls the model honors. */
  readonly sampling?: { readonly temperature: boolean }
  /** Must be `true`; modeld serves local models only. */
  readonly local: true
  /** Privacy class. */
  readonly privacyClass: 'public' | 'sensitive' | 'restricted' | 'local_only'
  /** Per-million-token costs. */
  readonly costs: { readonly inputPerMillion: number; readonly outputPerMillion: number; readonly cachePerMillion: number }
  /** Quality scores in `[0, 1]`. */
  readonly scores: {
    readonly reasoning: number
    readonly coding: number
    readonly vision: number
    readonly instructionFollowing: number
    readonly toolUseReliability: number
  }
  /** Observed runtime statistics. */
  readonly runtime: {
    readonly available: boolean
    readonly averageLatencyMs: number
    readonly timeoutRate: number
    readonly errorRate: number
    readonly successRate: number
    readonly contextUtilization: number
    readonly sampleCount?: number
  }
  /** Descriptor timestamp. */
  readonly updatedAt: string
}

/** Construction options for {@link ModeldModelProvider}. */
export interface ModeldProviderOptions {
  /** Registry key. */
  readonly id: string
  /** Absolute modeld socket path, normally `/run/aris/modeld/modeld.sock`. */
  readonly socketPath: string
  /** Descriptor of the model this provider invokes. */
  readonly descriptor: ArisModelDescriptor
}

const InvocationWire = z.object({
  text: z.string(),
  structured: z.unknown().optional(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) })).optional(),
  finishReason: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  providerRequestId: z.string().optional(),
})

const HealthWire = z.object({ upstream: z.object({ available: z.boolean(), detail: z.string().optional() }) })
const ModelsWire = z.object({ models: z.array(z.string()) })
const ErrorWire = z.object({ error: z.string(), message: z.string().optional() })

interface SocketResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * Derive runtime feature flags from an ARIS model descriptor.
 *
 * @param descriptor - modeld descriptor.
 * @returns Capabilities with `locality: 'local'`.
 */
export function capabilitiesFromDescriptor(descriptor: ArisModelDescriptor): ModelCapabilities {
  return {
    text: descriptor.modalities.includes('text'),
    vision: descriptor.modalities.includes('vision'),
    tools: descriptor.toolCalling,
    structuredOutput: descriptor.structuredOutput,
    embeddings: descriptor.modalities.includes('embedding'),
    locality: 'local',
    maxContextTokens: descriptor.contextWindow,
  }
}

/** modeld provider; one instance invokes one descriptor. */
export class ModeldModelProvider implements ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities

  /**
   * @param options - Provider configuration; a relative `socketPath` throws.
   */
  constructor(private readonly options: ModeldProviderOptions) {
    if (!options.socketPath.startsWith('/')) throw new Error(`${options.id}: socketPath must be absolute`)
    this.id = options.id
    this.capabilities = capabilitiesFromDescriptor(options.descriptor)
  }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const started = performance.now()
    const payload = {
      model: this.options.descriptor,
      // modeld messages carry no assistant tool calls; the call ids survive on `tool` messages.
      messages: toChatMessages(request).map(message => ({
        role: message.role,
        content: message.content,
        ...(message.name === undefined ? {} : { name: message.name }),
        ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
      })),
      ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools }),
      ...(request.responseSchema === undefined ? {} : { responseSchema: request.responseSchema }),
      maxOutputTokens: request.budget.maxOutputTokens,
      ...(request.budget.temperature === undefined ? {} : { temperature: request.budget.temperature }),
    }

    const budget = budgetSignal(request.budget.timeoutMs, signal)
    let response: SocketResponse
    try {
      response = await this.call('POST', '/v1/invoke', budget, payload)
    } catch (error) {
      throw transportError(this.id, error, signal, budget)
    }
    if (response.status !== 200) {
      const failure = ErrorWire.safeParse(response.body)
      const detail = failure.success ? `${failure.data.error}${failure.data.message === undefined ? '' : `: ${failure.data.message}`}` : 'no error body'
      throw new ModelProviderError(this.id, 'rejected', `modeld returned ${response.status} (${detail})`)
    }
    const parsed = InvocationWire.safeParse(response.body)
    if (!parsed.success) throw new ModelProviderError(this.id, 'invalid-response', 'invocation result does not match ModelInvocationResult')

    const toolCalls = parsed.data.toolCalls ?? []
    const structured = request.responseSchema === undefined || toolCalls.length > 0
      ? undefined
      : parsed.data.structured ?? parseStructuredOutput(this.id, parsed.data.text)
    return {
      providerId: this.id,
      modelId: this.options.descriptor.modelId,
      output: parsed.data.text,
      ...(structured === undefined ? {} : { structured }),
      toolCalls,
      finishReason: parsed.data.finishReason,
      usage: parsed.data.usage,
      latencyMs: performance.now() - started,
      metadata: parsed.data.providerRequestId === undefined ? {} : { providerRequestId: parsed.data.providerRequestId },
    }
  }

  async health(signal?: AbortSignal): Promise<ModelProviderHealth> {
    try {
      const health = await this.call('GET', '/v1/health', signal)
      const parsedHealth = HealthWire.safeParse(health.body)
      if (health.status !== 200 || !parsedHealth.success) {
        return { available: false, models: [], detail: `modeld health returned ${health.status}` }
      }
      if (!parsedHealth.data.upstream.available) {
        return { available: false, models: [], detail: parsedHealth.data.upstream.detail ?? 'modeld upstream unavailable' }
      }
      const models = await this.call('GET', '/v1/models', signal)
      const parsedModels = ModelsWire.safeParse(models.body)
      if (models.status !== 200 || !parsedModels.success) {
        return { available: false, models: [], detail: `modeld models returned ${models.status}` }
      }
      const served = parsedModels.data.models
      return served.includes(this.options.descriptor.modelId)
        ? { available: true, models: served }
        : { available: false, models: served, detail: `model ${this.options.descriptor.modelId} is not served` }
    } catch (error) {
      return unreachableHealth(error, signal)
    }
  }

  private call(method: 'GET' | 'POST', path: string, signal: AbortSignal | undefined, body?: unknown): Promise<SocketResponse> {
    return new Promise((resolve, reject) => {
      const encoded = body === undefined ? undefined : JSON.stringify(body)
      const req = httpRequest({
        socketPath: this.options.socketPath,
        method,
        path,
        headers: encoded === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) },
        ...(signal === undefined ? {} : { signal }),
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode as number, body: JSON.parse(text) as unknown })
          } catch {
            reject(new ModelProviderError(this.id, 'invalid-response', `${method} ${path} returned non-JSON`))
          }
        })
      })
      req.on('error', reject)
      req.end(encoded)
    })
  }
}
