import { spawn } from 'node:child_process'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ambientFetch, waitForSharedRequest } from './shared-request.js'

export const PACKAGE_NAME = 'dsh-kimi-subscription'
export const NPM_REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
export const DEFAULT_VERSION_TTL_MS = 5 * 60_000
export const DEFAULT_VERSION_TIMEOUT_MS = 10_000
export const DEFAULT_UPDATE_TIMEOUT_MS = 180_000

const clone = value => structuredClone(value)

/** Parse a strict `x.y.z[-pre][+build]` version; anything else is undefined. */
export function parseSemver(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim())
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] }
}

/** Compare two versions: -1/0/1, or undefined when either side is not semver. */
export function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (left === undefined || right === undefined) return undefined
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1
  return left.pre < right.pre ? -1 : 1
}

/**
 * Classify how the running package reached the profile. Only registry specs
 * may be updated in place through `dsh plugin add <name>@<version>`; local
 * checkouts (`link:`/`file:`) belong to the owner's iteration workflow.
 */
function classifySpec(spec) {
  if (typeof spec !== 'string' || spec === '') return 'unknown'
  if (/^(?:link|file):/u.test(spec)) return 'link'
  if (/^(?:\d|[~^*])/u.test(spec)) return 'npm'
  return 'unknown'
}

const readManifest = async path => {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Find the profile that owns this running installation by matching the
 * realpath of each profile's installed package against our own package.json
 * (pnpm symlinks resolve identically on both sides). When no realpath matches,
 * fall back to the only profile that declares the dependency at all.
 */
export async function findInstall({ dshHome, ownPackageJsonUrl }) {
  let ownReal
  try {
    ownReal = await realpath(fileURLToPath(ownPackageJsonUrl))
  } catch {
    ownReal = undefined
  }
  let entries = []
  try {
    entries = await readdir(join(dshHome, 'profiles'), { withFileTypes: true })
  } catch {
    entries = []
  }
  const declared = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const profileDir = join(dshHome, 'profiles', entry.name)
    const spec = (await readManifest(join(profileDir, 'package.json')))?.dependencies?.[PACKAGE_NAME]
    if (typeof spec !== 'string') continue
    declared.push({ profile: entry.name, spec })
    if (ownReal === undefined) continue
    try {
      const installed = await realpath(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))
      if (installed === ownReal) return { kind: classifySpec(spec), profile: entry.name }
    } catch {
      // The package is declared but not resolvable in this profile.
    }
  }
  if (declared.length === 1) return { kind: classifySpec(declared[0].spec), profile: declared[0].profile }
  return { kind: 'unknown' }
}

/** Run the dsh CLI host-side; output stays host-side and is never returned. */
function spawnRunCommand(argv, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Kimi plugin update aborted'))
      return
    }
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('Kimi plugin update timed out')), timeoutMs)
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal })
    } catch (error) {
      settle(reject, error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-8192) })
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
    child.on('error', error => settle(reject, error))
    child.on('close', code => {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        settle(reject, reason instanceof Error ? reason : new Error('Kimi plugin update aborted'))
        return
      }
      settle(resolve, { code: code ?? 1, stdout, stderr })
    })
  })
}

/**
 * Owns the plugin's version self-knowledge: the running version from its own
 * package.json, the latest npm registry version, which DSH profile installed
 * it, and registry-spec updates executed through the `dsh plugin` CLI.
 * Registry responses and CLI output stay host-only; only the small owned
 * projection crosses RPC.
 */
export function createKimiPluginManager({
  fetchImpl = ambientFetch,
  runCommand = spawnRunCommand,
  execPath = process.execPath,
  binPath = process.argv[1],
  env = process.env,
  ownPackageJsonUrl = new URL('../package.json', import.meta.url),
  registryUrl = NPM_REGISTRY_LATEST_URL,
  now = Date.now,
  ttlMs = DEFAULT_VERSION_TTL_MS,
  timeoutMs = DEFAULT_VERSION_TIMEOUT_MS,
  updateTimeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Kimi plugin manager requires fetch')
  if (typeof runCommand !== 'function') throw new Error('Kimi plugin manager requires runCommand')
  const dshHome = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  let cached
  let inFlight
  let generation = 0
  let updating = false

  const fetchLatest = async signal => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    let response
    try {
      response = await fetchImpl(registryUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: requestSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error('Kimi plugin version check failed')
    }
    if (!response.ok) throw new Error('Kimi plugin version check failed')
    let version
    try {
      version = (await response.json())?.version
    } catch {
      version = undefined
    }
    if (parseSemver(version) === undefined) throw new Error('Kimi plugin version check failed')
    return version
  }

  const readOwnVersion = async () => {
    const version = (await readManifest(fileURLToPath(ownPackageJsonUrl)))?.version
    if (parseSemver(version) === undefined) throw new Error('Kimi plugin version is unavailable')
    return version
  }

  const load = async signal => {
    signal?.throwIfAborted()
    const [current, install, latest] = await Promise.all([
      readOwnVersion(),
      findInstall({ dshHome, ownPackageJsonUrl }),
      fetchLatest(signal),
    ])
    return {
      current,
      latest,
      updateAvailable: compareSemver(latest, current) === 1,
      install,
      fetchedAt: now(),
    }
  }

  return Object.freeze({
    async read({ force = false, signal } = {}) {
      signal?.throwIfAborted()
      if (!force && cached !== undefined && now() - cached.fetchedAt < ttlMs) return clone(cached)
      const createPending = requestSignal => {
        const observedGeneration = generation
        return load(requestSignal).then(value => {
          if (generation === observedGeneration) cached = value
          return value
        })
      }
      if (force) return clone(await createPending(signal))
      const pending = inFlight ?? createPending()
      if (inFlight === undefined) {
        inFlight = pending
        const clear = () => {
          if (inFlight === pending) inFlight = undefined
        }
        void pending.then(clear, clear)
      }
      return clone(await waitForSharedRequest(pending, signal))
    },

    async update({ signal } = {}) {
      signal?.throwIfAborted()
      if (updating) throw new Error('Kimi plugin update is already running')
      updating = true
      try {
        const install = await findInstall({ dshHome, ownPackageJsonUrl })
        if (install.kind === 'link') throw new Error('Kimi plugin is installed from a local checkout')
        if (install.kind !== 'npm' || install.profile === undefined) {
          throw new Error('Kimi plugin update could not find the owning profile')
        }
        const latest = await fetchLatest(signal)
        const argv = binPath === undefined
          ? ['dsh', 'plugin', '--profile', install.profile, 'add', `${PACKAGE_NAME}@${latest}`]
          : [execPath, binPath, 'plugin', '--profile', install.profile, 'add', `${PACKAGE_NAME}@${latest}`]
        let result
        try {
          result = await runCommand(argv, { signal, timeoutMs: updateTimeoutMs })
        } catch (error) {
          if (signal?.aborted) throw error
          throw new Error('Kimi plugin update failed')
        }
        if (result.code !== 0) throw new Error('Kimi plugin update failed')
        generation += 1
        cached = undefined
        return { version: latest, profile: install.profile }
      } finally {
        updating = false
      }
    },

    invalidate() {
      generation += 1
      cached = undefined
    },
  })
}
