import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_KIMI_REGION,
  KIMI_AUTH_ORIGINS,
  KIMI_REGIONS,
  kimiRegionOf,
  kimiRegionSite,
  kimiRegionSiteOfAuth,
} from '../src/kimi-region.js'

// https://www.kimi.com/code/docs/kimi-code/models.html gives the API hosts of
// both sites; MoonshotAI/kimi-code packages/oauth/src/region.ts gives their
// authorization servers.
test('each region names its own Kimi Code hosts', () => {
  assert.deepEqual(KIMI_REGIONS, ['mainland-cn', 'global'])
  assert.equal(DEFAULT_KIMI_REGION, 'mainland-cn')
  assert.deepEqual({ ...kimiRegionSite('mainland-cn'), authOrigins: [...kimiRegionSite('mainland-cn').authOrigins] }, {
    region: 'mainland-cn',
    baseUrl: 'https://api.kimi.com/coding',
    usageUrl: 'https://api.kimi.com/coding/v1/usages',
    searchUrl: 'https://api.kimi.com/coding/v1/search',
    oauthHost: 'https://auth.kimi.com',
    authOrigins: ['https://auth.kimi.com', 'https://www.kimi.com', 'https://kimi.com'],
  })
  assert.deepEqual({ ...kimiRegionSite('global'), authOrigins: [...kimiRegionSite('global').authOrigins] }, {
    region: 'global',
    baseUrl: 'https://api.kimi.ai/coding',
    usageUrl: 'https://api.kimi.ai/coding/v1/usages',
    searchUrl: 'https://api.kimi.ai/coding/v1/search',
    oauthHost: 'https://auth.kimi.ai',
    authOrigins: ['https://auth.kimi.ai', 'https://www.kimi.ai', 'https://kimi.ai'],
  })
  assert.deepEqual([...KIMI_AUTH_ORIGINS], [
    'https://auth.kimi.com',
    'https://www.kimi.com',
    'https://kimi.com',
    'https://auth.kimi.ai',
    'https://www.kimi.ai',
    'https://kimi.ai',
  ])
  assert.ok(Object.isFrozen(kimiRegionSite('global')))
})

test('no region is mainland-China and an unknown one is refused', () => {
  assert.equal(kimiRegionOf(undefined), 'mainland-cn')
  assert.equal(kimiRegionSite(undefined).baseUrl, 'https://api.kimi.com/coding')
  assert.equal(kimiRegionOf('global'), 'global')
  for (const value of ['', 'cn', 'Global', 'toString', '__proto__', null, 1, {}]) {
    assert.throws(() => kimiRegionOf(value), /Kimi Code subscription region is invalid/u)
  }
})

test('usage and search follow the base URL the auth resolution names', () => {
  assert.equal(kimiRegionSiteOfAuth({ apiKey: 'key' }).region, 'mainland-cn')
  assert.equal(kimiRegionSiteOfAuth(undefined).region, 'mainland-cn')
  assert.equal(kimiRegionSiteOfAuth({ apiKey: 'key', baseUrl: 'https://api.kimi.com/coding' }).region, 'mainland-cn')
  assert.equal(kimiRegionSiteOfAuth({ headers: {}, baseUrl: 'https://api.kimi.ai/coding' }).usageUrl, 'https://api.kimi.ai/coding/v1/usages')
  // A host outside the table never receives the credential.
  for (const baseUrl of ['https://api.kimi.ai/coding/', 'https://api.moonshot.ai/v1', 'https://api.kimi.ai.evil.example/coding']) {
    assert.throws(() => kimiRegionSiteOfAuth({ apiKey: 'key', baseUrl }), /region is not recognized/u)
  }
})
