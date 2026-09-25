import assert from 'node:assert/strict'
import test from 'node:test'

import { DISPLAY_NAME, PROVIDER } from '../src/constants.js'
import {
  createKimiSubscriptionProvider,
  explainKimiModelEntitlement,
  guardKimiStreamAuthRejection,
} from '../src/pi-ai-runtime.js'

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

test('kimi-for-coding carries K2.8 Preview metadata', () => {
  const provider = createKimiSubscriptionProvider()
  const model = provider.getModels().find(entry => entry.id === 'kimi-for-coding')
  assert.ok(model)
  assert.equal(model.name, 'Kimi K2.8 Preview')
  assert.equal(model.contextWindow, 1048576)
  assert.deepEqual(model.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: null,
    max: 'max',
  })
})

async function* failingStream(error) { throw error }
async function* failAfterChunk(error) { yield { type: 'chunk' }; throw error }
async function* okStream() { yield { type: 'chunk' } }

test('stream guard marks a pre-chunk 401 and stays silent otherwise', async () => {
  let marks = 0
  const onAuthRejected = () => { marks += 1 }
  const authError = new Error('401 {"error":{"message":"The API Key appears to be invalid or may have expired.","type":"invalid_authentication_error"}}')

  const guarded = guardKimiStreamAuthRejection(failingStream(authError), onAuthRejected)
  await assert.rejects(() => guarded[Symbol.asyncIterator]().next(), /401/u)
  assert.equal(marks, 1)

  // The same error after a produced chunk is not an auth rejection of a fresh request.
  marks = 0
  const late = guardKimiStreamAuthRejection(failAfterChunk(authError), onAuthRejected)
  const iterator = late[Symbol.asyncIterator]()
  await iterator.next()
  await assert.rejects(() => iterator.next(), /401/u)
  assert.equal(marks, 0)

  // Non-auth failures never mark the token.
  marks = 0
  const other = guardKimiStreamAuthRejection(failingStream(new Error('500 {"error":{"message":"upstream"}}')), onAuthRejected)
  await assert.rejects(() => other[Symbol.asyncIterator]().next(), /500/u)
  assert.equal(marks, 0)

  // Ancillary stream members such as .result() survive the proxy.
  const stream = okStream()
  stream.result = async () => 'done'
  const wrapped = guardKimiStreamAuthRejection(stream, onAuthRejected)
  assert.equal(await wrapped.result(), 'done')
  const chunks = []
  for await (const chunk of wrapped) chunks.push(chunk)
  assert.deepEqual(chunks, [{ type: 'chunk' }])
})

// The host classifies a failure by matching the provider text: any 401 or 403
// becomes AUTH, and its chat surface then prints a fixed "API key is invalid".
// A replacement sentence is only useful if none of those patterns match it, so
// this mirrors the host's own categories.
const HOST_FAILURE_PATTERNS = [
  /\b(?:401|403)\b/u,
  /\b(?:400|413|429)\b|\b5\d\d\b/u,
  /quota|rate.?limit|invalid.?request|time(?:d)?\s*out|timeout/iu,
  /network|connection|socket|fetch|ECONN[A-Z]+/iu,
  /stream ended (?:before|without)/iu,
]

const kimiPlanRejection = model =>
  `401 {"error":{"type":"authentication_error","message":"Your current subscription does not have access to ${model}.`
  + '  Upgrade to higher-tier Kimi Code plans. Upgrade: Upgrade: https://www.kimi.com/code?from=server_highspeed_error#pricing"},"type":"error"}'

test('a plan rejection is explained instead of being read as an invalid key', () => {
  const explained = explainKimiModelEntitlement(kimiPlanRejection('k3'))
  assert.ok(explained)
  assert.match(explained, /k3/u)
  assert.match(explained, /kimi-for-coding/u)
  for (const pattern of HOST_FAILURE_PATTERNS) {
    assert.doesNotMatch(explained, pattern, `the replacement must not match ${String(pattern)}`)
  }
})

test('only a plan rejection is rewritten', () => {
  assert.equal(explainKimiModelEntitlement(undefined), undefined)
  assert.equal(explainKimiModelEntitlement(''), undefined)
  assert.equal(explainKimiModelEntitlement('500 {"error":{"message":"upstream"}}'), undefined)
  assert.equal(explainKimiModelEntitlement('401 {"error":{"message":"The API Key appears to be invalid."}}'), undefined)
  // Kimi's tier wording alone, without naming a model, still explains the limit.
  const generic = explainKimiModelEntitlement('401 {"error":{"message":"Upgrade to higher-tier Kimi Code plans."}}')
  assert.ok(generic)
  assert.match(generic, /本次请求的模型/u)
  for (const pattern of HOST_FAILURE_PATTERNS) assert.doesNotMatch(generic, pattern)
})

test('the stream guard rewrites a plan rejection in the terminal event only', async () => {
  const rejection = kimiPlanRejection('k3')
  async function* planLimited() {
    yield { type: 'chunk' }
    yield { type: 'error', reason: 'error', error: { stopReason: 'error', errorMessage: rejection } }
  }
  const events = []
  for await (const event of guardKimiStreamAuthRejection(planLimited())) events.push(event)
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], { type: 'chunk' })
  assert.notEqual(events[1].error.errorMessage, rejection)
  assert.match(events[1].error.errorMessage, /k3/u)
  for (const pattern of HOST_FAILURE_PATTERNS) assert.doesNotMatch(events[1].error.errorMessage, pattern)
  // Everything else about the event and its carrier is preserved.
  assert.equal(events[1].reason, 'error')
  assert.equal(events[1].error.stopReason, 'error')

  async function* otherFailure() {
    yield { type: 'error', reason: 'error', error: { errorMessage: '500 upstream' } }
  }
  for await (const event of guardKimiStreamAuthRejection(otherFailure())) {
    assert.equal(event.error.errorMessage, '500 upstream')
  }

  // A success event carries its assistant message under `message`.
  async function* planLimitedDone() {
    yield { type: 'done', reason: 'error', message: { stopReason: 'error', errorMessage: rejection } }
  }
  for await (const event of guardKimiStreamAuthRejection(planLimitedDone())) {
    assert.match(event.message.errorMessage, /k3/u)
  }
})
