/**
 * Kimi Code runs two sites, and a membership belongs to one of them: the
 * mainland-China site on kimi.com and the international site on kimi.ai. Each
 * has its own API host and its own authorization server; the OAuth client is
 * shared. Like the official Kimi Code client, this plugin keeps the region
 * with the credential: an API key or a sign-in records the region it was
 * connected to, and every request made with it goes to that region's hosts.
 *
 * https://www.kimi.com/code/docs/kimi-code/models.html lists both API hosts;
 * MoonshotAI/kimi-code packages/oauth/src/region.ts lists both authorization
 * servers and sites. The region IDs are the official client's.
 */

export const KIMI_REGION_MAINLAND_CN = 'mainland-cn'
export const KIMI_REGION_GLOBAL = 'global'
/** A credential stored before regions existed was always a mainland-China one. */
export const DEFAULT_KIMI_REGION = KIMI_REGION_MAINLAND_CN

const KIMI_REGION_SITES = Object.freeze({
  [KIMI_REGION_MAINLAND_CN]: Object.freeze({
    region: KIMI_REGION_MAINLAND_CN,
    // The Anthropic-compatible base; pi-ai appends /v1/messages.
    baseUrl: 'https://api.kimi.com/coding',
    usageUrl: 'https://api.kimi.com/coding/v1/usages',
    searchUrl: 'https://api.kimi.com/coding/v1/search',
    oauthHost: 'https://auth.kimi.com',
    // Where a device sign-in may send the browser.
    authOrigins: Object.freeze(['https://auth.kimi.com', 'https://www.kimi.com', 'https://kimi.com']),
  }),
  [KIMI_REGION_GLOBAL]: Object.freeze({
    region: KIMI_REGION_GLOBAL,
    baseUrl: 'https://api.kimi.ai/coding',
    usageUrl: 'https://api.kimi.ai/coding/v1/usages',
    searchUrl: 'https://api.kimi.ai/coding/v1/search',
    oauthHost: 'https://auth.kimi.ai',
    authOrigins: Object.freeze(['https://auth.kimi.ai', 'https://www.kimi.ai', 'https://kimi.ai']),
  }),
})

export const KIMI_REGIONS = Object.freeze(Object.keys(KIMI_REGION_SITES))

/**
 * Validate a region ID.
 * @param value - a stored or requested region; undefined is the default.
 * @returns the region ID.
 */
export function kimiRegionOf(value) {
  if (value === undefined) return DEFAULT_KIMI_REGION
  if (typeof value !== 'string' || !Object.hasOwn(KIMI_REGION_SITES, value)) {
    throw new Error('Kimi Code subscription region is invalid')
  }
  return value
}

/** The fixed hosts of one region. */
export function kimiRegionSite(region) {
  return KIMI_REGION_SITES[kimiRegionOf(region)]
}

/**
 * The region an auth resolution sends requests to, read from the base URL the
 * provider put in it. Usage and search follow the model requests this way,
 * from the same credential read. A base URL outside the table is refused, so
 * a credential never goes to a host this table does not name.
 * @param auth - `resolution.auth` from pi-ai's `getAuth`.
 * @returns the region's fixed hosts.
 */
export function kimiRegionSiteOfAuth(auth) {
  const baseUrl = auth?.baseUrl
  if (baseUrl === undefined) return KIMI_REGION_SITES[DEFAULT_KIMI_REGION]
  const site = Object.values(KIMI_REGION_SITES).find(entry => entry.baseUrl === baseUrl)
  if (site === undefined) throw new Error('Kimi Code subscription region is not recognized')
  return site
}

/** Every origin a device sign-in of either region may send the browser to. */
export const KIMI_AUTH_ORIGINS = Object.freeze(Object.values(KIMI_REGION_SITES).flatMap(site => site.authOrigins))
