import assert from 'node:assert/strict'
import test from 'node:test'

import { DISPLAY_NAME, PROVIDER } from '../src/constants.js'
import {
  createKimiSubscriptionProvider,
  explainKimiModelEntitlement,
  guardKimiStreamAuthRejection,
  withK31ProModels,
} from '../src/pi-ai-runtime.js'

const LOW_HIGH_MAX = {
  off: null,
  minimal: null,
  low: 'low',
  medium: null,
  high: 'high',
  xhigh: null,
  max: 'max',
}

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
  assert.deepEqual(model.thinkingLevelMap, LOW_HIGH_MAX)
})

// https://www.kimi.com/code/docs/kimi-code/models.html lists these six IDs,
// in this order, with these model versions and context windows. The Open
// Platform's IDs (`kimi-k3.1-pro`, `kimi-k2.7-code-highspeed`, ...) are not
// Kimi Code's: Kimi Code serves an ID outside its table with K2.8 Preview
// without thinking.
test('the model list follows Kimi Code model documentation', () => {
  const models = createKimiSubscriptionProvider().getModels()
  assert.deepEqual(models.map(model => [model.id, model.name, model.contextWindow]), [
    ['k3.1-pro', 'Kimi K3.1 Pro', 1048576],
    ['k3.1-pro-highspeed', 'Kimi K3.1 Pro Highspeed', 1048576],
    ['k3', 'Kimi K3', 1048576],
    ['k3-256k', 'Kimi K3-256K', 262144],
    ['kimi-for-coding', 'Kimi K2.8 Preview', 1048576],
    ['kimi-for-coding-highspeed', 'Kimi K2.7 Code Highspeed', 262144],
  ])
})

// Kimi Code serves a request that disables thinking on K2.7 Code Highspeed
// with K2.8 Preview without thinking, and this model takes no effort level.
test('K2.7 Code Highspeed offers no thinking level and never disables thinking', async () => {
  const provider = createKimiSubscriptionProvider()
  const model = provider.getModels().find(entry => entry.id === 'kimi-for-coding-highspeed')
  // No selectable effort capability; the backend still always thinks.
  assert.equal(model.reasoning, false)
  assert.deepEqual(model.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  })
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'offline test' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  const context = { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }
  const options = { apiKey: 'FAKE_SUBSCRIPTION_KEY_FOR_TESTS', fetch, maxRetries: 0 }
  for (const reasoning of [undefined, 'off', 'high', 'max']) {
    const events = []
    for await (const event of provider.streamSimple(model, context, { ...options, reasoning })) events.push(event)
    assert.equal(events.at(-1).type, 'error')
  }
  assert.equal(requests.length, 4)
  for (const { url, body } of requests) {
    assert.ok(url.startsWith('https://api.kimi.com/coding/v1/messages'), url)
    assert.equal(body.model, 'kimi-for-coding-highspeed')
    // Even forced pi-ai options cannot disable the backend's thinking.
    assert.equal(body.thinking, undefined)
    assert.equal(body.output_config, undefined)
  }
})

// https://www.kimi.com/code/docs/kimi-code/models.html lists the K3.1 Pro
// models first, by these exact IDs; a mistyped ID silently falls back to K2.8
// Preview without thinking, so the IDs are pinned here.
test('K3.1 Pro and K3.1 Pro Highspeed follow Kimi Code model documentation', () => {
  const models = createKimiSubscriptionProvider().getModels()
  const ids = models.map(model => model.id)
  assert.equal(new Set(ids).size, ids.length, 'model ids must be unique')
  assert.deepEqual(ids.slice(0, 3), ['k3.1-pro', 'k3.1-pro-highspeed', 'k3'])
  const k3 = models.find(model => model.id === 'k3')
  for (const [id, name] of [['k3.1-pro', 'Kimi K3.1 Pro'], ['k3.1-pro-highspeed', 'Kimi K3.1 Pro Highspeed']]) {
    const model = models.find(entry => entry.id === id)
    assert.equal(model.name, name)
    assert.equal(model.provider, PROVIDER)
    assert.equal(model.contextWindow, 1048576)
    assert.deepEqual(model.thinkingLevelMap, LOW_HIGH_MAX)
    assert.equal(model.reasoning, true)
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    // The wire protocol, endpoint, and limits are k3's.
    assert.equal(model.api, k3.api)
    assert.equal(model.baseUrl, k3.baseUrl)
    assert.deepEqual(model.compat, k3.compat)
    assert.deepEqual(model.input, k3.input)
    assert.equal(model.maxTokens, k3.maxTokens)
  }
})

test('K3.1 models are added only while the installed catalog lacks them', () => {
  const k3 = { id: 'k3', name: 'Kimi K3', api: 'anthropic-messages', contextWindow: 1048576 }
  const upstream = { id: 'k3.1-pro', name: 'Upstream K3.1 Pro', api: 'anthropic-messages', contextWindow: 1048576 }
  const merged = withK31ProModels([upstream, k3])
  assert.deepEqual(merged.map(model => model.id), ['k3.1-pro', 'k3.1-pro-highspeed', 'k3'])
  assert.equal(merged[0], upstream, 'an entry pi-ai ships is kept as it is')
  assert.equal(merged[1].name, 'Kimi K3.1 Pro Highspeed')

  // Without k3 there is no Kimi Code protocol entry to start from.
  const legacy = [{ id: 'kimi-for-coding' }]
  assert.equal(withK31ProModels(legacy), legacy)
})

test('a K3.1 Pro request names its model and never disables thinking', async () => {
  const provider = createKimiSubscriptionProvider()
  const model = provider.getModels().find(entry => entry.id === 'k3.1-pro')
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'offline test' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  const context = { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }
  for (const reasoning of [undefined, 'low', 'high', 'max']) {
    const options = { apiKey: 'FAKE_SUBSCRIPTION_KEY_FOR_TESTS', fetch, maxRetries: 0, ...reasoning === undefined ? {} : { reasoning } }
    const events = []
    for await (const event of provider.streamSimple(model, context, options)) events.push(event)
    assert.equal(events.at(-1).type, 'error')
  }
  assert.equal(requests.length, 4)
  for (const { url, body } of requests) {
    assert.ok(url.startsWith('https://api.kimi.com/coding/v1/messages'), url)
    assert.equal(body.model, 'k3.1-pro')
  }
  // No level chosen: no thinking field at all, so Kimi applies the model default (high).
  assert.equal(requests[0].body.thinking, undefined)
  assert.equal(requests[0].body.output_config, undefined)
  for (const [index, effort] of [[1, 'low'], [2, 'high'], [3, 'max']]) {
    assert.equal(requests[index].body.thinking.type, 'adaptive')
    assert.deepEqual(requests[index].body.output_config, { effort })
  }
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
  // A dotted ID is named whole, without the period that ends Kimi's sentence.
  const highspeed = explainKimiModelEntitlement(kimiPlanRejection('k3.1-pro-highspeed'))
  assert.match(highspeed, /「k3\.1-pro-highspeed」/u)
  assert.match(highspeed, /"k3\.1-pro-highspeed";/u)
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
