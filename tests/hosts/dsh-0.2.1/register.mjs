// Run the test suite against the DeepSeek Harness 0.2.1 host packages.
//
// `pnpm run test:dsh-0.2.1` loads this before the tests. A bare import of a
// package this folder's manifest names, made by the plugin's source or its
// tests, resolves from this folder instead of the repository root, as a DSH
// profile hands a plugin the running installation's copy. Those packages then
// resolve their own dependencies where they are installed, and every other
// import is left to Node. There is no fallback to the root's 0.2.2 packages.
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const manifestUrl = new URL('package.json', import.meta.url)
const repository = new URL('../../../', import.meta.url).href
// Test files run in child processes, which inherit this and load this hook
// again; tests/package-contract.test.mjs checks that the host it names is
// the one the imports actually reach.
process.env.DSH_KIMI_TEST_HOST = 'dsh-0.2.1'
const hosted = new Set(Object.keys(JSON.parse(readFileSync(manifestUrl, 'utf8')).devDependencies))

const packageName = specifier => {
  const [first, second] = specifier.split('/', 2)
  return specifier.startsWith('@') ? `${first}/${second}` : first
}

const fromRepository = parentURL => typeof parentURL === 'string'
  && parentURL.startsWith(repository)
  && !parentURL.includes('/node_modules/')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (fromRepository(context.parentURL) && hosted.has(packageName(specifier))) {
      return nextResolve(specifier, { ...context, parentURL: manifestUrl.href })
    }
    return nextResolve(specifier, context)
  },
})
