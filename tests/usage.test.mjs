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
