import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { HostConnectionService, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import { load } from 'js-yaml'
import { CHANNEL, PROVIDER } from '../src/constants.js'
import * as kimiPlugin from '../src/index.js'
import * as legacyConnection from 'connection-legacy'

const bundle = load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))

// The service the official connection row reads trustedHosts from. dsh web and
// desktop share that row; DSH 0.2.1 renamed the service.
const STARTUP_SERVICE = { '0.2.0': 'webRuntime', '0.2.1': 'webStartup' }

// The row patch 1.3.5 to 1.3.8 shipped. It replaced the row's inject list with
// the 0.2.0 names, so on 0.2.1 Connection waited for webRuntime forever.
const ROW_PATCH_1_3_8 = {
  id: 'connection',
  name: '@deepseek-ai/dsh-client-connection',
  inject: ['credentials', 'webRuntime', 'webServer'],
}

// A fresh object each time: the loader writes `disabled` back onto a row it unloads.
const webServerRow = () => ({ id: 'webserver', name: 'cordis:webserver' })

const ACTIVE = 2

function officialRows(host) {
  const startup = STARTUP_SERVICE[host]
  return [
    { id: 'credentials', name: 'cordis:credentials' },
    // Match the official web profile: entry-level dependency and !!js expression.
    { id: 'connection', name: '@deepseek-ai/dsh-client-connection', inject: [startup],
      config: { trustedHosts: { __jsExpr: `ctx.${startup}.trustedHosts` } } },
  ]
}

const entryOf = (loader, id) => [...loader.entries()].find(entry => entry.options?.id === id)
const stateOf = (loader, id) => entryOf(loader, id)?.fiber?.state

async function removeEntry(loader, id) {
  const { fiber } = entryOf(loader, id)
  await loader.root.remove(id)
  // The channel lives on a child fiber; its route goes once the unload settles.
  while (fiber.inertia) await fiber.inertia
}

async function compose(patches, { host = '0.2.1', webServer = true, legacy = false, fullPlugin = false, authenticated = false } = {}) {
  const ctx = new Context()
  await ctx.plugin(Loader)
  const loader = ctx.get('loader')
  // Every start is a new server with its own routes, so a route left on a
  // stopped server is told apart from one on the running server.
  const servers = []
  loader.builtins.webserver = { apply(c) {
    const routes = new Map()
    servers.push(routes)
    c.provide('webServer', { register(route) {
      assert.equal(routes.has(route.path), false)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } })
  } }
  loader.builtins.credentials = { apply(c) {
    c.provide('credentials', { resolve: async () => undefined })
    c.provide(STARTUP_SERVICE[host], { trustedHosts: ['test.invalid'] })
    c.provide('llm', { registerAdapter: () => () => {} })
    c.provide('attachments', {})
    c.provide('web', { searchProviders: new Map(), registerSearchProvider: () => () => {} })
    c.provide('settings', { register: () => ({ get: () => ({ searchProvider: 'default' }), watch: () => () => {} }) })
  } }
  let connectionStarts = 0
  const connection = { inject: legacy ? legacyConnection.inject : connectionInject, apply(c, config) {
    connectionStarts += 1
    assert.deepEqual(config.trustedHosts, ['test.invalid'])
    // Real Connection apply reads ctx.credentials before any route is registered.
    void c.credentials
    const Connection = legacy ? legacyConnection.HostConnectionService : HostConnectionService
    // No API peer cookie (0.2.1+), and a browser cookie only when the case
    // signs the browser in: otherwise every request is unauthenticated.
    new Connection(c, [], { isAuthenticated: () => authenticated, authenticateApi: () => undefined })
  } }
  // Opens a channel through the public API alone, as a plugin would without
  // passing its own web context to Connection.
  const consumer = { inject: ['connection'], apply(c) {
    c.effect(() => c.connection.rpc.handle(CHANNEL, async () => ({ ok: true, value: {} }), { authority: 'loopback' }))
  } }
  // Keep real package names so the patch name guard would be exercised.
  const originalImport = loader.import.bind(loader)
  loader.import = name => name === '@deepseek-ai/dsh-client-connection' ? Promise.resolve(connection)
    : name === 'dsh-kimi-subscription' ? Promise.resolve(fullPlugin ? kimiPlugin : consumer) : originalImport(name)
  // Cordis loader 1.0.5 writes a failed entry's `disabled` flag back onto the row
  // object. Clone so one negative case cannot disable the shared bundle next.
  const rows = applyEntryPatches(officialRows(host), structuredClone(patches), message => assert.fail(message))
  const withServer = () => [webServerRow(), ...rows]
  await loader.root.update(webServer ? withServer() : rows)
  await loader.await()
  const settle = async next => {
    await loader.root.update(next)
    await loader.await()
  }
  return {
    loader,
    servers,
    // The routes of the most recently started server.
    get routes() { return servers.at(-1) ?? new Map() },
    get connectionStarts() { return connectionStarts },
    rows,
    startWebServer: () => settle(withServer()),
    stopWebServer: () => settle(rows),
    async close() {
      await loader.root.stop()
      await ctx.fiber.dispose()
    },
  }
}

async function mount(patches, options) {
  const host = await compose(patches, options)
  if (stateOf(host.loader, 'kimi-subscription') === ACTIVE) return host
  // Loader 1.0.5 records the injection failure on the fiber instead of rejecting await().
  const errors = [...host.loader.entries()].map(entry => entry.fiber?._error).filter(error => error instanceof Error)
  const state = stateOf(host.loader, 'kimi-subscription')
  await host.close()
  throw errors.at(-1) ?? new Error(`kimi-subscription did not activate (state ${state})`)
}

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-kimi-compat-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

async function assertRejectsUnauthenticated(routes) {
  // The account channel is Connection's own route behind its authentication fence.
  let status, body
  await routes.get(CHANNEL).handler({ headers: { host: 'localhost' }, method: 'POST' }, {
    writeHead(value) { status = value }, end(value) { body = value },
  })
  assert.equal(status, 401)
  assert.equal(body, 'unauthorized')
}

test('shipped bundle inserts the plugin row and patches no official row', () => {
  assert.deepEqual(bundle, [{ insert: [{ id: 'kimi-subscription', name: 'dsh-kimi-subscription' }] }])
})

test('1.3.8 row patch keeps DSH 0.2.1 Connection waiting for webRuntime', async () => {
  const host = await compose([...bundle, ROW_PATCH_1_3_8], { host: '0.2.1' })
  try {
    assert.deepEqual(host.rows.find(row => row.id === 'connection').inject, ROW_PATCH_1_3_8.inject)
    // This is the desktop boot failure: "connection (required)  webRuntime".
    assert.notEqual(stateOf(host.loader, 'connection'), ACTIVE)
    assert.equal(entryOf(host.loader, 'connection').fiber._error, undefined)
    assert.notEqual(stateOf(host.loader, 'kimi-subscription'), ACTIVE)
    assert.equal(host.routes.has(CHANNEL), false)
  } finally {
    await host.close()
  }
})

test('the 1.3.8 row patch only ever worked while the service was named webRuntime', async () => {
  const host = await compose([...bundle, ROW_PATCH_1_3_8], { host: '0.2.0' })
  try {
    assert.equal(stateOf(host.loader, 'connection'), ACTIVE)
    assert.equal(host.routes.has(CHANNEL), true)
  } finally {
    await host.close()
  }
})

for (const version of Object.keys(STARTUP_SERVICE)) {
  test(`DSH ${version}: Connection's public rpc.handle cannot open a channel on the official row`, async () => {
    await assert.rejects(mount(bundle, { host: version }), /cannot get property "webServer" without inject/u)
  })

  test(`DSH ${version}: shipped bundle opens the account channel on the official row and disposes it`, async () => {
    await withHome(async () => {
      const host = await mount(bundle, { host: version, fullPlugin: true })
      try {
        const startup = STARTUP_SERVICE[version]
        const row = host.rows.find(item => item.id === 'connection')
        assert.deepEqual(row.inject, [startup])
        assert.deepEqual(row.config, { trustedHosts: { __jsExpr: `ctx.${startup}.trustedHosts` } })
        assert.deepEqual([...host.routes.keys()], [CHANNEL])
        await assertRejectsUnauthenticated(host.routes)
        await removeEntry(host.loader, 'kimi-subscription')
        assert.equal(host.routes.size, 0)
      } finally {
        await host.close()
      }
    })
  })
}

test('account channel opens once the web server starts after the plugin, and again after a restart', async () => {
  await withHome(async () => {
    const host = await mount(bundle, { host: '0.2.1', fullPlugin: true, webServer: false })
    try {
      // Models and settings do not wait for the web server; only the channel does.
      assert.equal(stateOf(host.loader, 'connection'), ACTIVE)
      assert.equal(host.routes.size, 0)
      await host.startWebServer()
      assert.deepEqual([...host.routes.keys()], [CHANNEL])
      await assertRejectsUnauthenticated(host.routes)
      await host.stopWebServer()
      assert.equal(host.routes.size, 0)
      await host.startWebServer()
      assert.equal(stateOf(host.loader, 'kimi-subscription'), ACTIVE)
      assert.deepEqual([...host.routes.keys()], [CHANNEL])
      // The channel is on the running server, and nothing stayed on the stopped one.
      assert.deepEqual(host.servers.map(routes => routes.size), [0, 1])
      // Connection never restarted with the web server, and its row still does
      // not wait for one.
      assert.equal(host.connectionStarts, 1)
      assert.equal('webServer' in entryOf(host.loader, 'connection').fiber.inject, false)
    } finally {
      await host.close()
    }
  })
})

// The settings page calls the account channel over HTTP. A signed-in browser
// reaches the plugin's handler through Connection's own route; any other
// request stops at Connection's authentication.
test('a signed-in browser reaches the account handler over HTTP', async () => {
  await withHome(async () => {
    const host = await mount(bundle, { host: '0.2.1', fullPlugin: true, authenticated: true })
    const server = createServer((req, res) => {
      const route = host.routes.get(CHANNEL)
      if (route === undefined || !req.url.startsWith(`${CHANNEL}/`)) {
        res.writeHead(405)
        res.end()
        return
      }
      route.handler(req, res)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const call = endpoint => fetch(`http://127.0.0.1:${server.address().port}${CHANNEL}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'compat-1', method: endpoint, payload: {} }),
    })
    try {
      const status = await call('status')
      assert.equal(status.status, 200)
      assert.deepEqual(await status.json(), {
        type: 'server-response',
        rpcId: 'compat-1',
        result: { ok: true, value: { authenticated: false, provider: PROVIDER } },
      })
      const preferences = await call('preferences/status')
      assert.equal(preferences.status, 200)
      assert.equal((await preferences.json()).result.value.searchProvider, 'default')
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await host.close()
    }
  })
})

test('full Kimi plugin activates with the 0.1.2-alpha.5 Connection', async () => {
  await withHome(async () => {
    const host = await mount(bundle, { host: '0.2.0', legacy: true, fullPlugin: true })
    try {
      assert.equal(host.routes.has(CHANNEL), true)
    } finally {
      await host.close()
    }
  })
})
