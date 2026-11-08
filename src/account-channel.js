/**
 * Open the account channel as a Connection route owned by this plugin.
 *
 * `connection.rpc.handle(channel, handler)` is `register(owner, channel,
 * handler)` with the reading context as `owner`, and `register` reads
 * `owner.webServer`. Cordis resolves that read on Connection's own fiber, and
 * the official connection row has not injected webServer since DSH 0.1.5.
 * Versions 1.3.6 to 1.5.0 wrote the running server onto that fiber through
 * private Cordis fields. Cordis 4.1.0 (DSH 0.2.2) no longer reads them, so the
 * channel never opened there, and on earlier hosts the write made Connection
 * restart whenever the web server restarted.
 *
 * Pass this plugin's web context as the owner instead. It injects webServer,
 * so the read resolves on this plugin's fiber and the route is disposed with
 * that context. The request handler is still Connection's own, behind its
 * Host/Origin check and authentication. No Connection or Cordis state is
 * modified. Every Connection release from 0.1.2-alpha.2 to 0.2.2-rc.1
 * implements `rpc.handle` this way; the 0.1.1 releases also read the authority
 * option, which later releases ignore.
 *
 * @param webCtx - this plugin's context while the DSH web server runs.
 * @param channel - the channel path.
 * @param handler - the endpoint handler Connection calls for each request.
 * @returns the disposer of the route registration.
 */
export function openAccountChannel(webCtx, channel, handler) {
  const connection = webCtx.connection
  const options = { authority: 'loopback' }
  // Without the method, use the public API. It opens the channel only where
  // Connection's own fiber has webServer.
  if (typeof connection.register !== 'function') return connection.rpc.handle(channel, handler, options)
  return connection.register(webCtx, channel, handler, options)
}
