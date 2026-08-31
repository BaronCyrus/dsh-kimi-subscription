/**
 * Resolve the ambient fetch at call time, never at plugin load. A sibling
 * plugin in the same host may temporarily replace `globalThis.fetch` with a
 * scoped proxy wrapper and dismantle that wrapper afterwards; a binding
 * captured during `apply()` would otherwise freeze the stale wrapper (whose
 * internal fallback is nulled on teardown) for the process lifetime, failing
 * every request. Live lookup follows the restore and stays fetch-compatible
 * even while such a wrapper is installed.
 */
export function ambientFetch(...args) {
  return globalThis.fetch(...args)
}

/**
 * Wait for a shared operation while keeping one caller's cancellation local to
 * that caller. The shared promise continues for other subscribers and may still
 * populate its cache.
 */
export function waitForSharedRequest(promise, signal) {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
