import assert from 'node:assert/strict'
import test from 'node:test'

import { DISPLAY_NAME, PROVIDER } from '../src/constants.js'
import { createKimiSubscriptionProvider } from '../src/pi-ai-runtime.js'

test('provider keeps Kimi Code protocol behavior under a distinct DSH route', () => {
  const provider = createKimiSubscriptionProvider()
  assert.equal(provider.id, PROVIDER)
  assert.equal(provider.name, DISPLAY_NAME)
  assert.equal(provider.baseUrl, 'https://api.kimi.com/coding')
  assert.ok(provider.auth.oauth)
  assert.ok(provider.auth.apiKey)
  const models = provider.getModels()
  assert.ok(models.length >= 1)
  assert.ok(models.some(model => model.id === 'k3' || model.id === 'kimi-for-coding'))
  assert.ok(models.every(model => model.provider === PROVIDER))
  assert.ok(models.every(model => model.api === 'anthropic-messages'))
})
