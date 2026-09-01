import { homedir } from 'node:os'
import { join } from 'node:path'

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import z from '@deepseek-ai/schemastery'

import { CHANNEL, CREDENTIAL_NAME, DISPLAY_NAME, PROVIDER } from './constants.js'
import { createKimiAuthService, DshKimiCredentialStore } from './credential-store.js'
import {
  CODEX_AUTO_SEARCH_PROVIDER_ID,
  createKimiAutoSearchProvider,
  createKimiSearchProvider,
  createKimiSearchProviderSwitcher,
  KIMI_AUTO_SEARCH_PROVIDER_ID,
  KIMI_SEARCH_PROVIDER_ID,
  resolveDshSearchProviderId,
} from './kimi-search.js'
import { createKimiRpcHandler, KimiLoginCoordinator } from './login-coordinator.js'
import { createKimiSubscriptionProvider, createModels } from './pi-ai-runtime.js'
import { createKimiPluginManager, findInstall } from './plugin-version.js'
import { createKimiSearchComposition } from './search-composition.js'
import { createKimiUsageReader, KIMI_USAGE_URL, parseKimiUsage } from './usage.js'

export const name = 'kimi-subscription'
export const inject = ['llm', 'credentials', 'connection', 'attachments', 'web', 'settings', 'loader']

const CREDENTIAL_REF = credentialRef(CREDENTIAL_NAME)
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

export const SETTINGS_NAMESPACE = 'kimi-subscription'
export const SEARCH_PROVIDER_FIELD = 'searchProvider'
export const SEARCH_PROVIDER_DEFAULT = 'default'
export const SEARCH_PROVIDER_AUTO = 'auto'
export const SEARCH_PROVIDER_KIMI = 'kimi'
const SEARCH_PROVIDER_CHOICES = [SEARCH_PROVIDER_DEFAULT, SEARCH_PROVIDER_AUTO, SEARCH_PROVIDER_KIMI]
const DSH_SEARCH_PROVIDER_FALLBACK = 'deepseek-official'
const WEB_ENTRY_ID = 'web'

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

  const settings = ctx.settings.register(SETTINGS_NAMESPACE, z.object({
    [SEARCH_PROVIDER_FIELD]: z.union(SEARCH_PROVIDER_CHOICES).default(SEARCH_PROVIDER_DEFAULT),
  }))
  const currentAgent = () => ctx.get?.('agents')?.currentInitiator?.()
  const kimiSearch = createKimiSearchProvider({ getAuth: () => authModels.getAuth(PROVIDER) })
  ctx.web.registerSearchProvider(kimiSearch)
  const webEntry = () => [...ctx.loader.entries()].find(entry => entry.options?.id === WEB_ENTRY_ID)
  const dshSearchProviderId = () => {
    const baseConfig = webEntry()?.options?.config ?? {}
    return typeof baseConfig.searchProvider === 'string' && baseConfig.searchProvider.length > 0
      ? baseConfig.searchProvider
      : DSH_SEARCH_PROVIDER_FALLBACK
  }
  ctx.web.registerSearchProvider(createKimiAutoSearchProvider({
    kimi: kimiSearch,
    resolveModelProvider: () => currentAgent()?.session.requestContext?.()?.provider,
    resolveCodexProvider: () => ctx.web.searchProviders?.get(CODEX_AUTO_SEARCH_PROVIDER_ID),
    resolveDshProvider: () => ctx.web.searchProviders?.get(resolveDshSearchProviderId(dshSearchProviderId())),
  }))
  // The Codex subscription plugin's switcher re-writes its own selection
  // whenever the web runtime restarts; never contest the slot while its
  // providers are registered. Instead, route through the web row's BASE
  // config: write this plugin's marked patch block into the owning profile's
  // cordis.patch.yml (the boot layer hot-applies it), so the Codex auto
  // router falls back to kimi-subscription-auto for non-Codex models.
  const codexManagesSearch = () => ctx.web.searchProviders?.has(CODEX_AUTO_SEARCH_PROVIDER_ID) === true
  const searchSwitcher = createKimiSearchProviderSwitcher(ctx.loader, {
    isForeignManaged: codexManagesSearch,
    logger: ctx.logger,
  })
  const dshHome = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const ownPackageJsonUrl = new URL('../package.json', import.meta.url)
  const searchComposition = createKimiSearchComposition({
    dshHome,
    findProfile: async () => (await findInstall({ dshHome, ownPackageJsonUrl })).profile,
    readBaseConfig: () => webEntry()?.options?.config ?? {},
  })
  const searchPreference = Object.freeze({
    get: () => settings.get()[SEARCH_PROVIDER_FIELD],
    writable: () => ctx.settings.writable !== false,
    codexDetected: codexManagesSearch,
    set: async value => {
      if (!SEARCH_PROVIDER_CHOICES.includes(value)) throw new Error('Invalid search provider preference')
      await settings.update({ [SEARCH_PROVIDER_FIELD]: value })
    },
  })
  ctx.effect(() => {
    const select = value => {
      const selection = value[SEARCH_PROVIDER_FIELD]
      let task
      if (codexManagesSearch()) {
        // The Codex plugin owns the runtime slot; steer its fallback through
        // the profile patch instead of contesting the slot.
        task = selection === SEARCH_PROVIDER_DEFAULT
          ? searchComposition.remove()
          : searchComposition.apply(selection === SEARCH_PROVIDER_KIMI ? KIMI_SEARCH_PROVIDER_ID : KIMI_AUTO_SEARCH_PROVIDER_ID)
      } else {
        // No foreign switcher: take or restore the runtime slot directly, and
        // drop any stale patch block left from a previous Codex coexistence.
        task = searchComposition.remove().finally(() => searchSwitcher.select(selection))
      }
      Promise.resolve(task).catch(error => {
        ctx.logger?.warn?.('could not apply the configured web search provider: %s', error.message)
      })
    }
    select(settings.get())
    return settings.watch(select)
  }, 'kimi-subscription: search provider selection')

  const handler = createKimiRpcHandler(coordinator, { usageReader, pluginManager, searchPreference })
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
  createKimiAutoSearchProvider,
  createKimiPluginManager,
  createKimiRpcHandler,
  createKimiSearchProvider,
  createKimiSearchProviderSwitcher,
  createKimiSubscriptionProvider,
  createKimiUsageReader,
  DshKimiCredentialStore,
  KIMI_USAGE_URL,
  KimiLoginCoordinator,
  parseKimiUsage,
}
export { KIMI_AUTO_SEARCH_PROVIDER_ID, KIMI_SEARCH_PROVIDER_ID, KIMI_SEARCH_URL, parseKimiSearchResponse } from './kimi-search.js'
