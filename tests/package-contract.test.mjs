import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import semver from 'semver'

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

/** The desktop installer's gate: every dsh peer must satisfy the runtime. */
const incompatiblePeers = (manifest, runtime) => Object.entries(manifest.peerDependencies)
  .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  .filter(([, range]) => !semver.satisfies(runtime, range, { includePrerelease: true }))
  .map(([name]) => name)

test('bundle contributes one host row and one DSH client module', async () => {
  const [manifestText, patch, build] = await Promise.all([
    text('package.json'),
    text('cordis.patch.yml'),
    text('tsdown.config.mjs'),
  ])
  const manifest = JSON.parse(manifestText)
  assert.equal(manifest.name, 'dsh-kimi-subscription')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-model-selection'))
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false)
  // The desktop installer and profile startup both reject a plugin unless every
  // @deepseek-ai/dsh-* peer satisfies the running runtime, prereleases included.
  // A literal enumeration that names only already-released versions silently
  // drops the plugin on the next host bump, which is why these ranges must span
  // the whole 0.1 line rather than list the versions seen so far.
  assert.deepEqual(incompatiblePeers(manifest, '0.1.7-rc.2'), [])
  assert.deepEqual(incompatiblePeers(manifest, '0.1.5-alpha.2'), [])
  assert.deepEqual(incompatiblePeers(manifest, '0.1.1-rc.2'), [])
  assert.notDeepEqual(incompatiblePeers(manifest, '0.2.0-rc.1'), [])
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.match(patch, /id:\s*kimi-subscription/u)
  assert.match(patch, /name:\s*['"]dsh-kimi-subscription['"]/u)
  assert.match(build, /window\.__ModuleLoader__\.load/u)
})

test('host owns its OAuth so no credential depends on transport decoding', async () => {
  const [runtime, oauth] = await Promise.all([text('src/pi-ai-runtime.js'), text('src/kimi-oauth.js')])
  // pi-ai's Kimi OAuth uses the ambient fetch, whose response encoding the host
  // may not control; the plugin issues those two requests itself instead.
  assert.match(runtime, /createKimiOAuth/u)
  assert.doesNotMatch(runtime, /base\.auth\.oauth/u)
  assert.match(oauth, /accept-encoding/u)
  assert.match(oauth, /'identity'/u)
  assert.match(oauth, /classifyKimiOAuthFailure/u)
})

test('client renders a localized reason for every classified sign-in failure', async () => {
  const [client, oauth] = await Promise.all([text('src/client.jsx'), text('src/kimi-oauth.js')])
  const reasons = [...oauth.matchAll(/'oauth\/[a-z-]+': '([a-z]+)'/gu)].map(match => match[1])
  assert.ok(reasons.includes('denied'))
  for (const reason of reasons) {
    // An aborted sign-in is rendered as the cancelled phase, not as a failure.
    if (reason === 'aborted') continue
    assert.match(client, new RegExp(`${reason}: 'failed`, 'u'), `client has no copy for the ${reason} reason`)
  }
})

test('client registers a removable settings section and never stores credentials', async () => {
  const source = await text('src/client.jsx')
  assert.match(source, /slots\.inject\(['"]settings\.section['"]/u)
  assert.match(source, /slots\.inject\(['"]conversation\.input\.right['"]/u)
  assert.match(source, /id:\s*['"]kimi-subscription['"]/u)
  assert.match(source, /id:\s*['"]kimi-subscription-usage['"]/u)
  assert.match(source, /Kimi subscription/u)
  assert.match(source, /login\/start/u)
  assert.match(source, /api-key\/set/u)
  assert.match(source, /call\(['"]usage['"]/u)
  assert.match(source, /call\(['"]plugin\/version['"]/u)
  assert.match(source, /call\(['"]plugin\/update['"]/u)
  assert.match(source, /remainingPercent/u)
  assert.doesNotMatch(source, /localStorage|sessionStorage|accessToken|refreshToken/u)
})

test('client keeps usage reset time readable in light and dark themes', async () => {
  const source = await text('src/client.jsx')
  const resetRule = source.match(/\.kimiUsageReset\{[^}]*\}/u)
  assert.ok(resetRule, 'expected a .kimiUsageReset style rule')
  assert.match(resetRule[0], /color:var\(--dsw-alias-label-tertiary\)/u)
  assert.doesNotMatch(resetRule[0], /label-dimmed/u)
})

test('host keeps subscription route separate from generic kimi-coding configuration', async () => {
  const [host, runtime] = await Promise.all([text('src/index.js'), text('src/pi-ai-runtime.js')])
  assert.match(host, /displayName:\s*DISPLAY_NAME/u)
  assert.match(host, /registerAdapter\(\[PROVIDER\]/u)
  assert.match(runtime, /kimiCodingProvider/u)
  assert.match(runtime, /provider:\s*PROVIDER/u)
  assert.doesNotMatch(host, /registerConfigurableProviders/u)
})
