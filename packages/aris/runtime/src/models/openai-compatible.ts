/**
 * Model provider for OpenAI-compatible chat-completions servers: the
 * ARIS-intelligence llama.cpp server, Ollama, vLLM, LM Studio, and hosted APIs.
 */

import { z } from 'zod'
import type {
  ModelCapabilities,
  ModelMessage,
  ModelProviderHealth,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from '../contracts/types.ts'
import type { ModelProvider } from '../ports.ts'
import { toChatMessages } from './chat-messages.ts'
import { budgetSignal, ModelProviderError, parseStructuredOutput, transportError, unreachableHealth } from './provider-error.ts'

/** JSON Schema name sent with structured-output requests. */
export const RESPONSE_SCHEMA_NAME = 'aris_response'

/** Construction options for {@link OpenAICompatibleModelProvider}. */
export interface OpenAICompatibleProviderOptions {
  /** Registry key. */
  readonly id: string
  /** API root including the version segment, for example `http://127.0.0.1:8080/v1`. */
  readonly baseUrl: string
  /** Backend model id sent as `model` and required in `GET /models` for health. */
  readonly model: string
  /** Features the configured model supports. */
  readonly capabilities: ModelCapabilities
  /** Bearer token for hosted APIs; omitted for local servers. */
  readonly apiKey?: string
  /** When `true`, construction rejects a `baseUrl` whose host is not loopback. */
  readonly requireLoopback: boolean
}

const ToolCallWire = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
})

const ChoiceWire = z.object({
  finish_reason: z.string().nullable().optional(),
  message: z.object({
    content: z.string().nullable().optional(),
    reasoning_content: z.string().nullable().optional(),
    tool_calls: z.array(ToolCallWire).nullable().optional(),
  }),
})

const CompletionWire = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.tuple([ChoiceWire]).rest(ChoiceWire),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
})

const ModelsWire = z.object({ data: z.array(z.object({ id: z.string() })) })

/**
 * Report whether a URL's host is a loopback address.
 *
 * @param url - Absolute URL.
 * @returns `true` for `localhost`, `127.0.0.0/8`, and `::1`.
 */
export function isLoopbackUrl(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase()
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/** Chat-completions provider; one instance serves one backend model. */
export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities
  private readonly baseUrl: string

  /**
   * @param options - Provider configuration; a non-loopback `baseUrl` with `requireLoopback` throws.
   */
  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    if (options.requireLoopback && !isLoopbackUrl(options.baseUrl)) {
      throw new Error(`${options.id}: baseUrl must be loopback when requireLoopback is set`)
    }
    this.id = options.id
    this.capabilities = options.capabilities
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
  }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const started = performance.now()
    const body = await this.post('/chat/completions', this.requestBody(request), budgetSignal(request.budget.timeoutMs, signal), signal)
    const parsed = CompletionWire.safeParse(body)
    if (!parsed.success) throw new ModelProviderError(this.id, 'invalid-response', 'completion does not match the chat-completions format')

    const [choice] = parsed.data.choices
    const output = choice.message.content ?? ''
    const toolCalls = (choice.message.tool_calls ?? []).map(call => this.toolCall(call))
    const reasoning = choice.message.reasoning_content ?? undefined
    return {
      providerId: this.id,
      modelId: parsed.data.model ?? this.options.model,
      output,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(request.responseSchema === undefined || toolCalls.length > 0 ? {} : { structured: parseStructuredOutput(this.id, output) }),
      toolCalls,
      finishReason: choice.finish_reason ?? 'unknown',
      usage: {
        inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      },
      latencyMs: performance.now() - started,
      metadata: parsed.data.id === undefined ? {} : { providerRequestId: parsed.data.id },
    }
  }

  async health(signal?: AbortSignal): Promise<ModelProviderHealth> {
    let body: unknown
    try {
      body = await this.get('/models', signal)
    } catch (error) {
      return unreachableHealth(error, signal)
    }
    const parsed = ModelsWire.safeParse(body)
    if (!parsed.success) return { available: false, models: [], detail: 'model list does not match the /models format' }
    const models = parsed.data.data.map(entry => entry.id)
    return models.includes(this.options.model)
      ? { available: true, models }
      : { available: false, models, detail: `model ${this.options.model} is not served` }
  }

  private requestBody(request: ModelRequest): Record<string, unknown> {
    return {
      model: this.options.model,
      stream: false,
      messages: toChatMessages(request).map(wireMessage),
      max_tokens: request.budget.maxOutputTokens,
      ...(request.budget.temperature === undefined ? {} : { temperature: request.budget.temperature }),
      ...(request.tools === undefined || request.tools.length === 0
        ? {}
        : {
          tools: request.tools.map(tool => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          })),
        }),
      ...(request.responseSchema === undefined
        ? {}
        : { response_format: { type: 'json_schema', json_schema: { name: RESPONSE_SCHEMA_NAME, schema: request.responseSchema } } }),
    }
  }

  private toolCall(call: z.infer<typeof ToolCallWire>): ModelToolCall {
    let args: unknown
    try {
      args = JSON.parse(call.function.arguments) as unknown
    } catch {
      throw new ModelProviderError(this.id, 'invalid-response', `tool call ${call.id} arguments are not valid JSON`)
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new ModelProviderError(this.id, 'invalid-response', `tool call ${call.id} arguments are not an object`)
    }
    return { id: call.id, name: call.function.name, arguments: args as Record<string, unknown> }
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.options.apiKey === undefined ? {} : { authorization: `Bearer ${this.options.apiKey}` }),
    }
  }

  private async get(path: string, signal: AbortSignal | undefined): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers(), ...(signal === undefined ? {} : { signal }) })
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`)
    return await response.json() as unknown
  }

  private async post(path: string, body: unknown, budget: AbortSignal, callerSignal: AbortSignal | undefined): Promise<unknown> {
    let response: Response
    let text: string
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: budget })
      text = await response.text()
    } catch (error) {
      throw transportError(this.id, error, callerSignal, budget)
    }
    if (!response.ok) throw new ModelProviderError(this.id, 'rejected', `POST ${path} returned ${response.status}: ${text.slice(0, 500)}`)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new ModelProviderError(this.id, 'invalid-response', `POST ${path} returned non-JSON`)
    }
  }
}

function wireMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
    ...(message.toolCalls === undefined || message.toolCalls.length === 0
      ? {}
      : {
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      }),
  }
}
