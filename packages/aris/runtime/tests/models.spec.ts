import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  budgetSignal,
  capabilitiesFromDescriptor,
  isLoopbackUrl,
  ModeldModelProvider,
  ModelProviderError,
  OpenAICompatibleModelProvider,
  parseStructuredOutput,
  RESPONSE_SCHEMA_NAME,
  STATE_CONTEXT_MESSAGE_NAME,
  toChatMessages,
  transportError,
} from '../src/index.ts'
import type { ArisModelDescriptor, ModelCapabilities, ModelRequest } from '../src/index.ts'

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void

interface Captured {
  readonly method: string
  readonly url: string
  readonly headers: IncomingMessage['headers']
  readonly body: unknown
}

const servers: Server[] = []
const directories: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
  }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function serve(handler: Handler, captured: Captured[] = []): Server {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      captured.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: body === '' ? undefined : JSON.parse(body) as unknown })
      handler(request, body, response)
    })
  })
  servers.push(server)
  return server
}

async function listenTcp(handler: Handler, captured?: Captured[]): Promise<string> {
  const server = serve(handler, captured)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}

async function listenSocket(handler: Handler, captured?: Captured[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aris-modeld-'))
  directories.push(directory)
  const socketPath = join(directory, 'modeld.sock')
  const server = serve(handler, captured)
  await new Promise<void>(resolve => server.listen(socketPath, () => { resolve() }))
  return socketPath
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function raw(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status)
  response.end(body)
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: 'req-1',
    traceId: 'trace-1',
    purpose: 'diagnose connectivity',
    input: 'Why is wlan0 down?',
    context: {},
    budget: { maxOutputTokens: 64, timeoutMs: 5_000 },
    ...overrides,
  }
}

const capabilities: ModelCapabilities = {
  text: true,
  vision: false,
  tools: true,
  structuredOutput: true,
  embeddings: false,
  locality: 'local',
  maxContextTokens: 32_768,
}

const descriptor: ArisModelDescriptor = {
  schemaVersion: 'v1',
  id: 'aris-native',
  provider: 'aris-local',
  modelId: 'huihui-qwen3.5-0.8b-abliterated-q8',
  family: 'qwen3.5',
  contextWindow: 262_144,
  modalities: ['text', 'vision'],
  toolCalling: true,
  structuredOutput: true,
  local: true,
  privacyClass: 'local_only',
  costs: { inputPerMillion: 0, outputPerMillion: 0, cachePerMillion: 0 },
  scores: { reasoning: 0.2, coding: 0.1, vision: 0.2, instructionFollowing: 0.3, toolUseReliability: 0.2 },
  runtime: { available: true, averageLatencyMs: 0, timeoutRate: 0, errorRate: 0, successRate: 1, contextUtilization: 0 },
  updatedAt: '2026-09-24T00:00:00.000Z',
}

function openai(baseUrl: string, extra: { readonly apiKey?: string } = {}): OpenAICompatibleModelProvider {
  return new OpenAICompatibleModelProvider({ id: 'llama', baseUrl, model: 'aris-native', capabilities, requireLoopback: true, ...extra })
}

describe('toChatMessages', () => {
  it('orders system, serialized context, history, then input', () => {
    const messages = toChatMessages(request({
      system: 'You are ARIS.',
      context: { network: { wlan0: 'down' } },
      history: [{ role: 'assistant', content: 'checking' }],
    }))
    expect(messages).toEqual([
      { role: 'system', content: 'You are ARIS.' },
      { role: 'user', name: STATE_CONTEXT_MESSAGE_NAME, content: '<ARIS_STATE_CONTEXT>\n{"network":{"wlan0":"down"}}\n</ARIS_STATE_CONTEXT>' },
      { role: 'assistant', content: 'checking' },
      { role: 'user', content: 'Why is wlan0 down?' },
    ])
  })

  it('sends only the input when there is no system text, context, or history', () => {
    expect(toChatMessages(request())).toEqual([{ role: 'user', content: 'Why is wlan0 down?' }])
  })
})

describe('provider error helpers', () => {
  it('rethrows a caller abort instead of classifying it', () => {
    const caller = AbortSignal.abort(new Error('user cancelled'))
    expect(() => transportError('p', new Error('x'), caller, budgetSignal(1_000, caller))).toThrow('user cancelled')
  })

  it('classifies provider errors, elapsed budgets, and transport failures', () => {
    const live = budgetSignal(1_000, undefined)
    const existing = new ModelProviderError('p', 'rejected', 'no')
    expect(transportError('p', existing, undefined, live)).toBe(existing)
    expect(transportError('p', new Error('down'), undefined, AbortSignal.abort()).code).toBe('timeout')
    expect(transportError('p', new Error('down'), undefined, live)).toMatchObject({ code: 'unavailable', message: 'p: down' })
    expect(transportError('p', 'down', undefined, live).message).toBe('p: down')
  })

  it('combines a caller signal with the budget timeout', () => {
    const controller = new AbortController()
    const combined = budgetSignal(60_000, controller.signal)
    controller.abort()
    expect(combined.aborted).toBe(true)
  })

  it('parses structured output or reports invalid JSON', () => {
    expect(parseStructuredOutput('p', '{"ok":true}')).toEqual({ ok: true })
    expect(() => parseStructuredOutput('p', 'nope')).toThrow('structured output is not valid JSON')
  })
})

describe('OpenAICompatibleModelProvider', () => {
  it('classifies loopback hosts', () => {
    expect(isLoopbackUrl('http://localhost:8080/v1')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8080/v1')).toBe(true)
    expect(isLoopbackUrl('https://api.example.com/v1')).toBe(false)
  })

  it('rejects a remote baseUrl only when loopback is required', () => {
    expect(() => openai('https://api.example.com/v1')).toThrow('llama: baseUrl must be loopback when requireLoopback is set')
    const remote = new OpenAICompatibleModelProvider({ id: 'hosted', baseUrl: 'https://api.example.com/v1/', model: 'm', capabilities: { ...capabilities, locality: 'remote' }, requireLoopback: false })
    expect(remote.capabilities.locality).toBe('remote')
  })

  it('translates the request and parses content, reasoning, usage, and structured output', async () => {
    const captured: Captured[] = []
    const baseUrl = await listenTcp((_request, _body, response) => { json(response, 200, {
      id: 'cmpl-1',
      model: 'served-model',
      choices: [{ finish_reason: 'stop', message: { content: '{"cause":"rfkill"}', reasoning_content: 'thinking' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    }) }, captured)

    const response = await openai(baseUrl, { apiKey: 'secret' }).generate(request({
      system: 'sys',
      history: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'nm.status', arguments: { device: 'wlan0' } }] },
        { role: 'tool', content: 'disconnected', toolCallId: 'c1', name: 'nm.status' },
        { role: 'assistant', content: 'noted', toolCalls: [] },
      ],
      tools: [{ name: 'nm.status', description: 'NetworkManager status', inputSchema: { type: 'object' } }],
      responseSchema: { type: 'object' },
      budget: { maxOutputTokens: 32, timeoutMs: 5_000, temperature: 0.2 },
    }))

    expect(response).toMatchObject({
      providerId: 'llama',
      modelId: 'served-model',
      output: '{"cause":"rfkill"}',
      reasoning: 'thinking',
      structured: { cause: 'rfkill' },
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 5 },
      metadata: { providerRequestId: 'cmpl-1' },
    })
    expect(response.latencyMs).toBeGreaterThanOrEqual(0)
    const [call] = captured
    expect(call).toMatchObject({ method: 'POST', url: '/v1/chat/completions' })
    expect(call?.headers.authorization).toBe('Bearer secret')
    expect(call?.body).toEqual({
      model: 'aris-native',
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'nm.status', arguments: '{"device":"wlan0"}' } }] },
        { role: 'tool', content: 'disconnected', name: 'nm.status', tool_call_id: 'c1' },
        { role: 'assistant', content: 'noted' },
        { role: 'user', content: 'Why is wlan0 down?' },
      ],
      max_tokens: 32,
      temperature: 0.2,
      tools: [{ type: 'function', function: { name: 'nm.status', description: 'NetworkManager status', parameters: { type: 'object' } } }],
      response_format: { type: 'json_schema', json_schema: { name: RESPONSE_SCHEMA_NAME, schema: { type: 'object' } } },
    })
  })

  it('parses proposed tool calls and fills defaults for omitted optional fields', async () => {
    const captured: Captured[] = []
    const baseUrl = await listenTcp((_request, _body, response) => { json(response, 200, {
      choices: [{ finish_reason: null, message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'nm.status', arguments: '{"device":"wlan0"}' } }] } }],
    }) }, captured)

    const response = await openai(baseUrl).generate(request({ tools: [], responseSchema: { type: 'object' } }))
    expect(response).toMatchObject({ modelId: 'aris-native', output: '', finishReason: 'unknown', usage: { inputTokens: 0, outputTokens: 0 }, metadata: {} })
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'nm.status', arguments: { device: 'wlan0' } }])
    expect(response).not.toHaveProperty('structured')
    expect(response).not.toHaveProperty('reasoning')
    expect(captured[0]?.headers.authorization).toBeUndefined()
    expect(captured[0]?.body).not.toHaveProperty('tools')
  })

  it.each([
    ['not json', '{"device":'],
    ['not an object', '["wlan0"]'],
    ['null', 'null'],
  ])('rejects tool call arguments that are %s', async (_label, args) => {
    const baseUrl = await listenTcp((_request, _body, response) => { json(response, 200, {
      choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'x', arguments: args } }] } }],
    }) })
    await expect(openai(baseUrl).generate(request())).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('reports rejected, malformed, and non-JSON completions', async () => {
    const rejected = await listenTcp((_request, _body, response) => { raw(response, 503, 'loading model') })
    await expect(openai(rejected).generate(request())).rejects.toMatchObject({ code: 'rejected', message: 'llama: POST /chat/completions returned 503: loading model' })

    const malformed = await listenTcp((_request, _body, response) => { json(response, 200, { choices: [] }) })
    await expect(openai(malformed).generate(request())).rejects.toMatchObject({ code: 'invalid-response' })

    const text = await listenTcp((_request, _body, response) => { raw(response, 200, 'hello') })
    await expect(openai(text).generate(request())).rejects.toMatchObject({ code: 'invalid-response', message: 'llama: POST /chat/completions returned non-JSON' })
  })

  it('reports an unreachable server, an elapsed budget, and a caller abort distinctly', async () => {
    const closed = await listenTcp(() => undefined)
    const server = servers.pop() as Server
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    await expect(openai(closed).generate(request())).rejects.toMatchObject({ code: 'unavailable' })

    const hanging = await listenTcp(() => undefined)
    await expect(openai(hanging).generate(request({ budget: { maxOutputTokens: 8, timeoutMs: 50 } }))).rejects.toMatchObject({ code: 'timeout' })
    await expect(openai(hanging).generate(request(), AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')
  })

  it('reports health from the served model list', async () => {
    const serving = await listenTcp((_request, _body, response) => { json(response, 200, { data: [{ id: 'aris-native' }] }) })
    await expect(openai(serving).health()).resolves.toEqual({ available: true, models: ['aris-native'] })

    const other = await listenTcp((_request, _body, response) => { json(response, 200, { data: [{ id: 'other' }] }) })
    await expect(openai(other).health(new AbortController().signal)).resolves.toEqual({ available: false, models: ['other'], detail: 'model aris-native is not served' })

    const malformed = await listenTcp((_request, _body, response) => { json(response, 200, { models: [] }) })
    await expect(openai(malformed).health()).resolves.toMatchObject({ available: false, detail: 'model list does not match the /models format' })

    const failing = await listenTcp((_request, _body, response) => { raw(response, 500, '') })
    await expect(openai(failing).health()).resolves.toEqual({ available: false, models: [], detail: 'GET /models returned 500' })
  })

  it('rethrows a caller abort from health and reports a non-JSON model list', async () => {
    const serving = await listenTcp((_request, _body, response) => { json(response, 200, { data: [] }) })
    await expect(openai(serving).health(AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')

    const text = await listenTcp((_request, _body, response) => { raw(response, 200, 'not json') })
    await expect(openai(text).health()).resolves.toMatchObject({ available: false, models: [] })
  })
})

describe('ModeldModelProvider', () => {
  it('derives capabilities from the ARIS descriptor', () => {
    expect(capabilitiesFromDescriptor(descriptor)).toEqual({
      text: true,
      vision: true,
      tools: true,
      structuredOutput: true,
      embeddings: false,
      locality: 'local',
      maxContextTokens: 262_144,
    })
  })

  it('requires an absolute socket path', () => {
    expect(() => new ModeldModelProvider({ id: 'modeld', socketPath: 'modeld.sock', descriptor })).toThrow('modeld: socketPath must be absolute')
  })

  it('invokes modeld with the descriptor and modeld message fields', async () => {
    const captured: Captured[] = []
    const socketPath = await listenSocket((_request, _body, response) => { json(response, 200, {
      text: '{"cause":"rfkill"}',
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 4 },
      providerRequestId: 'up-1',
    }) }, captured)
    const provider = new ModeldModelProvider({ id: 'modeld', socketPath, descriptor })

    const response = await provider.generate(request({
      history: [{ role: 'tool', content: 'down', toolCallId: 'c1', name: 'nm.status' }],
      tools: [{ name: 'nm.status', description: 'status', inputSchema: { type: 'object' } }],
      responseSchema: { type: 'object' },
      budget: { maxOutputTokens: 16, timeoutMs: 5_000, temperature: 0 },
    }))

    expect(response).toMatchObject({
      providerId: 'modeld',
      modelId: descriptor.modelId,
      output: '{"cause":"rfkill"}',
      structured: { cause: 'rfkill' },
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 4 },
      metadata: { providerRequestId: 'up-1' },
    })
    expect(captured[0]).toMatchObject({ method: 'POST', url: '/v1/invoke' })
    expect(captured[0]?.body).toEqual({
      model: descriptor,
      messages: [
        { role: 'tool', content: 'down', name: 'nm.status', toolCallId: 'c1' },
        { role: 'user', content: 'Why is wlan0 down?' },
      ],
      tools: [{ name: 'nm.status', description: 'status', inputSchema: { type: 'object' } }],
      responseSchema: { type: 'object' },
      maxOutputTokens: 16,
      temperature: 0,
    })
  })

  it('prefers modeld structured output over parsing text', async () => {
    const socketPath = await listenSocket((_request, _body, response) => { json(response, 200, {
      text: 'ignored',
      structured: { ok: true },
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    }) })
    const provider = new ModeldModelProvider({ id: 'modeld', socketPath, descriptor })
    const structured = await provider.generate(request({ responseSchema: { type: 'object' }, tools: [] }))
    expect(structured.structured).toEqual({ ok: true })
    expect(structured.metadata).toEqual({})

    const plain = await provider.generate(request())
    expect(plain).not.toHaveProperty('structured')
  })

  it('omits structured output when the model proposes tool calls', async () => {
    const socketPath = await listenSocket((_request, _body, response) => { json(response, 200, {
      text: '',
      toolCalls: [{ id: 'c1', name: 'nm.status', arguments: { device: 'wlan0' } }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }) })
    const response = await new ModeldModelProvider({ id: 'modeld', socketPath, descriptor }).generate(request({ responseSchema: { type: 'object' } }))
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'nm.status', arguments: { device: 'wlan0' } }])
    expect(response).not.toHaveProperty('structured')
  })

  it('reports modeld error bodies, malformed results, and non-JSON replies', async () => {
    const denied = await listenSocket((_request, _body, response) => { json(response, 403, { error: 'remote_model_denied', message: 'modeld accepts local models only' }) })
    await expect(new ModeldModelProvider({ id: 'modeld', socketPath: denied, descriptor }).generate(request()))
      .rejects.toMatchObject({ code: 'rejected', message: 'modeld: modeld returned 403 (remote_model_denied: modeld accepts local models only)' })

    const bare = await listenSocket((_request, _body, response) => { json(response, 502, { error: 'upstream_invoke_failed' }) })
    await expect(new ModeldModelProvider({ id: 'modeld', socketPath: bare, descriptor }).generate(request()))
      .rejects.toMatchObject({ message: 'modeld: modeld returned 502 (upstream_invoke_failed)' })

    const unlabelled = await listenSocket((_request, _body, response) => { json(response, 500, []) })
    await expect(new ModeldModelProvider({ id: 'modeld', socketPath: unlabelled, descriptor }).generate(request()))
      .rejects.toMatchObject({ message: 'modeld: modeld returned 500 (no error body)' })

    const malformed = await listenSocket((_request, _body, response) => { json(response, 200, { text: 1 }) })
    await expect(new ModeldModelProvider({ id: 'modeld', socketPath: malformed, descriptor }).generate(request()))
      .rejects.toMatchObject({ code: 'invalid-response' })

    const text = await listenSocket((_request, _body, response) => { raw(response, 200, 'ok') })
    await expect(new ModeldModelProvider({ id: 'modeld', socketPath: text, descriptor }).generate(request()))
      .rejects.toMatchObject({ code: 'invalid-response', message: 'modeld: POST /v1/invoke returned non-JSON' })
  })

  it('reports a missing socket, an elapsed budget, and a caller abort distinctly', async () => {
    const missing = new ModeldModelProvider({ id: 'modeld', socketPath: join(tmpdir(), 'aris-missing-modeld.sock'), descriptor })
    await expect(missing.generate(request())).rejects.toMatchObject({ code: 'unavailable' })

    const socketPath = await listenSocket(() => undefined)
    const hanging = new ModeldModelProvider({ id: 'modeld', socketPath, descriptor })
    await expect(hanging.generate(request({ budget: { maxOutputTokens: 8, timeoutMs: 50 } }))).rejects.toMatchObject({ code: 'timeout' })
    await expect(hanging.generate(request(), AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')
  })

  it('reports health from the upstream and served model list', async () => {
    const health = (upstream: unknown, models: unknown, modelsStatus = 200): Promise<string> => listenSocket((incoming, _body, res) => {
      if (incoming.url === '/v1/health') json(res, 200, { service: 'aris-modeld', provider: 'aris-local', upstream })
      else json(res, modelsStatus, models)
    })
    const provider = (socketPath: string): ModeldModelProvider => new ModeldModelProvider({ id: 'modeld', socketPath, descriptor })

    await expect(provider(await health({ available: true }, { provider: 'aris-local', models: [descriptor.modelId] })).health())
      .resolves.toEqual({ available: true, models: [descriptor.modelId] })
    await expect(provider(await health({ available: true }, { models: ['other'] })).health())
      .resolves.toEqual({ available: false, models: ['other'], detail: `model ${descriptor.modelId} is not served` })
    await expect(provider(await health({ available: false, detail: 'connection refused' }, {})).health())
      .resolves.toEqual({ available: false, models: [], detail: 'connection refused' })
    await expect(provider(await health({ available: false }, {})).health())
      .resolves.toEqual({ available: false, models: [], detail: 'modeld upstream unavailable' })
    await expect(provider(await health({ available: true }, { error: 'upstream_unavailable' }, 502)).health())
      .resolves.toEqual({ available: false, models: [], detail: 'modeld models returned 502' })
    await expect(provider(await health('bad', {})).health())
      .resolves.toEqual({ available: false, models: [], detail: 'modeld health returned 200' })
  })

  it('reports an unreachable socket as unavailable and rethrows a caller abort', async () => {
    const missing = new ModeldModelProvider({ id: 'modeld', socketPath: join(tmpdir(), 'aris-missing-modeld.sock'), descriptor })
    await expect(missing.health()).resolves.toMatchObject({ available: false, models: [] })
    await expect(missing.health(AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')
  })
})
