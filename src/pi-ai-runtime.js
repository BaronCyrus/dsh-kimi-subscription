import { kimiCodingProvider as createKimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'

import { DISPLAY_NAME, PROVIDER } from './constants.js'

export { createModels } from '@earendil-works/pi-ai'

const AUTH_REJECTION = /\b401\b|invalid_authentication/iu

const isAuthRejection = error => AUTH_REJECTION.test(String(error?.message ?? error))

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
                return item
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
 * Reuse pi-ai's Kimi Code protocol, catalog, OAuth flow, and auth refresh while
 * giving the DSH subscription route an identity distinct from kimi-coding API
 * configuration. API-key and OAuth auth are both subscription credentials;
 * ambient Kimi platform credentials are disabled by the plugin's auth context.
 */
export function createKimiSubscriptionProvider({ onAuthRejected } = {}) {
  const base = createKimiCodingProvider()
  if (base.auth?.oauth === undefined || base.auth?.apiKey === undefined) {
    throw new Error('The installed pi-ai Kimi provider does not expose the required subscription authentication methods')
  }
  const models = Object.freeze(base.getModels().map(model => Object.freeze({
    ...model,
    provider: PROVIDER,
  })))
  return Object.freeze({
    id: PROVIDER,
    name: DISPLAY_NAME,
    baseUrl: base.baseUrl,
    headers: base.headers,
    auth: Object.freeze({
      apiKey: base.auth.apiKey,
      oauth: base.auth.oauth,
    }),
    getModels: () => models,
    stream: (model, context, options) => guardKimiStreamAuthRejection(base.stream(model, context, options), onAuthRejected),
    streamSimple: (model, context, options) => guardKimiStreamAuthRejection(base.streamSimple(model, context, options), onAuthRejected),
  })
}

export const PI_AI_RUNTIME_VERSION = '0.82.1'
