import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import test from 'node:test'

import {
  classifyKimiOAuthFailure,
  createKimiOAuth,
  decodeJsonBody,
  KIMI_OAUTH_CLIENT_ID,
  KIMI_OAUTH_HOST,
  KimiOAuthError,
} from '../src/kimi-oauth.js'
import { createKimiSubscriptionProvider } from '../src/pi-ai-runtime.js'

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
})

/** Body of one recorded request, as URLSearchParams. */
const bodyOf = init => new URLSearchParams(String(init?.body ?? ''))

function deviceAuthorization(overrides = {}) {
  return {
    device_code: 'device-code-1',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://www.kimi.com/code/authorize_device',
    verification_uri_complete: 'https://www.kimi.com/code/authorize_device?user_code=ABCD-EFGH',
    expires_in: 1800,
    interval: 5,
    ...overrides,
  }
}

/** Scripted transport: one entry per expected token request, in order. */
function scriptedFetch(tokenResponses, { authorization } = {}) {
  const calls = []
  const queue = [...tokenResponses]
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/api/oauth/device_authorization')) {
      if (authorization !== undefined) return typeof authorization === 'function' ? authorization() : authorization
      return json(deviceAuthorization())
    }
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected extra token request')
    return typeof next === 'function' ? next() : next
  }
  return { fetchImpl, calls, remaining: () => queue.length }
}

const oauthFor = (fetchImpl, options = {}) => createKimiOAuth({
  fetchImpl,
  pause: async () => {},
  ...options,
})

test('device login asks for an identity body and stores the rotated credential', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    json({ error: 'authorization_pending', error_description: 'Authorization is pending' }, 400),
    json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900, token_type: 'Bearer' }),
  ])
  const notifications = []
  const credential = await oauthFor(fetchImpl).login({
    signal: new AbortController().signal,
    notify: event => notifications.push(event),
  })

  assert.equal(credential.type, 'oauth')
  assert.equal(credential.access, 'access-1')
  assert.equal(credential.refresh, 'refresh-1')
  assert.ok(credential.expires > Date.now())

  assert.deepEqual(notifications, [{
    type: 'device_code',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://www.kimi.com/code/authorize_device?user_code=ABCD-EFGH',
    intervalSeconds: 5,
    expiresInSeconds: 1800,
  }])

  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.init.headers['accept-encoding'], 'identity')
    assert.equal(call.init.redirect, 'error')
  }
  assert.equal(bodyOf(calls[0].init).get('client_id'), KIMI_OAUTH_CLIENT_ID)
  assert.equal(calls[0].url, `${KIMI_OAUTH_HOST}/api/oauth/device_authorization`)
  assert.equal(bodyOf(calls[1].init).get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code')
  assert.equal(bodyOf(calls[1].init).get('device_code'), 'device-code-1')
})

test('a compressed token response is decoded even when the header is missing', async () => {
  // The regression this release fixes: a proxy returned the gzip body while the
  // Content-Encoding header did not survive, so JSON.parse saw 0x1f 0x8b.
  const compressed = gzipSync(Buffer.from(JSON.stringify({
    access_token: 'access-gz',
    refresh_token: 'refresh-gz',
    expires_in: 900,
  })))
  const { fetchImpl } = scriptedFetch([
    new Response(compressed, { status: 200, headers: { 'content-type': 'application/json' } }),
  ])
  const credential = await oauthFor(fetchImpl).login({ signal: new AbortController().signal, notify: () => {} })
  assert.equal(credential.access, 'access-gz')
  assert.equal(credential.refresh, 'refresh-gz')
})

test('decodeJsonBody reads plain, gzip, and header-declared bodies', () => {
  const payload = { ok: true }
  const plain = Buffer.from(JSON.stringify(payload))
  assert.deepEqual(decodeJsonBody(plain, null), payload)
  assert.deepEqual(decodeJsonBody(gzipSync(plain), null), payload)
  assert.deepEqual(decodeJsonBody(gzipSync(plain), 'gzip'), payload)
  assert.equal(decodeJsonBody(Buffer.from('not json'), null), undefined)
})

test('a sign-in that Kimi denies, expires, or mis-answers names the step', async () => {
  const cases = [
    [json({ error: 'access_denied' }, 400), 'oauth/denied', 'denied'],
    [json({ error: 'expired_token' }, 400), 'oauth/expired', 'expired'],
    [json({ error: 'invalid_request' }, 400), 'oauth/exchange', 'exchange'],
    [json({ nonsense: true }), 'oauth/response', 'response'],
  ]
  for (const [response, code, reason] of cases) {
    const { fetchImpl } = scriptedFetch([response])
    await assert.rejects(
      () => oauthFor(fetchImpl).login({ signal: new AbortController().signal, notify: () => {} }),
      error => {
        assert.ok(error instanceof KimiOAuthError)
        assert.equal(error.code, code)
        assert.equal(classifyKimiOAuthFailure(error), reason)
        return true
      },
    )
  }
})

test('an unreachable or failing authorization server stays distinguishable', async () => {
  const timeout = scriptedFetch([], { authorization: () => { throw new Error('socket hang up') } })
  await assert.rejects(
    () => oauthFor(timeout.fetchImpl).login({ signal: new AbortController().signal, notify: () => {} }),
    error => classifyKimiOAuthFailure(error) === 'network',
  )

  const refused = scriptedFetch([], { authorization: json({ error: 'server_error' }, 503) })
  await assert.rejects(
    () => oauthFor(refused.fetchImpl).login({ signal: new AbortController().signal, notify: () => {} }),
    error => classifyKimiOAuthFailure(error) === 'unreachable',
  )
})

test('a token endpoint that keeps failing is retried and then reported as an exchange failure', async () => {
  const { fetchImpl, calls } = scriptedFetch(Array.from({ length: 8 }, () => json({ error: 'server_error' }, 503)))
  await assert.rejects(
    () => oauthFor(fetchImpl).login({ signal: new AbortController().signal, notify: () => {} }),
    error => {
      assert.equal(error.code, 'oauth/exchange')
      assert.equal(classifyKimiOAuthFailure(error), 'exchange')
      return true
    },
  )
  // One device authorization plus the bounded exchange attempts.
  assert.equal(calls.length, 1 + 4)
})

test('refresh reuses the previous refresh token when Kimi does not rotate one', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    json({ access_token: 'access-2', expires_in: 900 }),
  ])
  const credential = await oauthFor(fetchImpl).refresh({
    type: 'oauth',
    access: 'access-1',
    refresh: 'refresh-1',
    expires: Date.now() - 1000,
  }, new AbortController().signal)
  assert.equal(credential.access, 'access-2')
  assert.equal(credential.refresh, 'refresh-1')
  assert.equal(bodyOf(calls[0].init).get('grant_type'), 'refresh_token')
  assert.equal(bodyOf(calls[0].init).get('refresh_token'), 'refresh-1')
})

test('a rejected refresh token is reported as rejected, not as a transport failure', async () => {
  const { fetchImpl } = scriptedFetch([
    json({ error: 'invalid_grant', error_description: 'The provided authorization grant is invalid' }, 400),
  ])
  await assert.rejects(
    () => oauthFor(fetchImpl).refresh({ type: 'oauth', access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal),
    error => {
      assert.equal(error.code, 'oauth/refresh-rejected')
      assert.equal(classifyKimiOAuthFailure(error), undefined)
      return true
    },
  )
})

test('an aborted sign-in rejects with the abort reason', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by the user'))
  const { fetchImpl } = scriptedFetch([])
  await assert.rejects(
    () => oauthFor(fetchImpl).login({ signal: controller.signal, notify: () => {} }),
    error => classifyKimiOAuthFailure(error) === 'aborted',
  )
})

test('classification walks the wrapper pi-ai puts around provider failures', () => {
  const inner = new KimiOAuthError('oauth/denied', 'denied')
  const wrapped = new Error('OAuth refresh failed for kimi-subscription', { cause: new Error('models', { cause: inner }) })
  assert.equal(classifyKimiOAuthFailure(wrapped), 'denied')
  assert.equal(classifyKimiOAuthFailure(new Error('unrelated')), undefined)
  assert.equal(classifyKimiOAuthFailure(undefined), undefined)
})

test('the subscription provider drives this plugin’s OAuth, not pi-ai’s', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900 }),
  ])
  const provider = createKimiSubscriptionProvider({ oauth: oauthFor(fetchImpl) })
  assert.equal(provider.auth.oauth.isSubscription, true)
  assert.equal(provider.baseUrl, 'https://api.kimi.com/coding')
  assert.deepEqual(Object.keys(provider.auth.oauth).sort(), ['isSubscription', 'login', 'loginLabel', 'name', 'refresh', 'toAuth'])
  const notifications = []
  const credential = await provider.auth.oauth.login({
    signal: new AbortController().signal,
    notify: event => notifications.push(event),
  })
  assert.equal(credential.access, 'access-1')
  assert.deepEqual(notifications.map(event => event.type), ['device_code'])
  assert.equal(calls[0].init.headers['accept-encoding'], 'identity')
  const auth = await provider.auth.oauth.toAuth({ access: 'token-1' })
  assert.equal(auth.headers.Authorization, 'Bearer token-1')
})
