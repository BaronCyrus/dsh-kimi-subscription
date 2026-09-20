import assert from 'node:assert/strict'
import test from 'node:test'

import { apply as applyRetry } from '@deepseek-ai/dsh-llm-retry'
import { Session } from '@deepseek-ai/dsh-session'

import { apply, PROVIDER } from '../src/index.js'

const RETRYABLE_CODES = Object.freeze([
  'EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH',
])

// Capture the actual adapter policy, not a separately normalized test fixture.
// Do not run plugin effects: those own profile edits and account RPC handlers.
function pluginPolicy(t) {
  t.mock.method(globalThis, 'fetch', () => assert.fail('retry tests must not use the network'))
  let registered
  apply({
    credentials: new Proxy({}, {
      get() { assert.fail('retry policy registration must not access credentials') },
    }),
    llm: {
      registerAdapter(providers, adapter) {
        assert.deepEqual(providers, [PROVIDER])
        assert.equal(registered, undefined)
        registered = adapter
      },
    },
    settings: { register: () => ({}) },
    web: { registerSearchProvider() {} },
    loader: { entries() { assert.fail('retry tests must not inspect profiles') } },
    effect() {},
  })
  assert.ok(registered)
  return registered.providerRetryPolicy(PROVIDER)
}

function retryHarness(t, policy) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const session = Session.create('offline-kimi-retry-test')
  const controller = new AbortController()
  const projections = new Map()
  let listener
  let dispose
  applyRetry({
    sessionProjections: {
      register(projection) { projections.set(projection.key, projection) },
      stateOf(currentSession, key) {
        const projection = projections.get(key)
        assert.ok(projection)
        // Replay the executor's own reducer over real, validated Session events.
        // No retry-count, policy-key, or delay algorithm is duplicated here.
        return currentSession.snapshotEvents().reduce(
          (state, event) => projection.apply(state, event),
          projection.init(),
        )
      },
    },
    on(event, callback) {
      assert.equal(event, 'agent/request-error')
      listener = callback
      return () => {}
    },
    effect(register) { dispose = register() },
    logger: { warn() { assert.fail('normal retries must not swallow recovery errors') } },
  }, {}, { random: () => 0.5 })
  t.after(async () => { await dispose() })
  return {
    session,
    controller,
    events: () => session.snapshotEvents(),
    recover(failure, next = () => assert.fail('eligible failure must be retried')) {
      const pending = listener({
        agent: { session },
        turn: 1,
        step: 1,
        provider: PROVIDER,
        failure,
        retryPolicy: policy,
        signal: controller.signal,
      }, next)
      // Keep assertion failures from leaking an unhandled rejection while the
      // after hook aborts/drains an in-flight wait. Callers still await pending.
      pending.catch(() => {})
      return pending
    },
  }
}

async function expectRetry(t, harness, failure, retry, delayMs, next) {
  const pending = harness.recover(failure, next)
  const scheduled = harness.events().filter(event => event.type === 'llm/retry')
  if (scheduled.length !== retry) {
    // Surface the real append failure (the issue's NaN regression), rather
    // than only reporting that the expected event was absent.
    await pending
    assert.fail(`expected retry ${retry} to be durable before its wait`)
  }
  const event = scheduled.at(-1)
  assert.equal(event.data.retry, retry)
  assert.equal(event.data.maxRetries, 2)
  assert.equal(event.data.provider, PROVIDER)
  assert.equal(event.data.mode, 'normal')
  assert.equal(event.data.delayMs, delayMs)
  assert.ok(Number.isFinite(event.data.delayMs))
  assert.deepEqual(event.data.failure, failure)
  assert.ok(Object.isFrozen(event.data))
  assert.equal(harness.events().filter(item => item.type === 'llm/retry-started').length, retry - 1)

  t.mock.timers.tick(delayMs - 1)
  await Promise.resolve()
  assert.equal(harness.events().filter(item => item.type === 'llm/retry-started').length, retry - 1)
  t.mock.timers.tick(1)
  assert.deepEqual(await pending, { kind: 'retry' })
  const started = harness.events().at(-1)
  assert.equal(started.type, 'llm/retry-started')
  assert.equal(started.data.retry, retry)
  assert.equal(started.data.retryId, event.data.retryId)
}

test('registered adapter exposes a complete immutable retry policy', t => {
  const policy = pluginPolicy(t)
  assert.deepEqual(policy, {
    mode: 'normal',
    maxRetries: 2,
    retryableCodes: [...RETRYABLE_CODES],
    initialDelayMs: 500,
    maxDelayMs: 10000,
    jitterRatio: 0.1,
  })
  assert.ok(Object.isFrozen(policy))
  assert.ok(Object.isFrozen(policy.retryableCodes))
  assert.throws(() => { policy.initialDelayMs = 0 }, TypeError)
  assert.throws(() => { policy.retryableCodes.push('QUOTA') }, TypeError)
})

for (const code of RETRYABLE_CODES) {
  test(`${code}: actual policy retries twice with finite default delays, then preserves the failure`, async t => {
    const harness = retryHarness(t, pluginPolicy(t))
    // No providerRetryAfterMs: that would bypass the broken local-backoff path.
    const failure = { code, message: `Synthetic ${code} provider failure` }
    const originalError = new Error(failure.message)
    let downstreamCalls = 0
    const next = () => {
      downstreamCalls++
      throw originalError
    }
    await expectRetry(t, harness, failure, 1, 500, next)
    await expectRetry(t, harness, failure, 2, 1000, next)
    assert.equal(downstreamCalls, 0)
    const before = harness.events()
    await assert.rejects(harness.recover(failure, next), error => error === originalError)
    assert.equal(downstreamCalls, 1)
    assert.deepEqual(harness.events(), before)
    assert.deepEqual(before.map(event => event.type), [
      'llm/retry', 'llm/retry-started', 'llm/retry', 'llm/retry-started',
    ])
    assert.equal(before[0].data.retryId, before[2].data.retryId)
  })
}

test('nonretryable QUOTA goes straight downstream without a retry event', async t => {
  const harness = retryHarness(t, pluginPolicy(t))
  const failure = { code: 'QUOTA', message: 'Synthetic exhausted weekly quota' }
  const originalError = new Error(failure.message)
  let downstreamCalls = 0
  await assert.rejects(harness.recover(failure, () => {
    downstreamCalls++
    throw originalError
  }), error => error === originalError)
  assert.equal(downstreamCalls, 1)
  assert.deepEqual(harness.events(), [])
})

test('finite providerRetryAfterMs is honored instead of local backoff', async t => {
  const harness = retryHarness(t, pluginPolicy(t))
  const failure = { code: 'RATE_LIMIT', message: 'Synthetic rate limit', providerRetryAfterMs: 750 }
  await expectRetry(t, harness, failure, 1, 750)
})

test('providerRetryAfterMs above the policy cap is not retried', async t => {
  const harness = retryHarness(t, pluginPolicy(t))
  const failure = { code: 'RATE_LIMIT', message: 'Synthetic long rate limit', providerRetryAfterMs: 10001 }
  const originalError = new Error(failure.message)
  let downstreamCalls = 0
  const pending = harness.recover(failure, () => {
    downstreamCalls++
    throw originalError
  })
  assert.deepEqual(harness.events(), [])
  await assert.rejects(pending, error => error === originalError)
  assert.equal(downstreamCalls, 1)
})

test('cancellation during backoff never starts the scheduled retry', async t => {
  const harness = retryHarness(t, pluginPolicy(t))
  const pending = harness.recover({ code: 'TIMEOUT', message: 'Synthetic timeout' })
  if (harness.events().length === 0) await pending
  assert.deepEqual(harness.events().map(event => event.type), ['llm/retry'])
  t.mock.timers.tick(100)
  harness.controller.abort(new Error('Synthetic user cancellation'))
  assert.equal(await pending, undefined)
  t.mock.timers.tick(10000)
  await Promise.resolve()
  assert.deepEqual(harness.events().map(event => event.type), ['llm/retry'])
})

test('a synthetic request can succeed after the first scheduled retry', async t => {
  const harness = retryHarness(t, pluginPolicy(t))
  const originalError = new Error('Synthetic timeout before success')
  let attempts = 0
  async function run() {
    attempts++
    if (attempts === 2) return 'offline success'
    const decision = await harness.recover({ code: 'TIMEOUT', message: originalError.message }, () => {
      throw originalError
    })
    assert.deepEqual(decision, { kind: 'retry' })
    return run()
  }
  const result = run()
  result.catch(() => {})
  if (harness.events().length === 0) await result
  assert.equal(attempts, 1)
  assert.equal(harness.events()[0].data.delayMs, 500)
  t.mock.timers.tick(500)
  assert.equal(await result, 'offline success')
  assert.equal(attempts, 2)
  assert.deepEqual(harness.events().map(event => event.type), ['llm/retry', 'llm/retry-started'])
})

test('negative control: unresolved policy reproduces the real Session serialization failure', async t => {
  const harness = retryHarness(t, {
    mode: 'normal',
    maxRetries: 2,
    retryableCodes: [...RETRYABLE_CODES],
  })
  // Unlike JSON.stringify (which silently writes NaN as null), real Session
  // append must reject the non-finite delay produced by this legacy policy.
  await assert.rejects(
    harness.recover({ code: 'TIMEOUT', message: 'Synthetic timeout' }),
    /session event "llm\/retry" carries non-JSON-serializable data/u,
  )
  assert.deepEqual(harness.events(), [])
})
