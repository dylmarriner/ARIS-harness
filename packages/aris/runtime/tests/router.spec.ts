import { describe, expect, it } from 'vitest'
import {
  CapabilityRegistry,
  MemoryAuditSink,
  modelCapabilityId,
  ModelProviderError,
  ModelRegistry,
  ModelRouter,
  ModelRoutingError,
} from '../src/index.ts'
import type { ModelCapabilities, ModelProvider, ModelProviderHealth, ModelRequest, ModelRequirements } from '../src/index.ts'

const base: ModelCapabilities = { text: true, vision: false, tools: true, structuredOutput: false, embeddings: false, locality: 'local', maxContextTokens: 8_192 }

const request: ModelRequest = {
  requestId: 'req-1',
  traceId: 'trace-1',
  purpose: 'diagnose',
  input: 'why?',
  context: {},
  budget: { maxOutputTokens: 16, timeoutMs: 1_000 },
}

const any: ModelRequirements = { features: ['text'], locality: 'any' }

interface FakeOptions {
  readonly capabilities?: Partial<ModelCapabilities>
  readonly health?: ModelProviderHealth
  readonly fail?: Error
}

function fake(id: string, options: FakeOptions = {}): ModelProvider & { calls: number } {
  const provider = {
    id,
    calls: 0,
    capabilities: { ...base, ...options.capabilities },
    async generate() {
      provider.calls += 1
      if (options.fail !== undefined) throw options.fail
      return { providerId: id, modelId: id, output: `from ${id}`, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, metadata: {} }
    },
    async health() {
      return options.health ?? { available: true, models: [id] }
    },
  }
  return provider
}

function setup(providers: readonly ModelProvider[], preference: readonly string[] = providers.map(provider => provider.id)) {
  const models = new ModelRegistry()
  for (const provider of providers) models.register(provider)
  const capabilities = new CapabilityRegistry()
  const audit = new MemoryAuditSink()
  const router = new ModelRouter({ models, capabilities, audit, preference })
  return { models, capabilities, audit, router }
}

describe('ModelRouter', () => {
  it('records provider health as capabilities and replaces earlier entries', async () => {
    const down = fake('remote', { capabilities: { locality: 'remote' }, health: { available: false, models: [], detail: 'refused' } })
    const { capabilities, router } = setup([fake('native'), down], ['native', 'missing', 'remote'])

    const health = await router.refreshHealth()
    expect([...health]).toEqual([['native', 'healthy'], ['remote', 'unavailable']])
    expect(capabilities.get(modelCapabilityId('native'))).toMatchObject({ kind: 'model', health: 'healthy', tags: ['model', 'local'], metadata: { models: ['native'] } })
    expect(capabilities.get(modelCapabilityId('remote'))).toMatchObject({ health: 'unavailable', tags: ['model', 'remote'], metadata: { models: [], detail: 'refused' } })

    await router.refreshHealth()
    expect(capabilities.list()).toHaveLength(2)
    router.dispose()
    expect(capabilities.list()).toHaveLength(0)
  })

  it('routes to the first healthy provider in preference order and audits the attempt', async () => {
    const native = fake('native')
    const remote = fake('remote')
    const { audit, router } = setup([native, remote], ['remote', 'native'])
    await router.refreshHealth()

    const route = await router.generate(request, any)
    expect(route.response.output).toBe('from remote')
    expect(route.attempts).toMatchObject([{ providerId: 'remote', status: 'success' }])
    expect(native.calls).toBe(0)
    expect(audit.snapshot()).toMatchObject([{ id: 'req-1:remote', type: 'model.attempt', details: { requestId: 'req-1', traceId: 'trace-1', purpose: 'diagnose', status: 'success' } }])
  })

  it('skips providers that are unregistered, unprobed, or fail the requirements', async () => {
    const remote = fake('remote', { capabilities: { locality: 'remote' } })
    const small = fake('small', { capabilities: { vision: true, maxContextTokens: 1_024 } })
    const unsized = fake('unsized', { capabilities: { vision: true } })
    const { maxContextTokens: _omitted, ...withoutContext } = unsized.capabilities
    Object.assign(unsized, { capabilities: withoutContext })
    const blind = fake('blind')
    const unprobed = fake('unprobed')
    const { models, router } = setup([remote, small, unsized, blind], ['missing', 'unprobed', 'remote', 'small', 'unsized', 'blind'])
    await router.refreshHealth()
    models.register(unprobed)

    const rejection = await router.generate(request, { features: ['text', 'vision'], locality: 'local-only', minContextTokens: 4_096 }).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(ModelRoutingError)
    expect((rejection as ModelRoutingError).attempts).toEqual([
      { providerId: 'missing', status: 'skipped', reason: 'not registered' },
      { providerId: 'unprobed', status: 'skipped', reason: 'health unknown' },
      { providerId: 'remote', status: 'skipped', reason: 'remote provider excluded by local-only' },
      { providerId: 'small', status: 'skipped', reason: 'context window below 4096' },
      { providerId: 'unsized', status: 'skipped', reason: 'context window below 4096' },
      { providerId: 'blind', status: 'skipped', reason: 'missing features: vision' },
    ])
    expect(remote.calls + small.calls + unsized.calls + blind.calls + unprobed.calls).toBe(0)
  })

  it('falls back on provider errors, marks health, and audits a failed route', async () => {
    const offline = fake('offline', { fail: new ModelProviderError('offline', 'unavailable', 'refused') })
    const slow = fake('slow', { fail: new ModelProviderError('slow', 'timeout', 'budget timeout elapsed') })
    const good = fake('good')
    const { audit, capabilities, router } = setup([offline, slow, good])
    await router.refreshHealth()

    const route = await router.generate(request, any)
    expect(route.response.providerId).toBe('good')
    expect(route.attempts.map(attempt => [attempt.providerId, attempt.status])).toEqual([['offline', 'failure'], ['slow', 'failure'], ['good', 'success']])
    expect(route.attempts[0]?.reason).toBe('unavailable: offline: refused')
    expect(capabilities.get(modelCapabilityId('offline'))?.health).toBe('unavailable')
    expect(capabilities.get(modelCapabilityId('slow'))?.health).toBe('degraded')

    await expect(router.generate(request, any)).resolves.toMatchObject({ attempts: [{ status: 'skipped' }, { status: 'skipped' }, { status: 'success' }] })

    const lone = setup([fake('bad', { fail: new ModelProviderError('bad', 'rejected', '500') })])
    await lone.router.refreshHealth()
    await expect(lone.router.generate(request, any)).rejects.toThrow('no model provider served request req-1')
    expect(lone.audit.snapshot().map(record => record.type)).toEqual(['model.attempt', 'model.route.failed'])
    expect(audit.snapshot().filter(record => record.type === 'model.attempt')).toHaveLength(4)
  })

  it('rejects without fallback on non-provider errors and caller aborts', async () => {
    const broken = fake('broken', { fail: new TypeError('bug') })
    const next = fake('next')
    const { router } = setup([broken, next])
    await router.refreshHealth()

    await expect(router.generate(request, any)).rejects.toThrow('bug')
    expect(next.calls).toBe(0)
    await expect(router.generate(request, any, AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')
  })
})
