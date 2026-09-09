import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { HostConnectionService, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import { load } from 'js-yaml'
import { CHANNEL } from '../src/constants.js'
import * as kimiPlugin from '../src/index.js'
import * as legacyConnection from 'connection-legacy'

const bundle = load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))

async function mount(patches, { legacy = false, fullPlugin = false } = {}) {
  const ctx = new Context()
  await ctx.plugin(Loader)
  const loader = ctx.get('loader')
  const routes = new Map()
  loader.builtins.webserver = { apply(c) {
    c.provide('webServer', { register(route) {
      assert.equal(routes.has(route.path), false)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } })
  } }
  loader.builtins.credentials = { apply(c) {
    c.provide('credentials', { resolve: async () => undefined })
    c.provide('webRuntime', { trustedHosts: ['test.invalid'] })
    c.provide('llm', { registerAdapter: () => () => {} })
    c.provide('attachments', {})
    c.provide('web', { searchProviders: new Map(), registerSearchProvider: () => () => {} })
    c.provide('settings', { register: () => ({ get: () => ({ searchProvider: 'default' }), watch: () => () => {} }) })
  } }
  const connection = { inject: legacy ? legacyConnection.inject : connectionInject, apply(c, config) {
    assert.deepEqual(config.trustedHosts, ['test.invalid'])
    const Connection = legacy ? legacyConnection.HostConnectionService : HostConnectionService
    new Connection(c, [], { isAuthenticated: () => false })
  } }
  const consumer = { inject: ['connection'], apply(c) {
    c.effect(() => c.connection.rpc.handle(CHANNEL, async () => ({ ok: true, value: {} }), { authority: 'loopback' }))
  } }
  // Keep real package names so the shipped patch's name guard is exercised.
  const originalImport = loader.import.bind(loader)
  loader.import = name => name === '@deepseek-ai/dsh-client-connection' ? Promise.resolve(connection)
    : name === 'dsh-kimi-subscription' ? Promise.resolve(fullPlugin ? kimiPlugin : consumer) : originalImport(name)
  const rows = applyEntryPatches([
    { id: 'webserver', name: 'cordis:webserver' },
    { id: 'credentials', name: 'cordis:credentials' },
    // Match the official web profile: entry-level dependency and !!js expression.
    { id: 'connection', name: '@deepseek-ai/dsh-client-connection', inject: ['webRuntime'],
      config: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } } },
  ], patches, message => assert.fail(message))
  try {
    await loader.root.update(rows)
    await loader.await()
    assert.equal(loader.resolve('kimi-subscription').fiber.state, 2)
    return { loader, routes, rows, close: () => ctx.fiber.dispose() }
  } catch (error) {
    await loader.root.stop()
    await ctx.fiber.dispose()
    throw error
  }
}

test('unpatched DSH 0.1.5 connection reproduces the webServer injection error', async () => {
  const insert = bundle.filter(patch => patch.insert)
  await assert.rejects(mount(insert), /cannot get property "webServer" without inject/u)
})

test('1.2.4 replacement loses the profile webRuntime injection during config interpolation', async () => {
  const broken = bundle.map(patch => patch.id === 'connection' ? { ...patch, inject: ['webServer'] } : patch)
  await assert.rejects(mount(broken), /cannot get property "webRuntime" without inject/u)
})

test('shipped bundle mounts RPC through the real loader and disposes its route', async () => {
  const host = await mount(bundle)
  try {
    assert.deepEqual([...host.routes.keys()], [CHANNEL])
    assert.deepEqual(host.rows.find(row => row.id === 'connection').config, { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } })
    // The compatibility patch must keep the Connection authentication fence.
    let status, body
    await host.routes.get(CHANNEL).handler({ headers: { host: 'localhost' }, method: 'POST' }, {
      writeHead(value) { status = value }, end(value) { body = value },
    })
    assert.equal(status, 401)
    assert.equal(body, 'unauthorized')
    await host.loader.root.remove('kimi-subscription')
    assert.equal(host.routes.size, 0)
  } finally {
    await host.loader.root.stop()
    await host.close()
  }
})

for (const legacy of [false, true]) {
  test(`full Kimi plugin activates with ${legacy ? '0.1.2-alpha.5' : '0.1.5-alpha.1'} Connection`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-kimi-compat-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    let host
    try {
      host = await mount(bundle, { legacy, fullPlugin: true })
      assert.equal(host.routes.has(CHANNEL), true)
    } finally {
      await host?.close()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })
}
