import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createKimiAutoSearchProvider,
  createKimiSearchProvider,
  createKimiSearchProviderSwitcher,
  KIMI_AUTO_SEARCH_PROVIDER_ID,
  KIMI_SEARCH_PROVIDER_ID,
  KIMI_SEARCH_URL,
  parseKimiSearchResponse,
  resolveDshSearchProviderId,
} from '../src/kimi-search.js'

const payload = {
  search_results: [
    {
      site_name: 'Example',
      title: '  Example   Title ',
      url: 'https://example.com/a',
      snippet: 'first\nresult',
      date: '2026-08-01T00:00:00Z',
    },
    { title: 'Duplicate', url: 'https://example.com/a', snippet: 'ignored' },
    { title: 'No scheme', url: 'not a url' },
    { url: 'javascript:alert(1)' },
    { url: 'https://example.com/b', content: 'body text' },
  ],
}

test('official search payload is normalized and deduplicated by url', () => {
  assert.deepEqual(parseKimiSearchResponse(payload), {
    sources: [
      {
        url: 'https://example.com/a',
        title: 'Example Title',
        snippet: 'first result',
        publishedAt: '2026-08-01T00:00:00Z',
      },
      { url: 'https://example.com/b', title: 'example.com', snippet: 'body text' },
    ],
    truncated: false,
  })
})

test('malformed search payloads are rejected', () => {
  assert.throws(() => parseKimiSearchResponse(null), /malformed/u)
  assert.throws(() => parseKimiSearchResponse({ results: [] }), /malformed/u)
})

test('search provider posts text_query with host-side bearer auth', async () => {
  let observed
  const provider = createKimiSearchProvider({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    fetchImpl: async (url, init) => {
      observed = { url, init }
      return new Response(JSON.stringify(payload), { status: 200 })
    },
  })
  assert.equal(provider.id, KIMI_SEARCH_PROVIDER_ID)
  assert.equal(provider.available(), true)
  const result = await provider.search({ query: 'kimi code' })
  assert.equal(observed.url, KIMI_SEARCH_URL)
  assert.equal(observed.init.method, 'POST')
  assert.equal(observed.init.redirect, 'error')
  assert.equal(observed.init.headers.Authorization, 'Bearer subscription-secret')
  assert.deepEqual(JSON.parse(observed.init.body), { text_query: 'kimi code' })
  assert.equal(result.sources.length, 2)
})

test('search provider maps auth and transport failures to web error codes', async () => {
  const missing = createKimiSearchProvider({
    getAuth: async () => undefined,
    fetchImpl: async () => new Response('{}'),
  })
  await assert.rejects(missing.search({ query: 'x' }), error => {
    assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    return true
  })
  const unauthorized = createKimiSearchProvider({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    fetchImpl: async () => new Response('nope', { status: 401 }),
  })
  await assert.rejects(unauthorized.search({ query: 'x' }), error => {
    assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    return true
  })
  const broken = createKimiSearchProvider({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    fetchImpl: async () => new Response('nope', { status: 500 }),
  })
  await assert.rejects(broken.search({ query: 'x' }), error => {
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    return true
  })
})

function fakeProvider(id, log) {
  return {
    id,
    available: () => true,
    async search(request) {
      log.push([id, request.query])
      return { sources: [], truncated: false }
    },
  }
}

test('auto provider routes by initiating model provider', async () => {
  const log = []
  const kimi = fakeProvider(KIMI_SEARCH_PROVIDER_ID, log)
  const codex = fakeProvider('codex-subscription-auto', log)
  const dsh = fakeProvider('deepseek-official', log)
  let modelProvider
  const auto = createKimiAutoSearchProvider({
    kimi,
    resolveModelProvider: () => modelProvider,
    resolveCodexProvider: () => codex,
    resolveDshProvider: () => dsh,
  })
  assert.equal(auto.id, KIMI_AUTO_SEARCH_PROVIDER_ID)

  modelProvider = 'kimi-subscription'
  await auto.search({ query: 'a' })
  modelProvider = 'openai-codex'
  await auto.search({ query: 'b' })
  modelProvider = 'deepseek'
  await auto.search({ query: 'c' })
  assert.deepEqual(log, [
    [KIMI_SEARCH_PROVIDER_ID, 'a'],
    ['codex-subscription-auto', 'b'],
    ['deepseek-official', 'c'],
  ])
})

test('auto provider skips an absent codex plugin and refuses self-recursion', async () => {
  const log = []
  const kimi = fakeProvider(KIMI_SEARCH_PROVIDER_ID, log)
  const dsh = fakeProvider('deepseek-official', log)
  const withoutCodex = createKimiAutoSearchProvider({
    kimi,
    resolveModelProvider: () => 'openai-codex',
    resolveCodexProvider: () => undefined,
    resolveDshProvider: () => dsh,
  })
  await withoutCodex.search({ query: 'a' })
  assert.deepEqual(log, [['deepseek-official', 'a']])

  const recursive = createKimiAutoSearchProvider({
    kimi,
    resolveModelProvider: () => 'deepseek',
    resolveCodexProvider: () => undefined,
    resolveDshProvider: () => fakeProvider(KIMI_AUTO_SEARCH_PROVIDER_ID, log),
  })
  await assert.rejects(recursive.search({ query: 'b' }), error => {
    assert.equal(error.code, 'WEB_PROVIDER_UNAVAILABLE')
    return true
  })
})

function fakeLoader(searchProvider) {
  const config = searchProvider === undefined ? {} : { searchProvider }
  const entry = {
    options: { id: 'web', config },
    fiber: {
      config,
      updates: [],
      async update(next) {
        this.updates.push(next)
        this.config = next
      },
    },
  }
  return { entry, loader: { entries: () => [entry] } }
}

test('switcher writes the selected provider and restores the captured one', async () => {
  const { entry, loader } = fakeLoader('deepseek-official')
  const switcher = createKimiSearchProviderSwitcher(loader)

  await switcher.select('default')
  assert.equal(entry.fiber.updates.length, 0)

  await switcher.select('auto')
  assert.deepEqual(entry.fiber.updates, [{ searchProvider: KIMI_AUTO_SEARCH_PROVIDER_ID }])
  assert.equal(entry.fiber.config.searchProvider, KIMI_AUTO_SEARCH_PROVIDER_ID)

  await switcher.select('kimi')
  assert.equal(entry.fiber.config.searchProvider, KIMI_SEARCH_PROVIDER_ID)

  await switcher.select('default')
  assert.equal(entry.fiber.config.searchProvider, 'deepseek-official')
})

test('switcher stays passive when the slot is not ours and none was captured', async () => {
  const { entry, loader } = fakeLoader('codex-subscription-auto')
  const switcher = createKimiSearchProviderSwitcher(loader)
  await switcher.select('default')
  assert.equal(entry.fiber.config.searchProvider, 'codex-subscription-auto')
  assert.equal(entry.fiber.updates.length, 0)
})

test('switcher never contests the slot while another subscription plugin manages it', async () => {
  const { entry, loader } = fakeLoader('codex-subscription-auto')
  const warnings = []
  const switcher = createKimiSearchProviderSwitcher(loader, {
    isForeignManaged: () => true,
    logger: { warn: (...args) => warnings.push(args) },
  })
  await switcher.select('auto')
  await switcher.select('kimi')
  await switcher.select('default')
  assert.equal(entry.fiber.config.searchProvider, 'codex-subscription-auto')
  assert.equal(entry.fiber.updates.length, 0)
  assert.equal(warnings.length, 1)
})

test('dsh fallback resolution avoids self-delegation', () => {
  assert.equal(resolveDshSearchProviderId('deepseek-official'), 'deepseek-official')
  assert.equal(resolveDshSearchProviderId(KIMI_SEARCH_PROVIDER_ID), 'deepseek-official')
  assert.equal(resolveDshSearchProviderId(KIMI_AUTO_SEARCH_PROVIDER_ID), 'deepseek-official')
})
