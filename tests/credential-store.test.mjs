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
    region: 'mainland-cn',
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
  assert.deepEqual(JSON.parse(backend.readRaw()), { type: 'api_key', key: 'kimi-code-key', region: 'mainland-cn' })
})

test('an API key keeps the region it was connected to', async () => {
  const backend = memoryCredentials()
  const store = new DshKimiCredentialStore(backend, 'KIMI_CREDENTIAL')
  const auth = createKimiAuthService({ async login() {}, async logout() {} }, store)
  const status = await auth.setApiKey('kimi-code-key', { region: 'global' })
  assert.equal(status.region, 'global')
  assert.deepEqual(JSON.parse(backend.readRaw()), { type: 'api_key', key: 'kimi-code-key', region: 'global' })
  assert.equal((await store.read(PROVIDER)).region, 'global')

  // A region outside the two sites is refused before anything is stored.
  await assert.rejects(() => auth.setApiKey('other-key', { region: 'mars' }), /region is invalid/u)
  assert.equal(JSON.parse(backend.readRaw()).key, 'kimi-code-key')
})

test('a credential stored before regions existed reads as mainland-China', async () => {
  const legacyKey = memoryCredentials(JSON.stringify({ type: 'api_key', key: 'legacy-key' }))
  const keyAuth = createKimiAuthService({}, new DshKimiCredentialStore(legacyKey, 'KIMI_CREDENTIAL'))
  assert.equal((await keyAuth.status()).region, 'mainland-cn')

  const legacyOAuth = memoryCredentials(JSON.stringify(oauth('legacy')))
  const oauthStore = new DshKimiCredentialStore(legacyOAuth, 'KIMI_CREDENTIAL')
  assert.equal((await createKimiAuthService({}, oauthStore).status()).region, 'mainland-cn')
  // Reading does not rewrite the stored record.
  assert.equal('region' in JSON.parse(legacyOAuth.readRaw()), false)

  const globalOAuth = memoryCredentials(JSON.stringify({ ...oauth('global'), region: 'global' }))
  const globalStore = new DshKimiCredentialStore(globalOAuth, 'KIMI_CREDENTIAL')
  assert.equal((await globalStore.read(PROVIDER)).region, 'global')
  assert.equal((await createKimiAuthService({}, globalStore).status()).region, 'global')
})

test('a stored credential naming an unknown region is refused', async () => {
  for (const credential of [
    { type: 'api_key', key: 'kimi-code-key', region: 'mars' },
    { ...oauth('mars'), region: 'mars' },
  ]) {
    const store = new DshKimiCredentialStore(memoryCredentials(JSON.stringify(credential)), 'KIMI_CREDENTIAL')
    await assert.rejects(() => store.read(PROVIDER), /unknown Kimi Code region/u)
  }
  const store = new DshKimiCredentialStore(memoryCredentials(), 'KIMI_CREDENTIAL')
  await assert.rejects(() => store.modify(PROVIDER, async () => ({ ...oauth('x'), region: 'mars' })), /unknown Kimi Code region/u)
})
