import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, DISPLAY_NAME, PROVIDER } from '../src/index.js'

// Keep the search-composition editor away from the developer's real profile:
// profile detection scans $DSH_HOME/profiles, so point it at an empty sandbox.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-kimi-test-'))

function fakeContext() {
  const registered = []
  const handled = []
  const searchProviders = []
  let credential
  const attachments = {}
  const ctx = {
    credentials: {
      async resolve() { return credential === undefined ? undefined : { value: credential } },
      async set(_ref, value) { credential = value },
      async unset() { credential = undefined },
    },
    llm: {
      registerAdapter(providers, adapter) {
        registered.push({ providers, adapter })
        return () => {}
      },
    },
    connection: {
      rpc: {
        handle(channel, handler, options) {
          handled.push({ channel, handler, options })
          return () => {}
        },
      },
    },
    web: {
      registerSearchProvider(provider) {
        searchProviders.push(provider)
        return () => {}
      },
      searchProviders: new Map(),
    },
    settings: {
      writable: true,
      register() {
        let value = { searchProvider: 'default' }
        return {
          get: () => value,
          update: async patch => { value = { ...value, ...patch } },
          watch: () => () => {},
        }
      },
    },
    loader: { entries: () => [] },
    attachments,
    get(name) { return name === 'attachments' ? attachments : undefined },
    effect(register) { return register() },
    // The account channel waits for the web server; this host already has one.
    inject(_services, callback) { return callback(ctx) },
  }
  return { ctx, registered, handled, searchProviders }
}

test('plugin registers an isolated Kimi subscription group and loopback auth RPC', async () => {
  const host = fakeContext()
  apply(host.ctx)
  assert.deepEqual(host.registered.map(item => item.providers), [[PROVIDER]])
  const adapter = host.registered[0].adapter
  assert.deepEqual(adapter.providerInfo(PROVIDER), { id: PROVIDER, name: DISPLAY_NAME })
  const retryPolicy = adapter.providerRetryPolicy(PROVIDER)
  assert.equal(retryPolicy.mode, 'normal')
  assert.equal(retryPolicy.maxRetries, 2)
  assert.ok(retryPolicy.retryableCodes.includes('AUTH'))

  assert.equal(host.handled.length, 1)
  assert.equal(host.handled[0].channel, '/kimi-subscription')
  assert.deepEqual(host.handled[0].options, { authority: 'loopback' })
  const status = await host.handled[0].handler('status', {}, new AbortController().signal)
  assert.deepEqual(status, {
    ok: true,
    value: { authenticated: false, provider: PROVIDER },
  })

  assert.deepEqual(host.searchProviders.map(provider => provider.id), [
    'kimi-subscription',
    'kimi-subscription-auto',
  ])
  const preference = await host.handled[0].handler('preferences/status', {}, new AbortController().signal)
  assert.deepEqual(preference, { ok: true, value: { searchProvider: 'default', writable: true, codexDetected: false } })
  const updated = await host.handled[0].handler('preferences/update', { searchProvider: 'auto' }, new AbortController().signal)
  assert.deepEqual(updated, { ok: true, value: { searchProvider: 'auto', writable: true, codexDetected: false } })
  const invalid = await host.handled[0].handler('preferences/update', { searchProvider: 'bogus' }, new AbortController().signal)
  assert.equal(invalid.ok, false)
})

test('plugin activates on DSH 0.1.7 settings, which has no register method', async () => {
  const host = fakeContext()
  let stored = 'default'
  const configured = []
  host.ctx.settings = {
    writable: true,
    configure(presentation, owner) { configured.push({ presentation, owner }) },
    async update(ns, patch) {
      assert.equal(ns, 'kimi-subscription')
      stored = patch.searchProvider
    },
  }
  host.ctx.fiber = { entry: { options: { id: 'kimi-subscription' } } }
  apply(host.ctx, { searchProvider: { get: () => stored } })
  const status = await host.handled[0].handler('status', {}, new AbortController().signal)
  assert.deepEqual(status, { ok: true, value: { authenticated: false, provider: PROVIDER } })
  assert.deepEqual(configured, [{ presentation: { auto: false }, owner: host.ctx.fiber }])
  const preference = await host.handled[0].handler('preferences/status', {}, new AbortController().signal)
  assert.equal(preference.value.searchProvider, 'default')
  const updated = await host.handled[0].handler('preferences/update', { searchProvider: 'kimi' }, new AbortController().signal)
  assert.equal(updated.value.searchProvider, 'kimi')
  assert.equal(stored, 'kimi')
})

const TEST_API_KEY = JSON.stringify({ type: 'api_key', key: 'FAKE_SUBSCRIPTION_KEY_FOR_TESTS' })

// DSH 0.2.1 asks resolveApiKey before listing and shows nothing for
// MISSING_CREDENTIAL; 0.2.0 lists the catalog without asking. Neither fails.
test('an unconnected subscription never fails the model listing', async () => {
  const host = fakeContext()
  apply(host.ctx)
  const models = await host.registered[0].adapter.listModels(PROVIDER)
  assert.ok(models.every(model => model.provider === PROVIDER))
})

test('a connected subscription lists only Kimi models', async () => {
  const host = fakeContext()
  await host.ctx.credentials.set(undefined, TEST_API_KEY)
  apply(host.ctx)
  const models = await host.registered[0].adapter.listModels(PROVIDER)
  assert.ok(models.length > 0)
  assert.ok(models.every(model => model.provider === PROVIDER))
})

// Listing succeeds even when model resolution is incompatible with the host.
// Exercise the same resolution step used by DSH's browser model catalog, plus
// call preparation, without opening a stream or reading any credentials. Since
// DSH 0.2.1 the listing itself checks for a credential, so list while connected.
test('every advertised Kimi model resolves and prepares on the real host adapter', async () => {
  const host = fakeContext()
  await host.ctx.credentials.set(undefined, TEST_API_KEY)
  apply(host.ctx)
  const adapter = host.registered[0].adapter
  const models = await adapter.listModels(PROVIDER)
  assert.ok(models.length > 0)
  host.ctx.credentials.resolve = async () => assert.fail('model metadata must not read credentials')
  for (const model of models) {
    const resolved = await adapter.resolveModel(PROVIDER, model.id)
    assert.equal(resolved.provider, PROVIDER)
    assert.equal(resolved.id, model.id)
    assert.equal(resolved.name, model.name)
    assert.ok(resolved.context.contextWindow > 0)
    const prepared = await adapter.prepareCall(PROVIDER, model.id)
    assert.deepEqual(prepared.model, resolved)
    assert.equal(typeof prepared.stream, 'function')
  }
})

// The adapter hands pi-ai the system prompt and tools beside the messages. If
// the plugin's pi-ai and the adapter's disagree on that context shape, pi-ai
// drops both without an error, and Kimi then answers every turn without tools.
// A desktop install shadowed by a stale local copy ran exactly that pairing.
test('a Kimi request through the host adapter carries the system prompt and tools', async () => {
  const host = fakeContext()
  await host.ctx.credentials.set(undefined, TEST_API_KEY)
  apply(host.ctx)
  const adapter = host.registered[0].adapter
  const tool = {
    name: 'bash',
    description: 'Run a shell command.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  }
  const requests = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'offline test' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const stream = adapter.stream({
      provider: PROVIDER,
      model: 'k3.1-pro',
      system: 'Answer as the offline test agent.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Is the repository up to date?' }] }],
      tools: [tool],
    })
    // The canned 400 ends the stream; only the request that left matters here.
    await (async () => { for await (const _ of stream); })().catch(() => {})
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(requests.length, 1)
  const { url, body } = requests[0]
  assert.ok(url.startsWith('https://api.kimi.com/coding/v1/messages'), url)
  assert.equal(body.model, 'k3.1-pro')
  assert.deepEqual(body.system?.map(block => block.text), ['Answer as the offline test agent.'])
  assert.deepEqual(body.tools?.map(entry => [entry.name, entry.description, entry.input_schema]), [
    [tool.name, tool.description, tool.parameters],
  ])
})

// Kimi rejects a K3.1 request that turns thinking off, so the picker must not
// offer Off; with no effort chosen, Kimi applies the model default (max).
test('the host adapter offers K3.1 Pro with low, high, and max effort only', async () => {
  const host = fakeContext()
  await host.ctx.credentials.set(undefined, TEST_API_KEY)
  apply(host.ctx)
  const adapter = host.registered[0].adapter
  const models = await adapter.listModels(PROVIDER)
  assert.deepEqual(models.slice(0, 2).map(model => [model.id, model.name]), [
    ['k3.1-pro', 'Kimi K3.1 Pro'],
    ['k3.1-pro-highspeed', 'Kimi K3.1 Pro Highspeed'],
  ])
  for (const id of ['k3.1-pro', 'k3.1-pro-highspeed']) {
    const resolved = await adapter.resolveModel(PROVIDER, id)
    assert.equal(resolved.context.contextWindow, 1048576)
    assert.deepEqual(resolved.reasoning.efforts.map(effort => effort.id), ['low', 'high', 'max'])
    assert.equal(resolved.reasoning.defaultEffort, undefined)
  }
})
