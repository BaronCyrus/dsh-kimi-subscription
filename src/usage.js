export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
export const DEFAULT_USAGE_TTL_MS = 60_000
export const DEFAULT_USAGE_TIMEOUT_MS = 15_000

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = value => structuredClone(value)

function integer(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

function nameFrom(value) {
  return record(value) && typeof value.name === 'string' && value.name.length > 0 ? value.name : undefined
}

function resetAtFrom(value) {
  return record(value) && typeof value.resetTime === 'string' && value.resetTime.length > 0
    ? value.resetTime
    : undefined
}

function normalizeUnit(value) {
  switch (value) {
    case 'TIME_UNIT_MINUTE': return 'minute'
    case 'TIME_UNIT_HOUR': return 'hour'
    case 'TIME_UNIT_DAY': return 'day'
    case 'TIME_UNIT_WEEK': return 'week'
    default: return undefined
  }
}

function windowFrom(value) {
  if (!record(value)) return undefined
  const duration = integer(value.duration)
  const unit = normalizeUnit(value.timeUnit)
  if (duration === undefined || duration <= 0 || unit === undefined) return undefined
  if (unit === 'minute' && duration >= 60 && duration % 60 === 0) {
    return { duration: duration / 60, unit: 'hour' }
  }
  return { duration, unit }
}

function usageRow(value, extra = {}) {
  if (!record(value)) return null
  const used = integer(value.used)
  const limit = integer(value.limit)
  if (used === undefined && limit === undefined) return null
  const normalizedUsed = Math.max(0, used ?? 0)
  const normalizedLimit = Math.max(0, limit ?? 0)
  const remaining = Math.max(0, normalizedLimit - normalizedUsed)
  const remainingPercent = normalizedLimit > 0
    ? Math.max(0, Math.min(100, remaining / normalizedLimit * 100))
    : 0
  return {
    ...(extra.name ?? nameFrom(value) ? { name: extra.name ?? nameFrom(value) } : {}),
    ...(extra.window ? { window: extra.window } : {}),
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining,
    remainingPercent,
    ...(resetAtFrom(value) ? { resetAt: resetAtFrom(value) } : {}),
  }
}

const FIXED_POINT_CENTS = 1_000_000

function fixedPointToCents(value) {
  const cents = value / FIXED_POINT_CENTS
  if (cents > 0 && cents < 1) return 1
  return Math.round(cents)
}

function money(value) {
  if (!record(value)) return null
  const cents = integer(value.priceInCents)
  if (cents === undefined) return null
  return {
    cents,
    currency: typeof value.currency === 'string' && value.currency.length > 0 ? value.currency : '',
  }
}

function boosterWallet(value) {
  if (!record(value) || !record(value.balance) || value.balance.type !== 'BOOSTER') return null
  const amount = integer(value.balance.amount)
  if (amount === undefined || amount <= 0) return null
  const amountLeft = integer(value.balance.amountLeft)
  const monthlyLimit = money(value.monthlyChargeLimit)
  const monthlyUsed = money(value.monthlyUsed)
  return {
    balanceCents: amountLeft === undefined ? 0 : fixedPointToCents(amountLeft),
    totalCents: fixedPointToCents(amount),
    monthlyChargeLimitEnabled: value.monthlyChargeLimitEnabled === true,
    monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
    monthlyUsedCents: monthlyUsed?.cents ?? 0,
    currency: monthlyLimit?.currency || monthlyUsed?.currency || 'USD',
  }
}

/** Normalize the official /usages payload into small client-owned JSON. */
export function parseKimiUsage(payload) {
  if (!record(payload)) return { summary: null, limits: [], extraUsage: null }
  let summary = usageRow(payload.usage)
  if (summary !== null && summary.window === undefined) {
    summary = { ...summary, window: { duration: 1, unit: 'week' } }
  }
  const limits = []
  if (Array.isArray(payload.limits)) {
    for (const item of payload.limits) {
      if (!record(item)) continue
      const row = usageRow(item.detail, {
        name: nameFrom(item),
        window: windowFrom(item.window),
      })
      if (row !== null) limits.push(row)
    }
  }
  return {
    summary,
    limits,
    extraUsage: boosterWallet(payload.boosterWallet),
  }
}

function authorizationHeader(resolution) {
  const auth = resolution?.auth
  if (!record(auth)) return undefined
  if (typeof auth.apiKey === 'string' && auth.apiKey.length > 0) return `Bearer ${auth.apiKey}`
  if (!record(auth.headers)) return undefined
  for (const [name, value] of Object.entries(auth.headers)) {
    if (name.toLowerCase() === 'authorization' && typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function statusError(status) {
  if (status === 401) return new Error('Kimi Code subscription sign-in needs to be renewed')
  if (status === 402 || status === 403) return new Error('Kimi Code subscription quota is currently unavailable')
  return new Error('Could not read Kimi Code subscription usage')
}

/** Cached, single-flight usage reader. Credentials and response bodies stay host-only. */
export function createKimiUsageReader({
  getAuth,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  url = KIMI_USAGE_URL,
  ttlMs = DEFAULT_USAGE_TTL_MS,
  timeoutMs = DEFAULT_USAGE_TIMEOUT_MS,
} = {}) {
  if (typeof getAuth !== 'function') throw new Error('Kimi usage reader requires getAuth')
  if (typeof fetchImpl !== 'function') throw new Error('Kimi usage reader requires fetch')
  let cached
  let inFlight
  let generation = 0

  const load = async signal => {
    signal?.throwIfAborted()
    const resolution = await getAuth()
    const authorization = authorizationHeader(resolution)
    if (authorization === undefined) throw new Error('Kimi Code subscription is not connected')
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const response = await fetchImpl(url, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      redirect: 'error',
      signal: requestSignal,
    })
    if (!response.ok) throw statusError(response.status)
    const payload = await response.json()
    return { ...parseKimiUsage(payload), fetchedAt: now() }
  }

  return Object.freeze({
    async read({ force = false, signal } = {}) {
      signal?.throwIfAborted()
      if (!force && cached !== undefined && now() - cached.fetchedAt < ttlMs) return clone(cached)
      const observedGeneration = generation
      if (!force && inFlight !== undefined) return clone(await inFlight)
      const pending = load(signal).then(value => {
        if (generation === observedGeneration) cached = value
        return value
      })
      if (!force) inFlight = pending
      try {
        return clone(await pending)
      } finally {
        if (inFlight === pending) inFlight = undefined
      }
    },
    invalidate() {
      generation += 1
      cached = undefined
    },
  })
}
