import assert from 'node:assert/strict'
import test from 'node:test'

import { createKimiAuthService, DshKimiCredentialStore, OAUTH_EXPIRY_LEEWAY_MS } from '../src/credential-store.js'
import { PROVIDER } from '../src/constants.js'

function memoryCredentials(initial) {
  let value = initial
  return {
    async resolve() { return value === undefined ? undefined : { value } },
    async set(_ref, next) { value = next },
    async unset() { value = undefined },
    readRaw() { return value },
  }
}

const oauth = suffix => ({
  type: 'oauth',
  access: `access-${suffix}`,
  refresh: `refresh-${suffix}`,
  expires: 1_900_000_000_000,
})

test('credential store persists API-key and OAuth credentials without exposing them in status', async () => {
  const backend = memoryCredentials()
  const store = new DshKimiCredentialStore(backend, 'KIMI_CREDENTIAL')
  await store.modify(PROVIDER, async () => ({ type: 'api_key', key: 'FAKE_SUBSCRIPTION_KEY_FOR_TESTS' }))
  assert.deepEqual(await store.list(), [{ providerId: PROVIDER, type: 'api_key' }])

  const models = {
    async login() {},
    async logout() { await store.delete(PROVIDER) },
  }
  const auth = createKimiAuthService(models, store)
  const status = await auth.status()
  assert.deepEqual(status, {
    authenticated: true,
    provider: PROVIDER,
    method: 'api-key',
  })
  assert.doesNotMatch(JSON.stringify(status), /FAKE_SUBSCRIPTION_KEY_FOR_TESTS/u)

  await store.modify(PROVIDER, async () => oauth('one'))
  const oauthStatus = await auth.status()
  assert.equal(oauthStatus.method, 'oauth')
  assert.equal(oauthStatus.expiresAt, oauth('one').expires - OAUTH_EXPIRY_LEEWAY_MS)
  assert.doesNotMatch(JSON.stringify(oauthStatus), /access-one|refresh-one/u)
})

test('OAuth reads apply expiry leeway and an upstream rejection forces refresh', async () => {
  const backend = memoryCredentials(JSON.stringify(oauth('one')))
  const store = new DshKimiCredentialStore(backend, 'KIMI_CREDENTIAL')

  const usable = await store.read(PROVIDER)
  assert.equal(usable.expires, oauth('one').expires - OAUTH_EXPIRY_LEEWAY_MS)
  assert.equal(usable.access, 'access-one')

  store.markAccessRejected()
  const marked = await store.read(PROVIDER)
  assert.equal(marked.expires, 0)
  assert.equal(marked.access, 'access-one')

  // A rotated token clears the rejection mark and keeps only the leeway.
  await store.modify(PROVIDER, async () => oauth('two'))
  const rotated = await store.read(PROVIDER)
  assert.equal(rotated.expires, oauth('two').expires - OAUTH_EXPIRY_LEEWAY_MS)

  // The persisted record always keeps the true expiry from the token endpoint.
  assert.equal(JSON.parse(backend.readRaw()).expires, oauth('two').expires)
})

test('refresh rotations are serialized', async () => {
  const backend = memoryCredentials(JSON.stringify(oauth('zero')))
  const store = new DshKimiCredentialStore(backend, 'KIMI_CREDENTIAL')
  let release
  const gate = new Promise(resolve => { release = resolve })
  const seen = []
  const first = store.modify(PROVIDER, async current => {
    seen.push(current.refresh)
    await gate
    return oauth('one')
  })
  const second = store.modify(PROVIDER, async current => {
    seen.push(current.refresh)
    return oauth('two')
  })
  release()
  await Promise.all([first, second])
  assert.deepEqual(seen, ['refresh-zero', 'refresh-one'])
  assert.deepEqual(JSON.parse(backend.readRaw()), oauth('two'))
})

test('API-key writes validate and replace the current auth method', async () => {
  const backend = memoryCredentials(JSON.stringify(oauth('old')))
  const store = new DshKimiCredentialStore(backend, 'KIMI_CREDENTIAL')
  const auth = createKimiAuthService({ async login() {}, async logout() {} }, store)
  assert.rejects(() => auth.setApiKey('   '), /invalid/u)
  const status = await auth.setApiKey('  kimi-code-key  ')
  assert.equal(status.method, 'api-key')
  assert.deepEqual(JSON.parse(backend.readRaw()), { type: 'api_key', key: 'kimi-code-key' })
})
