import { randomUUID } from 'node:crypto'

import { PROVIDER } from './constants.js'

const TERMINAL_PHASES = new Set(['authenticated', 'failed', 'cancelled'])
const ALLOWED_AUTH_ORIGINS = new Set(['https://auth.kimi.com', 'https://www.kimi.com', 'https://kimi.com'])
const publicClone = value => structuredClone(value)
const asObject = value => value !== null && typeof value === 'object' ? value : {}
const ok = value => ({ ok: true, value })
const badRequest = message => ({
  ok: false,
  error: { code: 'bad-request', message, details: { issues: [] } },
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Restrict browser-visible login links to official Kimi HTTPS origins. */
export function assertKimiAuthUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Kimi auth URL is invalid')
  }
  if (url.protocol !== 'https:' || !ALLOWED_AUTH_ORIGINS.has(url.origin)
    || url.username !== '' || url.password !== '') {
    throw new Error('Kimi auth URL must use an official Kimi HTTPS origin')
  }
  return url.href
}

/** Own one host-side device-code login without exposing tokens to the client. */
export class KimiLoginCoordinator {
  #sessions = new Map()
  #activeId

  constructor(auth, options = {}) {
    this.auth = auth
    this.createId = options.createId ?? randomUUID
  }

  async accountStatus(options) {
    return publicClone(await this.auth.status(options))
  }

  async start() {
    const active = this.#activeId === undefined ? undefined : this.#sessions.get(this.#activeId)
    if (active !== undefined && !TERMINAL_PHASES.has(active.view.phase)) return this.read(active.view.id)
    if (active !== undefined) this.#sessions.delete(active.view.id)

    const id = this.createId()
    const ready = deferred()
    const controller = new AbortController()
    const session = {
      controller,
      ready,
      view: {
        id,
        provider: PROVIDER,
        phase: 'starting',
        authenticated: false,
      },
    }
    this.#sessions.set(id, session)
    this.#activeId = id

    // A cancelled terminal session may be superseded and removed before the
    // provider's aborted login promise settles. Resolve from this session's
    // public view directly so the old finally handler can never throw.
    const publishReady = () => ready.resolve(publicClone(session.view))
    const interaction = {
      signal: controller.signal,
      prompt: async () => {
        throw new Error('Kimi device login unexpectedly requested interactive input')
      },
      notify: event => {
        if (controller.signal.aborted) return
        if (event.type === 'device_code') {
          const userCode = typeof event.userCode === 'string' ? event.userCode : ''
          if (userCode.length === 0) throw new Error('Kimi device login returned no user code')
          session.view = {
            ...session.view,
            phase: 'waiting_device',
            deviceCode: {
              userCode,
              verificationUri: assertKimiAuthUrl(event.verificationUri),
              ...(typeof event.intervalSeconds === 'number' ? { intervalSeconds: event.intervalSeconds } : {}),
              ...(typeof event.expiresInSeconds === 'number' ? { expiresInSeconds: event.expiresInSeconds } : {}),
            },
          }
        } else {
          session.view = { ...session.view, message: String(event.message ?? '') }
        }
        publishReady()
      },
    }

    session.run = Promise.resolve()
      .then(() => this.auth.login(interaction))
      .then(async () => {
        if (controller.signal.aborted) return
        const status = await this.auth.status()
        session.view = {
          id,
          provider: PROVIDER,
          phase: 'authenticated',
          authenticated: status.authenticated === true,
        }
      })
      .catch(error => {
        if (controller.signal.aborted) {
          session.view = {
            id,
            provider: PROVIDER,
            phase: 'cancelled',
            authenticated: false,
          }
          return
        }
        session.view = {
          id,
          provider: PROVIDER,
          phase: 'failed',
          authenticated: false,
          error: 'Kimi login failed',
        }
        // Provider failures may include credentials. Keep diagnostics host-only.
        session.hostError = error
      })
      .finally(publishReady)

    return ready.promise
  }

  read(id) {
    const session = this.#sessions.get(id)
    if (session === undefined) throw new Error('unknown Kimi login')
    return publicClone(session.view)
  }

  async cancel(id) {
    const session = this.#sessions.get(id)
    if (session === undefined) throw new Error('unknown Kimi login')
    if (!TERMINAL_PHASES.has(session.view.phase)) {
      session.view = {
        id,
        provider: PROVIDER,
        phase: 'cancelled',
        authenticated: false,
      }
      session.controller.abort(new Error('Kimi login cancelled'))
    }
    return this.read(id)
  }

  async setApiKey(value, options) {
    if (this.#activeId !== undefined) {
      const active = this.#sessions.get(this.#activeId)
      if (active !== undefined && !TERMINAL_PHASES.has(active.view.phase)) await this.cancel(active.view.id)
    }
    return this.auth.setApiKey(value, options)
  }

  async logout(options) {
    if (this.#activeId !== undefined) {
      const active = this.#sessions.get(this.#activeId)
      if (active !== undefined && !TERMINAL_PHASES.has(active.view.phase)) await this.cancel(active.view.id)
    }
    await this.auth.logout(options)
    return this.accountStatus(options)
  }
}

/** Map the loopback-only DSH Connection channel onto account and usage services. */
export function createKimiRpcHandler(coordinator, { usageReader } = {}) {
  return async (endpoint, payload, signal) => {
    try {
      signal.throwIfAborted()
      const input = asObject(payload)
      if (endpoint === 'status') return ok(await coordinator.accountStatus({ signal }))
      if (endpoint === 'login/start') return ok(await coordinator.start())
      if (endpoint === 'login/status') return ok(coordinator.read(input.id))
      if (endpoint === 'login/cancel') return ok(await coordinator.cancel(input.id))
      if (endpoint === 'usage') {
        if (usageReader === undefined) throw new Error('Kimi usage is unavailable')
        return ok(await usageReader.read({ force: input.force === true, signal }))
      }
      if (endpoint === 'api-key/set') {
        const status = await coordinator.setApiKey(input.apiKey, { signal })
        usageReader?.invalidate()
        return ok(status)
      }
      if (endpoint === 'logout') {
        const status = await coordinator.logout({ signal })
        usageReader?.invalidate()
        return ok(status)
      }
      return badRequest(`unknown Kimi auth endpoint: ${endpoint}`)
    } catch (error) {
      if (signal.aborted) throw error
      const message = error instanceof Error
        && /^(unknown Kimi|Kimi login|Kimi usage|Kimi Code subscription|Could not read Kimi Code subscription usage)/u.test(error.message)
        ? error.message
        : 'Kimi request failed'
      return badRequest(message)
    }
  }
}
