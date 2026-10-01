/**
 * Connection's dedicated-channel registration reads `webServer` on the
 * connection fiber (`owner.webServer` inside `rpc.handle`). That fiber only
 * has `webServer` when the loader row lists it. dsh web's official row does
 * not, and a bundle patch that runs before the row is inserted is skipped.
 * The service itself is already provided by `webserver`; Cordis still rejects
 * the read with `cannot get property "webServer" without inject`.
 *
 * Bind the live implementation onto that fiber before opening the channel.
 * This does not register a second route or skip Connection's authentication.
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
