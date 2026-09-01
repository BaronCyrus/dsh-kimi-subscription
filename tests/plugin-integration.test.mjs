import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, DISPLAY_NAME, PROVIDER } from '../src/index.js'

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
  const models = await adapter.listModels(PROVIDER)
  assert.ok(models.length > 0)
  assert.ok(models.every(model => model.provider === PROVIDER))

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
  assert.deepEqual(preference, { ok: true, value: { searchProvider: 'default', writable: true } })
  const updated = await host.handled[0].handler('preferences/update', { searchProvider: 'auto' }, new AbortController().signal)
  assert.deepEqual(updated, { ok: true, value: { searchProvider: 'auto', writable: true } })
  const invalid = await host.handled[0].handler('preferences/update', { searchProvider: 'bogus' }, new AbortController().signal)
  assert.equal(invalid.ok, false)
})
