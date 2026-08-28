import { kimiCodingProvider as createKimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'

import { DISPLAY_NAME, PROVIDER } from './constants.js'

export { createModels } from '@earendil-works/pi-ai'

/**
 * Reuse pi-ai's Kimi Code protocol, catalog, OAuth flow, and auth refresh while
 * giving the DSH subscription route an identity distinct from kimi-coding API
 * configuration. API-key and OAuth auth are both subscription credentials;
 * ambient Kimi platform credentials are disabled by the plugin's auth context.
 */
export function createKimiSubscriptionProvider() {
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
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  })
}

export const PI_AI_RUNTIME_VERSION = '0.82.1'
