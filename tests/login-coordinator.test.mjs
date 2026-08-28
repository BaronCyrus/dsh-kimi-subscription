import assert from 'node:assert/strict'
import test from 'node:test'

import { assertKimiAuthUrl, createKimiRpcHandler, KimiLoginCoordinator } from '../src/login-coordinator.js'
import { PROVIDER } from '../src/constants.js'

test('only official Kimi HTTPS login links reach the browser', () => {
  assert.equal(
    assertKimiAuthUrl('https://www.kimi.com/code/authorize_device?user_code=ABCD'),
    'https://www.kimi.com/code/authorize_device?user_code=ABCD',
  )
  assert.equal(assertKimiAuthUrl('https://auth.kimi.com/activate'), 'https://auth.kimi.com/activate')
  assert.throws(() => assertKimiAuthUrl('http://www.kimi.com/code'), /official Kimi HTTPS/u)
  assert.throws(() => assertKimiAuthUrl('https://www.kimi.com.evil.example/code'), /official Kimi HTTPS/u)
  assert.throws(() => assertKimiAuthUrl('javascript:alert(1)'), /official Kimi HTTPS/u)
})

test('device login exposes only public state and scrubs provider failures', async () => {
  const auth = {
    async status() { return { authenticated: false, provider: PROVIDER } },
    async login(interaction) {
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://www.kimi.com/code/authorize_device?user_code=ABCD-EFGH',
        intervalSeconds: 5,
      })
      throw new Error('provider failed with access-secret and refresh-secret')
    },
    async setApiKey() {},
    async logout() {},
  }
  const coordinator = new KimiLoginCoordinator(auth, { createId: () => 'login-1' })
  const handler = createKimiRpcHandler(coordinator)
  const signal = new AbortController().signal
  const started = await handler('login/start', {}, signal)
  assert.equal(started.ok, true)
  assert.equal(started.value.phase, 'waiting_device')
  assert.equal(started.value.deviceCode.userCode, 'ABCD-EFGH')
  await new Promise(resolve => setImmediate(resolve))
  const finished = await handler('login/status', { id: 'login-1' }, signal)
  assert.equal(finished.value.phase, 'failed')
  assert.doesNotMatch(JSON.stringify(finished), /access-secret|refresh-secret/u)
})

test('an active login start is idempotent and cancel settles immediately', async () => {
  const auth = {
    async status() { return { authenticated: false, provider: PROVIDER } },
    async login(interaction) {
      interaction.notify({
        type: 'device_code',
        userCode: 'ONE-CODE',
        verificationUri: 'https://www.kimi.com/code/authorize_device',
      })
      await new Promise(() => {})
    },
    async setApiKey() {},
    async logout() {},
  }
  const coordinator = new KimiLoginCoordinator(auth, { createId: () => 'login-stuck' })
  const first = await coordinator.start()
  const second = await coordinator.start()
  assert.equal(first.id, second.id)
  const cancelled = await coordinator.cancel(first.id)
  assert.equal(cancelled.phase, 'cancelled')
})

test('a superseded cancelled login can settle without an unhandled rejection', async () => {
  let releaseFirst
  let call = 0
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const auth = {
    async status() { return { authenticated: false, provider: PROVIDER } },
    async login(interaction) {
      call += 1
      interaction.notify({
        type: 'device_code',
        userCode: `CODE-${call}`,
        verificationUri: 'https://www.kimi.com/code/authorize_device',
      })
      if (call === 1) {
        await firstGate
        interaction.signal.throwIfAborted()
      } else {
        await new Promise(() => {})
      }
    },
    async setApiKey() {},
    async logout() {},
  }
  const ids = ['login-old', 'login-new']
  const coordinator = new KimiLoginCoordinator(auth, { createId: () => ids.shift() })
  const first = await coordinator.start()
  await coordinator.cancel(first.id)
  const second = await coordinator.start()
  assert.equal(second.id, 'login-new')
  releaseFirst()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(coordinator.read(second.id).phase, 'waiting_device')
})

test('usage RPC returns quota JSON and invalidates it when credentials change', async () => {
  let invalidations = 0
  let observedForce
  const coordinator = {
    async accountStatus() { return { authenticated: true, provider: PROVIDER } },
    async start() {},
    read() {},
    async cancel() {},
    async setApiKey() { return { authenticated: true, provider: PROVIDER, method: 'api_key' } },
    async logout() { return { authenticated: false, provider: PROVIDER } },
  }
  const usageReader = {
    async read({ force }) {
      observedForce = force
      return { summary: { used: 1, limit: 10, remaining: 9, remainingPercent: 90 }, limits: [], extraUsage: null, fetchedAt: 1 }
    },
    invalidate() { invalidations += 1 },
  }
  const handler = createKimiRpcHandler(coordinator, { usageReader })
  const signal = new AbortController().signal
  const usage = await handler('usage', { force: true }, signal)
  assert.equal(usage.ok, true)
  assert.equal(usage.value.summary.remainingPercent, 90)
  assert.equal(observedForce, true)
  await handler('api-key/set', { apiKey: 'replacement' }, signal)
  await handler('logout', {}, signal)
  assert.equal(invalidations, 2)
})
