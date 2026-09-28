import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { createKimiRpcHandler } from '../src/login-coordinator.js'
import {
  compareSemver,
  createKimiPluginManager,
  NPM_REGISTRY_LATEST_URL,
  PACKAGE_NAME,
  parseSemver,
  resolvePnpm,
} from '../src/plugin-version.js'

const writeManifest = async (path, manifest) => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(manifest))
}

/** Fake DSH home whose `web` profile installed the package from the registry. */
async function npmInstall(root, version = '0.3.3') {
  const installedDir = join(root, 'profiles', 'web', 'node_modules', PACKAGE_NAME)
  await writeManifest(join(root, 'profiles', 'web', 'package.json'), {
    dependencies: { [PACKAGE_NAME]: version },
  })
  await writeManifest(join(installedDir, 'package.json'), { name: PACKAGE_NAME, version })
  return pathToFileURL(join(installedDir, 'package.json'))
}

/** Fake DSH home whose `web` profile links a local checkout. */
async function linkInstall(root, version = '0.3.3') {
  const checkout = join(root, 'checkout')
  await writeManifest(join(checkout, 'package.json'), { name: PACKAGE_NAME, version })
  await writeManifest(join(root, 'profiles', 'web', 'package.json'), {
    dependencies: { [PACKAGE_NAME]: 'link:../../checkout' },
  })
  const modules = join(root, 'profiles', 'web', 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(checkout, join(modules, PACKAGE_NAME), 'dir')
  return pathToFileURL(join(checkout, 'package.json'))
}

const registryOk = (version, observe) => async (url, init) => {
  observe?.(url, init)
  return { ok: true, status: 200, async json() { return { version } } }
}

test('version check asks the registry for an uncompressed document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-encoding-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.2.10')
  const original = globalThis.fetch
  let acceptEncoding
  globalThis.fetch = async (_url, init) => {
    acceptEncoding = new Headers(init?.headers).get('accept-encoding')
    if (acceptEncoding !== 'identity') {
      return { ok: true, status: 200, async json() { throw new SyntaxError('gzip body') } }
    }
    return { ok: true, status: 200, async json() { return { version: '1.2.10' } } }
  }
  try {
    const value = await createKimiPluginManager({
      env: { DSH_HOME: root },
      ownPackageJsonUrl,
    }).read({ force: true })
    assert.equal(acceptEncoding, 'identity')
    assert.equal(value.latest, '1.2.10')
    assert.equal(value.updateAvailable, false)
  } finally {
    globalThis.fetch = original
  }
})

test('semver parsing and comparison drive the update badge', () => {
  assert.deepEqual(parseSemver(' 0.3.3 '), { major: 0, minor: 3, patch: 3, pre: undefined })
  assert.equal(parseSemver('v0.3.3'), undefined)
  assert.equal(parseSemver('0.3'), undefined)
  assert.equal(parseSemver(undefined), undefined)
  assert.equal(compareSemver('0.3.3', '0.4.0'), -1)
  assert.equal(compareSemver('0.4.0', '0.3.3'), 1)
  assert.equal(compareSemver('0.3.3', '0.3.3'), 0)
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareSemver('not-a-version', '0.3.3'), undefined)
})

test('version read combines own manifest, registry latest, and the owning npm profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-npm-'))
  const ownPackageJsonUrl = await npmInstall(root)
  let requests = 0
  let observed
  let clock = 1000
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    now: () => clock,
    fetchImpl: (url, init) => {
      requests += 1
      observed = { url, redirect: init.redirect }
      return registryOk('0.4.0')(url, init)
    },
  })
  const first = await manager.read()
  assert.deepEqual(first, {
    current: '0.3.3',
    latest: '0.4.0',
    updateAvailable: true,
    install: { kind: 'npm', profile: 'web' },
    fetchedAt: 1000,
  })
  assert.deepEqual(observed, { url: NPM_REGISTRY_LATEST_URL, redirect: 'error' })
  await manager.read()
  assert.equal(requests, 1, 'fresh cached reads stay off the network')
  await manager.read({ force: true })
  assert.equal(requests, 2)
})

test('registry failures and malformed payloads surface one sanitized error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-down-'))
  const ownPackageJsonUrl = await npmInstall(root)
  const failing = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: async () => ({ ok: false, status: 500 }),
  })
  await assert.rejects(() => failing.read(), /^Error: Kimi plugin version check failed$/u)
  const malformed = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { version: 'not-a-version' } } }),
  })
  await assert.rejects(() => malformed.read(), /^Error: Kimi plugin version check failed$/u)
})

test('linked checkouts are reported but never updated in place', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-link-'))
  const ownPackageJsonUrl = await linkInstall(root)
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: registryOk('0.4.0'),
    runCommand: async () => {
      throw new Error('runCommand must not run for linked installs')
    },
  })
  const info = await manager.read()
  assert.equal(info.install.kind, 'link')
  assert.equal(info.install.profile, 'web')
  assert.equal(info.updateAvailable, true)
  await assert.rejects(() => manager.update(), /^Error: Kimi plugin is installed from a local checkout$/u)
})

/**
 * A fake desktop runtime, shaped like the real host process: `argv[1]` is the
 * desktop host entry point (never the CLI), the runtime directory carrying the
 * `dsh` package arrives as its own argument, and the bundled pnpm entry travels
 * in the arguments too.
 */
async function desktopRuntime(root) {
  const runtimeDir = join(root, 'resources', 'app.asar', 'dsh')
  const hostEntry = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  const pnpm = join(root, 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  await writeManifest(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), {
    name: '@deepseek-ai/dsh',
    version: '0.1.7-rc.2',
  })
  await writeManifest(hostEntry, { name: '@deepseek-ai/dsh-desktop-host', version: '0.1.7-rc.2' })
  await writeManifest(pnpm, { name: 'pnpm', version: '11.7.0' })
  return {
    runtimeDir,
    hostEntry,
    pnpm,
    argv: [
      join(root, 'DeepSeek Harness'),
      hostEntry,
      runtimeDir,
      join(root, 'profiles', 'desktop'),
      join(root, 'resources', 'runtime', 'primary-runtime'),
      pnpm,
      join(root, 'resources', 'runtime', 'bin'),
    ],
  }
}

/** Land the requested version on disk so the post-install check can confirm it. */
const installRecorder = async ({ args, cwd }) => {
  await writeManifest(join(cwd, 'node_modules', PACKAGE_NAME, 'package.json'), {
    name: PACKAGE_NAME,
    version: args.at(-1).split('@').at(-1),
  })
  return { code: 0, stdout: '', stderr: '' }
}

test('update installs the exact version into the owning profile, pinned and age-free', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-update-'))
  const ownPackageJsonUrl = await npmInstall(root)
  const calls = []
  let registryRequests = 0
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    execPath: '/node',
    argv: ['/node', '/dsh/bin.js'],
    fetchImpl: () => {
      registryRequests += 1
      return registryOk('0.4.0')(NPM_REGISTRY_LATEST_URL, {})
    },
    runCommand: async (call, options) => {
      calls.push(call)
      return installRecorder(call, options)
    },
  })
  const updated = await manager.update()
  assert.deepEqual(updated, { version: '0.4.0', profile: 'web' })
  assert.equal(calls[0].command, 'pnpm', 'without a bundled entry the pnpm name is the fallback')
  assert.deepEqual(calls[0].args, [
    'add', '--save-exact', '--config.minimumReleaseAge=0', `${PACKAGE_NAME}@0.4.0`,
  ])
  assert.equal(calls[0].cwd, join(root, 'profiles', 'web'))
  await manager.read()
  assert.equal(registryRequests, 2, 'a successful update invalidates the cached version')
})

test('desktop hosts install with the bundled pnpm, never by launching the desktop host again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-desktop-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.2.14')
  const runtime = await desktopRuntime(root)
  assert.equal(resolvePnpm({ argv: runtime.argv, env: {} }), runtime.pnpm)
  const calls = []
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    execPath: '/Applications/DeepSeek Harness',
    argv: runtime.argv,
    fetchImpl: registryOk('1.3.0'),
    runCommand: async (call, options) => {
      calls.push(call)
      return installRecorder(call, options)
    },
  })
  // npmInstall() writes profiles/web, so the owning profile is that one.
  assert.deepEqual(await manager.update(), { version: '1.3.0', profile: 'web' })
  const [call] = calls
  assert.equal(call.command, '/Applications/DeepSeek Harness', 'the host executable is the Node runtime')
  assert.deepEqual(call.args, [
    runtime.pnpm, 'add', '--save-exact', '--config.minimumReleaseAge=0', `${PACKAGE_NAME}@1.3.0`,
  ])
  const flattened = JSON.stringify(call)
  assert.equal(flattened.includes(runtime.hostEntry), false, 'the desktop host entry is never launched again')
  assert.equal(flattened.includes('--expose-internals'), false, 'no launcher flag leaks into a script position')
  assert.equal(flattened.includes('plugin'), false, 'the CLI that refuses the desktop profile is not used')
})

test('an update that installs nothing is a failure, not a reported success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-verify-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.2.14')
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: registryOk('1.3.0'),
    settleDelayMs: 1,
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  })
  await assert.rejects(
    () => manager.update(),
    /^Error: Kimi plugin update did not install the requested version$/u,
  )
})

test('the package-manager resolver trusts only real pnpm entries and owned runtime roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-resolve-'))
  const runtime = await desktopRuntime(root)
  const elsewhere = await mkdtemp(join(tmpdir(), 'kimi-version-resolve-other-'))
  const otherPnpm = join(elsewhere, 'resources', 'pnpm', 'bin', 'pnpm.mjs')

  assert.equal(
    resolvePnpm({ argv: runtime.argv }),
    runtime.pnpm,
    'the bundled entry named in the host arguments wins',
  )
  assert.equal(
    resolvePnpm({ argv: ['/node', '--expose-internals', '/dsh/bin.js'] }),
    undefined,
    'a flag is never a package-manager entry',
  )
  assert.equal(
    resolvePnpm({ argv: ['/node', runtime.hostEntry] }),
    undefined,
    'the entry script is never treated as the package manager',
  )
  assert.equal(
    resolvePnpm({ argv: ['/node', '/somewhere/pnpm-not-really'] }),
    undefined,
    'a name that merely contains pnpm is not the package manager',
  )
  assert.equal(
    resolvePnpm({ argv: ['/node', join(root, 'missing', 'pnpm.mjs')] }),
    undefined,
    'a pnpm entry that does not exist is not used',
  )

  await writeManifest(otherPnpm, { name: 'pnpm', version: '11.7.0' })
  const runtimeDir = join(elsewhere, 'resources', 'runtime')
  await writeManifest(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), {
    name: '@deepseek-ai/dsh',
    version: '0.1.7-rc.2',
  })
  assert.equal(
    resolvePnpm({ argv: ['/node', join(elsewhere, 'index.js'), runtimeDir] }),
    otherPnpm,
    'a runtime directory carrying the dsh package locates the bundled pnpm',
  )
})

test('update failures stay generic and unknown installs refuse to guess a profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-fail-'))
  const ownPackageJsonUrl = await npmInstall(root)
  const failing = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: registryOk('0.4.0'),
    runCommand: async () => ({ code: 1, stdout: '', stderr: 'pnpm exploded with secret-ish output' }),
  })
  await assert.rejects(
    () => failing.update(),
    error => error.message === 'Kimi plugin update failed' && !error.message.includes('secret-ish'),
  )

  const emptyHome = await mkdtemp(join(tmpdir(), 'kimi-version-none-'))
  const stray = join(emptyHome, 'elsewhere', 'package.json')
  await writeManifest(stray, { name: PACKAGE_NAME, version: '0.3.3' })
  const unknown = createKimiPluginManager({
    env: { DSH_HOME: emptyHome },
    ownPackageJsonUrl: pathToFileURL(stray),
    fetchImpl: registryOk('0.4.0'),
  })
  const info = await unknown.read()
  assert.deepEqual(info.install, { kind: 'unknown' })
  await assert.rejects(() => unknown.update(), /^Error: Kimi plugin update could not find the owning profile$/u)
})

test('loopback RPC exposes version and update endpoints with sanitized errors', async () => {
  const projection = {
    current: '0.3.3',
    latest: '0.4.0',
    updateAvailable: true,
    install: { kind: 'npm', profile: 'web' },
    fetchedAt: 1000,
  }
  const forced = []
  const handler = createKimiRpcHandler({}, {
    pluginManager: {
      async read({ force } = {}) {
        forced.push(force)
        return projection
      },
      async update() {
        return { version: '0.4.0', profile: 'web' }
      },
    },
  })
  const signal = new AbortController().signal
  assert.deepEqual(await handler('plugin/version', {}, signal), { ok: true, value: projection })
  await handler('plugin/version', { force: true }, signal)
  assert.deepEqual(forced, [false, true])
  assert.deepEqual(await handler('plugin/update', {}, signal), {
    ok: true,
    value: { version: '0.4.0', profile: 'web' },
  })

  const failing = createKimiRpcHandler({}, {
    pluginManager: {
      async read() { throw new Error('Kimi plugin version check failed') },
      async update() { throw new Error('pnpm leaked internals') },
    },
  })
  assert.deepEqual(await failing('plugin/version', {}, signal), {
    ok: false,
    error: { code: 'bad-request', message: 'Kimi plugin version check failed', details: { issues: [] } },
  })
  assert.deepEqual(await failing('plugin/update', {}, signal), {
    ok: false,
    error: { code: 'bad-request', message: 'Kimi request failed', details: { issues: [] } },
  })

  const missing = createKimiRpcHandler({})
  assert.deepEqual(await missing('plugin/version', {}, signal), {
    ok: false,
    error: { code: 'bad-request', message: 'Kimi plugin version is unavailable', details: { issues: [] } },
  })
})

test('cancelled callers do not abort or evict a shared version request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-cancel-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.0.0')
  let requests = 0
  let sharedSignal
  let markStarted
  let releaseRequest
  const started = new Promise(resolve => { markStarted = resolve })
  const released = new Promise(resolve => { releaseRequest = resolve })
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: async (_url, init) => {
      requests += 1
      sharedSignal = init.signal
      markStarted()
      await released
      init.signal.throwIfAborted()
      return { ok: true, status: 200, async json() { return { version: '1.0.1' } } }
    },
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const firstReason = new DOMException('first caller left the page', 'AbortError')
  const secondReason = new DOMException('second caller left the page', 'AbortError')
  const first = assert.rejects(
    manager.read({ signal: firstController.signal }),
    error => error === firstReason,
  )
  await started
  const second = assert.rejects(
    manager.read({ signal: secondController.signal }),
    error => error === secondReason,
  )
  firstController.abort(firstReason)
  await first
  assert.equal(sharedSignal.aborted, false)
  const lateSubscriber = manager.read()
  secondController.abort(secondReason)
  await second
  assert.equal(sharedSignal.aborted, false)
  assert.equal(requests, 1, 'late subscribers keep joining the live shared request')
  releaseRequest()
  const info = await lateSubscriber
  assert.equal(info.latest, '1.0.1')
  await manager.read()
  assert.equal(requests, 1, 'the surviving shared request still populates the cache')
})

test('shared version timeouts clear the flight for the next read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-timeout-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.0.0')
  let requests = 0
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      requests += 1
      return new Promise((resolve, reject) => {
        const fallback = setTimeout(() => reject(new Error('test fetch did not abort')), 1_000)
        init.signal.addEventListener('abort', () => {
          clearTimeout(fallback)
          reject(init.signal.reason)
        }, { once: true })
      })
    },
  })
  const first = manager.read()
  const second = manager.read()
  await assert.rejects(first, /^Error: Kimi plugin version check failed$/u)
  await assert.rejects(second, /^Error: Kimi plugin version check failed$/u)
  assert.equal(requests, 1)
  await assert.rejects(manager.read(), /^Error: Kimi plugin version check failed$/u)
  assert.equal(requests, 2)
})

test('a forced version refresh remains privately cancellable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-force-cancel-'))
  const ownPackageJsonUrl = await npmInstall(root, '1.0.0')
  let sharedSignal
  let forcedSignal
  let sharedStarted
  let forcedStarted
  let releaseShared
  const sharedReady = new Promise(resolve => { sharedStarted = resolve })
  const forcedReady = new Promise(resolve => { forcedStarted = resolve })
  const sharedReleased = new Promise(resolve => { releaseShared = resolve })
  let requests = 0
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
    fetchImpl: async (_url, init) => {
      requests += 1
      if (requests === 1) {
        sharedSignal = init.signal
        sharedStarted()
        await sharedReleased
      } else {
        forcedSignal = init.signal
        forcedStarted()
        await new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
      }
      init.signal.throwIfAborted()
      return { ok: true, status: 200, async json() { return { version: '1.0.1' } } }
    },
  })
  const shared = manager.read()
  await sharedReady
  const controller = new AbortController()
  const reason = new DOMException('forced refresh cancelled', 'AbortError')
  const forced = assert.rejects(
    manager.read({ force: true, signal: controller.signal }),
    error => error === reason,
  )
  await forcedReady
  controller.abort(reason)
  await forced
  assert.equal(forcedSignal.aborted, true)
  assert.equal(sharedSignal.aborted, false)
  releaseShared()
  assert.equal((await shared).latest, '1.0.1')
})

test('the default fetch is resolved per call across a sibling scoped-wrapper teardown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kimi-version-ambient-'))
  const ownPackageJsonUrl = await npmInstall(root)
  const original = globalThis.fetch
  // Mimic a sibling plugin's scoped proxy wrapper installed while this plugin
  // loads: it forwards through a mutable fallback that is nulled on teardown.
  let baseFetch = original
  globalThis.fetch = (...args) => baseFetch(...args)
  const manager = createKimiPluginManager({
    env: { DSH_HOME: root },
    ownPackageJsonUrl,
  })
  try {
    // Scope ends: the ambient binding is restored and the wrapper dismantled.
    globalThis.fetch = async (url, init) => registryOk('0.4.0')(url, init)
    baseFetch = undefined
    const info = await manager.read()
    assert.equal(info.latest, '0.4.0')
    assert.equal(info.current, '0.3.3')
  } finally {
    globalThis.fetch = original
  }
})
