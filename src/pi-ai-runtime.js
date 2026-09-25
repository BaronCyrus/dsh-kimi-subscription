import { kimiCodingProvider as createKimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'

import { DISPLAY_NAME, PROVIDER } from './constants.js'
import { createKimiOAuth } from './kimi-oauth.js'

export { createModels } from '@earendil-works/pi-ai'
export { createKimiOAuth, KimiOAuthError, classifyKimiOAuthFailure } from './kimi-oauth.js'

const AUTH_REJECTION = /\b401\b|invalid_authentication/iu

const isAuthRejection = error => AUTH_REJECTION.test(String(error?.message ?? error))

// Kimi Code gates models by membership tier and answers a request for a model
// the plan does not include with HTTP 401. The host classifies any 401 as an
// authentication failure and its chat surface then replaces the text with
// "API key is invalid", so the user reads a credential problem where there is a
// plan limit. These two patterns are the parts of Kimi's answer that survive
// that, and the sentence below is what the user sees instead.
const MODEL_ACCESS_REJECTION = /does not have access to\s+["'“]?([A-Za-z0-9][A-Za-z0-9._-]*)/iu
const TIER_REJECTION = /higher-tier Kimi Code plans|kimi\.com\/code\?from=/iu
const FALLBACK_MODEL = 'kimi-for-coding'

/**
 * Explain a Kimi plan rejection for a model this subscription cannot call.
 *
 * The replacement sentence must not read as any other failure the host knows:
 * it deliberately carries no HTTP status and none of the words the classifier
 * matches for quota, rate limits, timeouts, or transport faults. That keeps the
 * failure out of the authentication category — and out of its retry policy,
 * which cannot help here — so the sentence reaches the user verbatim.
 * @param message - provider failure text, as the host would classify it.
 * @returns the replacement sentence, or undefined when this is a different failure.
 */
export function explainKimiModelEntitlement(message) {
  const text = typeof message === 'string' ? message : ''
  if (text === '') return undefined
  const match = MODEL_ACCESS_REJECTION.exec(text)
  const model = match === null ? undefined : match[1].replace(/[.\-_]+$/u, '')
  if (model === undefined && !TIER_REJECTION.test(text)) return undefined
  const subject = model === undefined
    ? '当前 Kimi Code 订阅档位不包含本次请求的模型'
    : `当前 Kimi Code 订阅档位不包含模型「${model}」`
  const named = model === undefined ? 'this model' : `"${model}"`
  return `${subject}，请改用 ${FALLBACK_MODEL}（K2.8 Preview），或升级 Kimi Code 档位。这不是密钥或登录问题。`
    + ` / Your Kimi Code plan does not include ${named}; select ${FALLBACK_MODEL} (K2.8 Preview)`
    + ' or upgrade your plan. This is a plan limit, not a credential problem.'
}

const TERMINAL_EVENTS = new Set(['error', 'done'])

/**
 * Replace a plan rejection inside a terminal pi-ai event.
 *
 * pi-ai reports failures as terminal events carrying the assistant message that
 * holds `errorMessage`; the host reads that field to classify the failure, so
 * rewriting it here is what changes both the wording and the category.
 * @param event - one event yielded by a pi-ai stream.
 * @returns the same event, or a copy whose carrier explains the plan limit.
 */
function explainEntitlementEvent(event) {
  if (event === null || typeof event !== 'object' || !TERMINAL_EVENTS.has(event.type)) return event
  for (const key of ['error', 'message']) {
    const carrier = event[key]
    if (carrier === null || typeof carrier !== 'object') continue
    const explained = explainKimiModelEntitlement(carrier.errorMessage)
    if (explained === undefined) continue
    return { ...event, [key]: { ...carrier, errorMessage: explained } }
  }
  return event
}

// Kimi Code upgraded `kimi-for-coding` in place to K2.8 Preview: 1M context
// for all membership tiers and low/high/max thinking levels (default max).
// pi-ai's bundled catalog still describes K2.7 Code, so patch the stale
// fields until the upstream catalog catches up.
// https://www.kimi.com/code/docs/kimi-code/models.html
const K28_PREVIEW_THINKING_LEVEL_MAP = Object.freeze({
  off: null,
  minimal: null,
  low: 'low',
  medium: null,
  high: 'high',
  xhigh: null,
  max: 'max',
})
const K28_PREVIEW_MODEL_PATCH = Object.freeze({
  name: 'Kimi K2.8 Preview',
  contextWindow: 1048576,
  thinkingLevelMap: K28_PREVIEW_THINKING_LEVEL_MAP,
})

const withK28PreviewMetadata = model =>
  model.id === 'kimi-for-coding' ? Object.freeze({ ...model, ...K28_PREVIEW_MODEL_PATCH }) : model

/**
 * Observe a pi-ai event stream and report an upstream authentication
 * rejection (HTTP 401) that occurs before any chunk was produced. Mid-stream
 * failures do not mark the token: the request had already been accepted.
 * All other stream behavior, including `.result()`, passes through untouched.
 */
export function guardKimiStreamAuthRejection(stream, onAuthRejected) {
  if (stream === null || typeof stream !== 'object') return stream
  let observed = false
  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const iterator = Reflect.get(target, Symbol.asyncIterator).call(target)
          return {
            next: async (...args) => {
              try {
                const item = await iterator.next(...args)
                observed = true
                if (item === null || typeof item !== 'object' || item.done === true) return item
                const value = explainEntitlementEvent(item.value)
                return value === item.value ? item : { ...item, value }
              } catch (error) {
                if (!observed && isAuthRejection(error)) onAuthRejected?.()
                throw error
              }
            },
            ...(typeof iterator.return === 'function' ? { return: (...args) => iterator.return(...args) } : {}),
            ...(typeof iterator.throw === 'function' ? { throw: (...args) => iterator.throw(...args) } : {}),
          }
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Reuse pi-ai's Kimi Code protocol, catalog, and API-key resolution while
 * giving the DSH subscription route an identity distinct from the generic
 * kimi-coding route. API-key and OAuth auth are both subscription
 * credentials; ambient Kimi platform credentials are disabled by the plugin's
 * auth context.
 *
 * OAuth is this plugin's own implementation (`./kimi-oauth.js`): pi-ai's uses
 * the ambient transport, which cannot be relied on to deliver an unencoded
 * body while no credential exists yet.
 */
export function createKimiSubscriptionProvider({ onAuthRejected, oauth, fetchImpl, oauthHost } = {}) {
  const base = createKimiCodingProvider()
  if (base.auth?.oauth === undefined || base.auth?.apiKey === undefined) {
    throw new Error('The installed pi-ai Kimi provider does not expose the required subscription authentication methods')
  }
  const subscriptionOAuth = oauth ?? createKimiOAuth({
    ...fetchImpl === undefined ? {} : { fetchImpl },
    ...oauthHost === undefined ? {} : { oauthHost },
  })
  const models = Object.freeze(base.getModels().map(model => Object.freeze({
    ...withK28PreviewMetadata(model),
    provider: PROVIDER,
  })))
  return Object.freeze({
    id: PROVIDER,
    name: DISPLAY_NAME,
    baseUrl: base.baseUrl,
    headers: base.headers,
    auth: Object.freeze({
      apiKey: base.auth.apiKey,
      oauth: subscriptionOAuth,
    }),
    getModels: () => models,
    stream: (model, context, options) => guardKimiStreamAuthRejection(base.stream(model, context, options), onAuthRejected),
    streamSimple: (model, context, options) => guardKimiStreamAuthRejection(base.streamSimple(model, context, options), onAuthRejected),
  })
}

export const PI_AI_RUNTIME_VERSION = '0.85.1'
