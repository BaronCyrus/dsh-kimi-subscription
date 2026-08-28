import { PROVIDER } from './constants.js'

const abortIfNeeded = options => options?.signal?.throwIfAborted()
const clone = value => value === undefined ? undefined : structuredClone(value)
const LEGAL_API_KEY = /^[\x21-\x7E]+$/u

function assertProvider(providerId) {
  if (providerId !== PROVIDER) {
    throw new Error(`Kimi credential store does not own provider ${JSON.stringify(providerId)}`)
  }
}

function assertCredential(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') {
    throw new Error('Kimi credential store received a malformed credential')
  }
  if (value.type === 'api_key') {
    if (typeof value.key !== 'string' || value.key.length === 0 || !LEGAL_API_KEY.test(value.key)) {
      throw new Error('Kimi credential store received a malformed API key')
    }
    return { type: 'api_key', key: value.key }
  }
  if (value.type === 'oauth') {
    if (typeof value.access !== 'string' || value.access.length === 0
      || typeof value.refresh !== 'string' || value.refresh.length === 0
      || typeof value.expires !== 'number' || !Number.isFinite(value.expires)) {
      throw new Error('Kimi credential store received a malformed OAuth credential')
    }
    return clone(value)
  }
  throw new Error('Kimi credential store received an unsupported credential type')
}

function parseCredential(value) {
  try {
    return assertCredential(JSON.parse(value))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Kimi credential store received')) throw error
    throw new Error('Kimi credential store contains malformed credential JSON', { cause: error })
  }
}

/** Adapt DSH's managed string credential service to pi-ai's typed store. */
export class DshKimiCredentialStore {
  #chains = new Map()

  constructor(credentials, ref) {
    if (credentials === undefined || credentials === null) {
      throw new Error('Kimi subscription authentication requires the DSH credentials service')
    }
    this.credentials = credentials
    this.ref = ref
  }

  #enqueue(providerId, operation, options) {
    assertProvider(providerId)
    const previous = this.#chains.get(providerId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      abortIfNeeded(options)
      return operation()
    })
    const tail = current.catch(() => undefined)
    this.#chains.set(providerId, tail)
    void tail.finally(() => {
      if (this.#chains.get(providerId) === tail) this.#chains.delete(providerId)
    })
    return current
  }

  async #read(providerId, options) {
    assertProvider(providerId)
    abortIfNeeded(options)
    const hit = await this.credentials.resolve(this.ref)
    abortIfNeeded(options)
    if (hit?.value === undefined || hit.value === '') return undefined
    return parseCredential(hit.value)
  }

  read(providerId, options) {
    return this.#enqueue(providerId, () => this.#read(providerId, options), options)
  }

  async list(options) {
    abortIfNeeded(options)
    const current = await this.read(PROVIDER, options)
    return current === undefined ? [] : [{ providerId: PROVIDER, type: current.type }]
  }

  modify(providerId, update, options) {
    return this.#enqueue(providerId, async () => {
      const current = await this.#read(providerId, options)
      const next = await update(clone(current))
      abortIfNeeded(options)
      if (next === undefined) return current
      const validated = assertCredential(next)
      await this.credentials.set(this.ref, JSON.stringify(validated))
      abortIfNeeded(options)
      return clone(validated)
    }, options)
  }

  delete(providerId, options) {
    return this.#enqueue(providerId, async () => {
      await this.credentials.unset(this.ref)
      abortIfNeeded(options)
    }, options)
  }
}

/** Return only safe account state and bounded credential operations. */
export function createKimiAuthService(models, store) {
  return Object.freeze({
    async status(options) {
      const current = await store.read(PROVIDER, options)
      if (current === undefined) return { authenticated: false, provider: PROVIDER }
      return {
        authenticated: true,
        provider: PROVIDER,
        method: current.type === 'oauth' ? 'oauth' : 'api-key',
        ...(current.type === 'oauth' ? { expiresAt: current.expires } : {}),
      }
    },
    login(interaction) {
      return models.login(PROVIDER, 'oauth', interaction)
    },
    async setApiKey(apiKey, options) {
      abortIfNeeded(options)
      const value = typeof apiKey === 'string' ? apiKey.trim() : ''
      if (value.length === 0 || !LEGAL_API_KEY.test(value)) {
        throw new Error('Kimi Code subscription API key is invalid')
      }
      await store.modify(PROVIDER, async () => ({ type: 'api_key', key: value }), options)
      return this.status(options)
    },
    logout(options) {
      return models.logout(PROVIDER, options)
    },
  })
}
