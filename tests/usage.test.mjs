import assert from 'node:assert/strict'
import test from 'node:test'

import { createKimiUsageReader, KIMI_USAGE_URL, parseKimiUsage } from '../src/usage.js'

const payload = {
  usage: { used: '400', limit: '1000', resetTime: '2026-08-03T05:20:51Z' },
  limits: [
    {
      name: 'Rate limit',
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: { used: '25', limit: '100', resetTime: '2026-07-27T10:00:00Z' },
    },
  ],
  boosterWallet: {
    balance: { type: 'BOOSTER', amount: '100000000', amountLeft: '45000000' },
    monthlyChargeLimitEnabled: true,
    monthlyChargeLimit: { priceInCents: '2000', currency: 'CNY' },
    monthlyUsed: { priceInCents: '600', currency: 'CNY' },
  },
}

test('official usages payload is normalized with remaining quota and reset windows', () => {
  const parsed = parseKimiUsage(payload)
  assert.deepEqual(parsed.summary, {
    window: { duration: 1, unit: 'week' },
    used: 400,
    limit: 1000,
    remaining: 600,
    remainingPercent: 60,
    resetAt: '2026-08-03T05:20:51Z',
  })
  assert.deepEqual(parsed.limits, [{
    name: 'Rate limit',
    window: { duration: 5, unit: 'hour' },
    used: 25,
    limit: 100,
    remaining: 75,
    remainingPercent: 75,
    resetAt: '2026-07-27T10:00:00Z',
  }])
  assert.deepEqual(parsed.extraUsage, {
    balanceCents: 45,
    totalCents: 100,
    monthlyChargeLimitEnabled: true,
    monthlyChargeLimitCents: 2000,
    monthlyUsedCents: 600,
    currency: 'CNY',
  })
})

test('usage reader sends host-only bearer auth and caches the official endpoint', async () => {
  let requests = 0
  let observed
  let clock = 1000
  const reader = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    now: () => clock,
    fetchImpl: async (url, init) => {
      requests += 1
      observed = { url, authorization: init.headers.Authorization }
      return { ok: true, status: 200, async json() { return payload } }
    },
  })
  const first = await reader.read()
  const second = await reader.read()
  assert.equal(requests, 1)
  assert.deepEqual(observed, { url: KIMI_USAGE_URL, authorization: 'Bearer subscription-secret' })
  assert.deepEqual(second, first)
  assert.equal(first.fetchedAt, 1000)
  clock += 61_000
  await reader.read()
  assert.equal(requests, 2)
})

test('OAuth Authorization headers are accepted and auth failures are sanitized', async () => {
  let authorization
  const oauthReader = createKimiUsageReader({
    getAuth: async () => ({ auth: { headers: { authorization: 'Bearer oauth-secret' } } }),
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization
      return { ok: true, status: 200, async json() { return {} } }
    },
  })
  await oauthReader.read()
  assert.equal(authorization, 'Bearer oauth-secret')

  const failed = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'secret-never-echo' } }),
    fetchImpl: async () => ({ ok: false, status: 401 }),
  })
  await assert.rejects(
    () => failed.read(),
    error => error.message === 'Kimi Code subscription sign-in needs to be renewed'
      && !error.message.includes('secret-never-echo'),
  )
})

test('cancelled callers do not abort or evict a shared usage request', async () => {
  let requests = 0
  let sharedSignal
  let markStarted
  let releaseRequest
  const started = new Promise(resolve => { markStarted = resolve })
  const released = new Promise(resolve => { releaseRequest = resolve })
  const reader = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    fetchImpl: async (_url, init) => {
      requests += 1
      sharedSignal = init.signal
      markStarted()
      await released
      init.signal.throwIfAborted()
      return { ok: true, status: 200, async json() { return payload } }
    },
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const firstReason = new DOMException('first caller left the page', 'AbortError')
  const secondReason = new DOMException('second caller left the page', 'AbortError')
  const first = assert.rejects(
    reader.read({ signal: firstController.signal }),
    error => error === firstReason,
  )
  await started
  const second = assert.rejects(
    reader.read({ signal: secondController.signal }),
    error => error === secondReason,
  )
  firstController.abort(firstReason)
  await first
  assert.equal(sharedSignal.aborted, false)
  const lateSubscriber = reader.read()
  secondController.abort(secondReason)
  await second
  assert.equal(sharedSignal.aborted, false)
  assert.equal(requests, 1, 'late subscribers keep joining the live shared request')
  releaseRequest()
  const result = await lateSubscriber
  assert.equal(result.summary.remainingPercent, 60)
  await reader.read()
  assert.equal(requests, 1, 'the surviving shared request still populates the cache')
})

test('shared usage timeouts clear the flight for the next read', async () => {
  let requests = 0
  const reader = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      requests += 1
      return new Promise((resolve, reject) => {
        const fallback = setTimeout(() => reject(new Error('test fetch did not abort')), 1_000)
        init.signal.addEventListener('abort', () => {
          clearTimeout(fallback)
          reject(init.signal.reason)
        }, { once: true })
      })
    },
  })
  const first = reader.read()
  const second = reader.read()
  await assert.rejects(first, error => error?.name === 'TimeoutError')
  await assert.rejects(second, error => error?.name === 'TimeoutError')
  assert.equal(requests, 1)
  await assert.rejects(reader.read(), error => error?.name === 'TimeoutError')
  assert.equal(requests, 2)
})

test('a forced usage refresh remains privately cancellable', async () => {
  let sharedSignal
  let forcedSignal
  let sharedStarted
  let forcedStarted
  let releaseShared
  const sharedReady = new Promise(resolve => { sharedStarted = resolve })
  const forcedReady = new Promise(resolve => { forcedStarted = resolve })
  const sharedReleased = new Promise(resolve => { releaseShared = resolve })
  let requests = 0
  const reader = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
    fetchImpl: async (_url, init) => {
      requests += 1
      if (requests === 1) {
        sharedSignal = init.signal
        sharedStarted()
        await sharedReleased
      } else {
        forcedSignal = init.signal
        forcedStarted()
        await new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
      }
      init.signal.throwIfAborted()
      return { ok: true, status: 200, async json() { return payload } }
    },
  })
  const shared = reader.read()
  await sharedReady
  const controller = new AbortController()
  const reason = new DOMException('forced refresh cancelled', 'AbortError')
  const forced = assert.rejects(
    reader.read({ force: true, signal: controller.signal }),
    error => error === reason,
  )
  await forcedReady
  controller.abort(reason)
  await forced
  assert.equal(forcedSignal.aborted, true)
  assert.equal(sharedSignal.aborted, false)
  releaseShared()
  assert.equal((await shared).summary.remainingPercent, 60)
})

test('the default fetch is resolved per call across a sibling scoped-wrapper teardown', async () => {
  const original = globalThis.fetch
  // Mimic a sibling plugin's scoped proxy wrapper installed while this plugin
  // loads: it forwards through a mutable fallback that is nulled on teardown.
  let baseFetch = original
  globalThis.fetch = (...args) => baseFetch(...args)
  const reader = createKimiUsageReader({
    getAuth: async () => ({ auth: { apiKey: 'subscription-secret' } }),
  })
  try {
    // Scope ends: the ambient binding is restored and the wrapper dismantled.
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return payload } })
    baseFetch = undefined
    const usage = await reader.read()
    assert.equal(usage.summary.remainingPercent, 60)
  } finally {
    globalThis.fetch = original
  }
})
