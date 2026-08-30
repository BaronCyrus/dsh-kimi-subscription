import assert from 'node:assert/strict'
import test from 'node:test'

import { DISPLAY_NAME, PROVIDER } from '../src/constants.js'
import { createKimiSubscriptionProvider, guardKimiStreamAuthRejection } from '../src/pi-ai-runtime.js'

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
