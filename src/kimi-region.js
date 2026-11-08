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
 *
 * The path of the model API depends on the protocol the installed pi-ai speaks
 * to Kimi Code, so a region names only its API origin and the model base URL
 * comes from pi-ai's catalog (`kimiRegionBaseUrl`).
 */

export const KIMI_REGION_MAINLAND_CN = 'mainland-cn'
export const KIMI_REGION_GLOBAL = 'global'
/** A credential stored before regions existed was always a mainland-China one. */
export const DEFAULT_KIMI_REGION = KIMI_REGION_MAINLAND_CN

const KIMI_REGION_SITES = Object.freeze({
  [KIMI_REGION_MAINLAND_CN]: Object.freeze({
    region: KIMI_REGION_MAINLAND_CN,
    apiOrigin: 'https://api.kimi.com',
    usageUrl: 'https://api.kimi.com/coding/v1/usages',
    searchUrl: 'https://api.kimi.com/coding/v1/search',
    oauthHost: 'https://auth.kimi.com',
    // Where a device sign-in may send the browser.
    authOrigins: Object.freeze(['https://auth.kimi.com', 'https://www.kimi.com', 'https://kimi.com']),
  }),
  [KIMI_REGION_GLOBAL]: Object.freeze({
    region: KIMI_REGION_GLOBAL,
    apiOrigin: 'https://api.kimi.ai',
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

// The model API paths pi-ai has used for Kimi Code: Anthropic Messages under
// /coding up to pi-ai 1.2, OpenAI Chat Completions under /coding/v1 from 1.3.
// DSH 0.2.1 ships pi-ai 1.1.0 and DSH 0.2.2 ships 1.3.0.
const KIMI_CODE_API_PATHS = Object.freeze(['/coding', '/coding/v1'])

/**
 * The model base URL of a region for the protocol the installed pi-ai speaks:
 * the catalog's base URL, which names the mainland-China site, moved to the
 * region's API origin. A catalog base URL outside that site or those paths is
 * refused, so a credential never goes to a path this module does not know.
 * @param region - a stored or requested region; undefined is the default.
 * @param catalogBaseUrl - the base URL of pi-ai's Kimi Code provider.
 * @returns the base URL requests with this region's credential go to.
 */
export function kimiRegionBaseUrl(region, catalogBaseUrl) {
  const site = kimiRegionSite(region)
  const mainland = KIMI_REGION_SITES[DEFAULT_KIMI_REGION].apiOrigin
  const path = typeof catalogBaseUrl === 'string' && catalogBaseUrl.startsWith(mainland)
    ? catalogBaseUrl.slice(mainland.length)
    : undefined
  if (path === undefined || !KIMI_CODE_API_PATHS.includes(path)) {
    throw new Error('The installed pi-ai Kimi provider names an unexpected Kimi Code base URL')
  }
  return `${site.apiOrigin}${path}`
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
  const site = Object.values(KIMI_REGION_SITES)
    .find(entry => KIMI_CODE_API_PATHS.some(path => `${entry.apiOrigin}${path}` === baseUrl))
  if (site === undefined) throw new Error('Kimi Code subscription region is not recognized')
  return site
}

/** Every origin a device sign-in of either region may send the browser to. */
export const KIMI_AUTH_ORIGINS = Object.freeze(Object.values(KIMI_REGION_SITES).flatMap(site => site.authOrigins))
