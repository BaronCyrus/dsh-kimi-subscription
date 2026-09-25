import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from 'node:zlib'

/**
 * Kimi Code subscription OAuth, owned by this plugin instead of pi-ai.
 *
 * pi-ai's Kimi provider authenticates with the ambient `fetch`, so its device
 * login and token refresh inherit whatever the host installed — including a
 * proxy dispatcher that hands back still-compressed bodies whose
 * `Content-Encoding` header did not survive. A token response is ~1.5 KB, so
 * it arrives gzip-compressed, fails to parse, and the login dies with an
 * opaque "status 200" failure.
 *
 * This module therefore performs the two OAuth calls itself: every request asks
 * for an identity body, and the response is additionally decoded by its magic
 * number when a header lies or disappears. It is the only part of the plugin
 * that cannot rely on the transport, because it is the part that must work
 * before any credential exists.
 *
 * RFC 8628 device authorization against https://auth.kimi.com, JSON responses,
 * no client secret (public client).
 */

export const KIMI_OAUTH_HOST = 'https://auth.kimi.com'
export const KIMI_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60
const EXCHANGE_MAX_RETRIES = 3
const MAX_DECODED_BYTES = 8 * 1024 * 1024
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** One typed failure so the UI can name the step without seeing provider text. */
export class KimiOAuthError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'KimiOAuthError'
    this.code = code
  }
}

/** Public failure reasons the browser is allowed to see; never provider text. */
const LOGIN_REASON_BY_CODE = Object.freeze({
  'oauth/denied': 'denied',
  'oauth/expired': 'expired',
  'oauth/unreachable': 'unreachable',
  'oauth/exchange': 'exchange',
  'oauth/response': 'response',
  'oauth/network': 'network',
  'oauth/aborted': 'aborted',
})

/**
 * Name the failing step of a login without exposing provider output.
 * pi-ai wraps our errors in `ModelsError`, so the cause chain is walked.
 * @param error - whatever the login rejected with.
 * @returns a public reason token, or undefined when nothing is recognized.
 */
export function classifyKimiOAuthFailure(error) {
  let current = error
  for (let depth = 0; depth < 6 && current !== null && typeof current === 'object'; depth += 1) {
    const reason = LOGIN_REASON_BY_CODE[current.code]
    if (reason !== undefined) return reason
    current = current.cause
  }
  return undefined
}

const formUrlEncode = fields => new URLSearchParams(fields).toString()

const tryJson = text => {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

const inflate = (buffer, kind) => {
  const options = { maxOutputLength: MAX_DECODED_BYTES }
  if (kind === 'gzip') return gunzipSync(buffer, options)
  if (kind === 'deflate') return inflateSync(buffer, options)
  if (kind === 'br') return brotliDecompressSync(buffer, options)
  if (kind === 'zstd' && typeof zstdDecompressSync === 'function') return zstdDecompressSync(buffer, options)
  return undefined
}

/**
 * Parse a response body that may still be compressed.
 *
 * The declared encoding is only a hint: a body is decoded by its magic number
 * first (gzip, zstd) and by its header second, so a proxy that forwards
 * compressed bytes while dropping the header cannot break a token exchange.
 * @param buffer - raw response body.
 * @param headerEncoding - `Content-Encoding` as the response reported it.
 * @returns the parsed object, or undefined when nothing readable came back.
 */
export function decodeJsonBody(buffer, headerEncoding) {
  const direct = tryJson(buffer.toString('utf8'))
  if (direct !== undefined) return direct
  const declared = String(headerEncoding ?? '').trim().toLowerCase()
  const kinds = []
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) kinds.push('gzip')
  else if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)) kinds.push('zstd')
  else if (declared === 'gzip' || declared === 'x-gzip') kinds.push('gzip')
  else if (declared === 'deflate') kinds.push('deflate')
  else if (declared === 'br') kinds.push('br')
  else if (declared === 'zstd') kinds.push('zstd')
  for (const kind of kinds) {
    let decoded
    try {
      decoded = inflate(buffer, kind)
    } catch {
      continue
    }
    if (decoded === undefined) continue
    const parsed = tryJson(decoded.toString('utf8'))
    if (parsed !== undefined) return parsed
  }
  return undefined
}

const abortError = cause => new KimiOAuthError('oauth/aborted', 'Kimi Code authorization was cancelled', { cause })

/** Abort-aware sleep used between device-code polls. */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError(signal.reason))
    return
  }
  const onAbort = () => {
    clearTimeout(timer)
    reject(abortError(signal.reason))
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

const requestSignal = signal => signal === undefined
  ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  : AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])

/**
 * Perform one OAuth request and read its JSON body.
 * @param fetchImpl - transport, resolved per call so a host wrapper swap is followed.
 * @param url - absolute endpoint.
 * @param init - fetch init; headers are completed with the identity request.
 * @param signal - caller cancellation.
 * @returns the response and its parsed body (undefined when unreadable).
 */
async function requestJson(fetchImpl, url, init, signal) {
  let response
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        // Ask for an unencoded body; the decoder above is the fallback, not the plan.
        'accept-encoding': 'identity',
        ...init?.headers,
      },
      signal: requestSignal(signal),
    })
  } catch (error) {
    if (signal?.aborted) throw abortError(error)
    throw new KimiOAuthError('oauth/network', 'Kimi Code authorization could not reach the Kimi authorization server', { cause: error })
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  return { response, payload: decodeJsonBody(buffer, response.headers.get('content-encoding')) }
}

const describeOauthError = payload => {
  const description = typeof payload?.error_description === 'string' ? payload.error_description : ''
  return description === '' ? '' : `: ${description}`
}

function readDeviceAuthorization(payload) {
  const deviceCode = payload?.device_code
  const userCode = payload?.user_code
  const verificationUri = payload?.verification_uri
  const verificationUriComplete = payload?.verification_uri_complete
  if (typeof deviceCode !== 'string' || deviceCode === ''
    || typeof userCode !== 'string' || userCode === ''
    || typeof verificationUri !== 'string' || verificationUri === ''
    || typeof verificationUriComplete !== 'string' || verificationUriComplete === '') {
    throw new KimiOAuthError('oauth/response', 'Kimi Code device authorization response is missing fields')
  }
  const interval = Number(payload.interval)
  const expiresIn = Number(payload.expires_in)
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_POLL_INTERVAL_SECONDS,
    expiresInSeconds: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_SECONDS,
  }
}

/** Read a token response, reusing the previous refresh token when none is rotated in. */
function readToken(payload, operation, previousRefresh) {
  const access = payload?.access_token
  const refresh = typeof payload?.refresh_token === 'string' && payload.refresh_token !== ''
    ? payload.refresh_token
    : previousRefresh
  const expiresIn = Number(payload?.expires_in)
  if (typeof access !== 'string' || access === ''
    || typeof refresh !== 'string' || refresh === ''
    || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new KimiOAuthError('oauth/response', `Kimi Code token ${operation} response is missing fields`)
  }
  return { type: 'oauth', access, refresh, expires: Date.now() + expiresIn * 1000 }
}

/**
 * Build the OAuth methods pi-ai's `Models` drives: `login`, `refresh`, `toAuth`.
 * @param options - transport, host, clock, and sleep overrides for tests.
 * @returns frozen OAuth provider methods.
 */
export function createKimiOAuth({
  fetchImpl = (...args) => globalThis.fetch(...args),
  oauthHost = KIMI_OAUTH_HOST,
  now = Date.now,
  pause = sleep,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Kimi OAuth requires fetch')
  const host = String(oauthHost).replace(/\/+$/u, '')

  const exchange = async (device, signal) => {
    const { response, payload } = await requestJson(fetchImpl, `${host}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formUrlEncode({
        client_id: KIMI_OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: DEVICE_CODE_GRANT,
      }),
    }, signal)
    if (response.ok) {
      if (typeof payload?.access_token === 'string') {
        return { kind: 'token', credential: readToken(payload, 'poll', undefined) }
      }
      throw new KimiOAuthError('oauth/response', `Kimi Code device token response could not be read (status ${response.status})`)
    }
    const error = payload?.error
    if (error === 'authorization_pending') return { kind: 'pending' }
    if (error === 'slow_down') return { kind: 'slow_down' }
    if (error === 'expired_token') {
      throw new KimiOAuthError('oauth/expired', 'Kimi Code device authorization expired. Please restart login.')
    }
    if (error === 'access_denied') {
      throw new KimiOAuthError('oauth/denied', 'Kimi Code login was denied')
    }
    if (payload === undefined) {
      throw new KimiOAuthError('oauth/response', `Kimi Code device token response could not be read (status ${response.status})`)
    }
    const failure = new KimiOAuthError('oauth/exchange', `Kimi Code device token request failed (status ${response.status})${describeOauthError(payload)}`)
    // Only a rate limit or a server fault is worth another poll; a rejected
    // request will be rejected the same way every time.
    failure.retryable = response.status === 429 || response.status >= 500
    throw failure
  }

  const pollForToken = async (device, signal) => {
    const deadline = now() + device.expiresInSeconds * 1000
    let intervalMs = Math.max(1, device.intervalSeconds) * 1000
    let failures = 0
    // The authorization server rejects a poll that arrives before the first interval.
    await pause(intervalMs, signal)
    for (;;) {
      if (signal?.aborted) throw abortError(signal.reason)
      if (now() >= deadline) throw new KimiOAuthError('oauth/expired', 'Kimi Code device authorization expired. Please restart login.')
      let outcome
      try {
        outcome = await exchange(device, signal)
      } catch (error) {
        const retryable = error instanceof KimiOAuthError && error.retryable === true
        if (!retryable || failures >= EXCHANGE_MAX_RETRIES) throw error
        failures += 1
        await pause(1000 * 2 ** (failures - 1), signal)
        continue
      }
      if (outcome.kind === 'token') return outcome.credential
      if (outcome.kind === 'slow_down') intervalMs += 5000
      await pause(intervalMs, signal)
    }
  }

  return Object.freeze({
    name: 'Kimi Code (subscription)',
    isSubscription: true,
    loginLabel: 'Sign in with Kimi Code',

    async login(interaction) {
      const signal = interaction?.signal
      const { response, payload } = await requestJson(fetchImpl, `${host}/api/oauth/device_authorization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formUrlEncode({ client_id: KIMI_OAUTH_CLIENT_ID }),
      }, signal)
      if (!response.ok) {
        throw new KimiOAuthError('oauth/unreachable', `Kimi Code device authorization failed (status ${response.status})${describeOauthError(payload)}`)
      }
      if (payload === undefined) {
        throw new KimiOAuthError('oauth/response', 'Kimi Code device authorization response could not be read')
      }
      const device = readDeviceAuthorization(payload)
      interaction?.notify?.({
        type: 'device_code',
        userCode: device.userCode,
        verificationUri: device.verificationUriComplete,
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: device.expiresInSeconds,
      })
      return await pollForToken(device, signal)
    },

    async refresh(credential, signal) {
      let lastError
      for (let attempt = 0; attempt <= EXCHANGE_MAX_RETRIES; attempt += 1) {
        if (attempt > 0) await pause(1000 * 2 ** (attempt - 1), signal)
        if (signal?.aborted) throw abortError(signal.reason)
        const { response, payload } = await requestJson(fetchImpl, `${host}/api/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formUrlEncode({
            client_id: KIMI_OAUTH_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: credential.refresh,
          }),
        }, signal)
        if (response.ok && typeof payload?.access_token === 'string') {
          return readToken(payload, 'refresh', credential.refresh)
        }
        if (response.status === 401 || response.status === 403 || payload?.error === 'invalid_grant') {
          throw new KimiOAuthError('oauth/refresh-rejected', `Kimi Code token refresh unauthorized (status ${response.status})${describeOauthError(payload)}`)
        }
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < EXCHANGE_MAX_RETRIES) {
          lastError = new KimiOAuthError('oauth/exchange', `Kimi Code token refresh failed with status ${response.status}`)
          continue
        }
        throw new KimiOAuthError('oauth/exchange', `Kimi Code token refresh failed with status ${response.status}${describeOauthError(payload)}`)
      }
      throw lastError ?? new KimiOAuthError('oauth/exchange', 'Kimi Code token refresh failed')
    },

    async toAuth(credential) {
      return { headers: { Authorization: `Bearer ${credential.access}` } }
    },
  })
}
