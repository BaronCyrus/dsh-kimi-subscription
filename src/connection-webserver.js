/**
 * Connection's dedicated-channel registration reads `webServer` on the
 * connection fiber (`owner.webServer` inside `rpc.handle`). That fiber only
 * has `webServer` when the loader row lists it, and the official row does not
 * (DSH 0.2.0 injects webRuntime there, 0.2.1 webStartup). The service itself
 * is provided by the `webserver` row; Cordis still rejects the read with
 * `cannot get property "webServer" without inject`.
 *
 * Bind the live implementation onto that fiber before opening the channel.
 * This replaces the row patch shipped up to 1.3.8, which had to restate the
 * row's whole inject list and so broke when DSH renamed a service in it.
 * It does not register a second route or skip Connection's authentication.
 */
export function bindConnectionWebServer(ctx) {
  const entry = [...ctx.loader.entries()].find(item =>
    item.options?.id === 'connection' && item.options?.name === '@deepseek-ai/dsh-client-connection')
  // Unit fixtures have no loader row. Their rpc.handle does not touch webServer.
  if (!entry) return true
  const fiber = entry.fiber
  if (!fiber?.inject || !fiber.store) return false
  if (fiber.store.webServer) return true
  const webServer = ctx.get?.('webServer')
  if (typeof webServer?.register !== 'function') return false
  if (!('webServer' in fiber.inject)) fiber.inject.webServer = null
  if (typeof fiber._checkImpl === 'function') fiber._checkImpl('webServer')
  if (fiber._store?.webServer) {
    fiber.store.webServer = fiber._store.webServer
    return true
  }
  const impl = { name: 'webServer', value: webServer, fiber }
  fiber.store.webServer = impl
  if (fiber._store) fiber._store.webServer = impl
  return true
}
