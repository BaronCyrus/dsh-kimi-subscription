import { WebError } from '@deepseek-ai/dsh-web'

import { PROVIDER } from './constants.js'
import { ambientFetch } from './shared-request.js'
import { authorizationHeader } from './usage.js'

export const KIMI_SEARCH_URL = 'https://api.kimi.com/coding/v1/search'
export const KIMI_SEARCH_PROVIDER_ID = 'kimi-subscription'
export const KIMI_AUTO_SEARCH_PROVIDER_ID = 'kimi-subscription-auto'
export const CODEX_PROVIDER = 'openai-codex'
export const CODEX_AUTO_SEARCH_PROVIDER_ID = 'codex-subscription-auto'
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000
const MAX_SOURCE_DATE = 64

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = value => typeof value === 'string' && value.length > 0 ? value : undefined

const displayText = value => {
  const text = nonEmpty(value)?.replace(/\s+/gu, ' ').trim()
  return text === undefined || text.length === 0 ? undefined : text
}

const boundedDisplayText = (value, maximum) => {
  const text = displayText(value)
  if (text === undefined || text.length <= maximum) return text
  return `${text.slice(0, maximum - 1)}…`
}

function sourceOf(value) {
  if (!record(value)) return undefined
  const url = nonEmpty(value.url)
  if (url === undefined) return undefined
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const title = displayText(value.title) ?? displayText(value.site_name) ?? parsed.hostname
  const snippet = displayText(value.snippet) ?? displayText(value.content)
  const publishedAt = boundedDisplayText(value.date, MAX_SOURCE_DATE)
  return {
    url,
    title,
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

/** Normalize the official /search payload into the DSH citation shape. */
export function parseKimiSearchResponse(value) {
  if (!record(value) || !Array.isArray(value.search_results)) throw new Error('Kimi returned a malformed search response')
  const seen = new Set()
  const sources = []
  for (const result of value.search_results) {
    const source = sourceOf(result)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return { sources, truncated: false }
}

/**
 * Create the DSH web search provider backed only by the Kimi Code
 * subscription /search endpoint. Credentials stay host-side.
 */
export function createKimiSearchProvider({
  getAuth,
  fetchImpl = ambientFetch,
  url = KIMI_SEARCH_URL,
  timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS,
} = {}) {
  if (typeof getAuth !== 'function') throw new Error('Kimi search provider requires getAuth')
  if (typeof fetchImpl !== 'function') throw new Error('Kimi search provider requires fetch')
  return Object.freeze({
    id: KIMI_SEARCH_PROVIDER_ID,
    available: () => true,
    async search(request, signal) {
      signal?.throwIfAborted()
      const resolution = await getAuth()
      const authorization = authorizationHeader(resolution)
      if (authorization === undefined) {
        throw new WebError('Kimi Code subscription is not connected', 'WEB_PROVIDER_CREDENTIAL_MISSING')
      }
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: authorization,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text_query: request.query }),
          signal: requestSignal,
        })
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          throw new WebError('Kimi search aborted', 'WEB_ABORTED', { cause: error })
        }
        throw new WebError('Kimi search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
      }
      if (!response.ok) {
        throw response.status === 401 || response.status === 403
          ? new WebError('Kimi Code subscription sign-in needs to be renewed', 'WEB_PROVIDER_CREDENTIAL_MISSING')
          : new WebError(`Kimi search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
      }
      let value
      try {
        value = await response.json()
      } catch (error) {
        throw new WebError('Kimi returned an unreadable search response', 'WEB_PROVIDER_ERROR', { cause: error })
      }
      try {
        return parseKimiSearchResponse(value)
      } catch (error) {
        throw new WebError('Kimi returned a malformed search response', 'WEB_PROVIDER_ERROR', { cause: error })
      }
    },
  })
}

/**
 * Route each request by its initiating model without changing the user's
 * explicit overrides: Kimi models use the Kimi subscription search, Codex
 * models delegate to the Codex subscription auto provider when it is
 * registered, and every other model falls back to the DSH default provider.
 */
export function createKimiAutoSearchProvider(options) {
  return Object.freeze({
    id: KIMI_AUTO_SEARCH_PROVIDER_ID,
    available: () => true,
    async search(request, signal) {
      if (options.resolveModelProvider?.() === PROVIDER) return options.kimi.search(request, signal)
      const modelProvider = options.resolveModelProvider?.()
      const codex = options.resolveCodexProvider?.()
      if (modelProvider === CODEX_PROVIDER && codex !== undefined && codex.available() === true) {
        return codex.search(request, signal)
      }
      const provider = options.resolveDshProvider?.()
      if (provider === undefined
        || provider.id === KIMI_AUTO_SEARCH_PROVIDER_ID
        || provider.id === KIMI_SEARCH_PROVIDER_ID
        || provider.available() !== true) {
        throw new WebError('DSH default search is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
      }
      return provider.search(request, signal)
    },
  })
}

const WEB_ENTRY_ID = 'web'

/**
 * Mirror the Codex subscription's search-provider switcher: write the chosen
 * provider id into the DSH web runtime's single search slot. The `default`
 * selection is deliberately passive so this plugin never races another
 * subscription plugin for the slot unless the user opted in; switching back
 * to `default` restores whichever provider this switcher took over from.
 */
export function createKimiSearchProviderSwitcher(loader) {
  const webEntry = () => [...loader.entries()].find(entry => entry.options?.id === WEB_ENTRY_ID)
  let captured
  const update = async provider => {
    const entry = webEntry()
    const fiber = entry?.fiber
    if (entry === undefined || fiber === undefined || typeof fiber.update !== 'function') {
      throw new Error('DSH web runtime is unavailable')
    }
    const currentConfig = fiber.config ?? entry.options?.config ?? {}
    if (currentConfig.searchProvider === provider) return
    await fiber.update({ ...currentConfig, searchProvider: provider }, true)
  }
  return Object.freeze({
    async select(selection) {
      const entry = webEntry()
      if (entry === undefined) throw new Error('DSH web runtime is unavailable')
      const currentConfig = entry.fiber?.config ?? entry.options?.config ?? {}
      const ours = currentConfig.searchProvider === KIMI_SEARCH_PROVIDER_ID
        || currentConfig.searchProvider === KIMI_AUTO_SEARCH_PROVIDER_ID
      if (selection === 'kimi' || selection === 'auto') {
        if (!ours && currentConfig.searchProvider !== undefined) captured = currentConfig.searchProvider
        await update(selection === 'kimi' ? KIMI_SEARCH_PROVIDER_ID : KIMI_AUTO_SEARCH_PROVIDER_ID)
        return
      }
      if (ours && captured !== undefined) {
        const restore = captured
        captured = undefined
        await update(restore)
      }
    },
  })
}
