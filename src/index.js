import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

import { CHANNEL, CREDENTIAL_NAME, DISPLAY_NAME, PROVIDER } from './constants.js'
import { createKimiAuthService, DshKimiCredentialStore } from './credential-store.js'
import { createKimiRpcHandler, KimiLoginCoordinator } from './login-coordinator.js'
import { createKimiSubscriptionProvider, createModels } from './pi-ai-runtime.js'
import { createKimiPluginManager } from './plugin-version.js'
import { createKimiUsageReader, KIMI_USAGE_URL, parseKimiUsage } from './usage.js'

export const name = 'kimi-subscription'
export const inject = ['llm', 'credentials', 'connection', 'attachments']

const CREDENTIAL_REF = credentialRef(CREDENTIAL_NAME)
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

export function apply(ctx) {
  const store = new DshKimiCredentialStore(ctx.credentials, CREDENTIAL_REF)
  const provider = createKimiSubscriptionProvider({
    onAuthRejected: () => store.markAccessRejected(),
  })
  const authContext = Object.freeze({
    // Subscription credentials are explicitly stored by this plugin. Do not
    // silently fall back to a Kimi Open Platform environment credential.
    env: async () => undefined,
    fileExists: async () => false,
  })
  const authModels = createModels({ credentials: store, authContext })
  authModels.setProvider(provider)

  const profile = Object.freeze({
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    piProvider: provider,
    configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: 10 * 60 * 1000,
    maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
    cacheRetention: 'short',
    // A 401 from an expired-in-flight OAuth token is recoverable: the stream
    // guard marks the token rejected, the retry re-resolves auth, and pi-ai
    // refreshes under its serialized lock. Genuinely dead credentials still
    // fail after the retries.
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH'],
    },
  })
  const profiles = new Map([[PROVIDER, profile]])
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      let credential
      try {
        credential = await store.read(PROVIDER)
      } catch (error) {
        throw new LlmError('Kimi Code subscription authorization failed', 'AUTH_FAILED', { cause: error })
      }
      if (credential === undefined) {
        throw new LlmError('Kimi Code subscription is not connected', 'MISSING_CREDENTIAL')
      }
      // API keys can use pi-ai's highest-priority request override. OAuth must
      // stay in the shared store so pi-ai can refresh it and derive headers.
      return credential.type === 'api_key' ? credential.key : undefined
    },
    auth: Object.freeze({ credentials: store, authContext }),
    resolveAttachments: () => ctx.get?.('attachments') ?? ctx.attachments,
  })
  ctx.llm.registerAdapter([PROVIDER], adapter)

  const auth = createKimiAuthService(authModels, store)
  const usageReader = createKimiUsageReader({ getAuth: () => authModels.getAuth(PROVIDER) })
  const pluginManager = createKimiPluginManager()
  const coordinator = new KimiLoginCoordinator(auth)
  const handler = createKimiRpcHandler(coordinator, { usageReader, pluginManager })
  ctx.effect(
    () => ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' }),
    'kimi-subscription: loopback account RPC',
  )
}

export {
  CHANNEL,
  DISPLAY_NAME,
  PROVIDER,
  createKimiAuthService,
  createKimiPluginManager,
  createKimiRpcHandler,
  createKimiSubscriptionProvider,
  createKimiUsageReader,
  DshKimiCredentialStore,
  KIMI_USAGE_URL,
  KimiLoginCoordinator,
  parseKimiUsage,
}
