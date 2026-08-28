import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

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
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-model-selection'))
  assert.match(patch, /id:\s*kimi-subscription/u)
  assert.match(patch, /name:\s*['"]dsh-kimi-subscription['"]/u)
  assert.match(build, /window\.__ModuleLoader__\.load/u)
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
