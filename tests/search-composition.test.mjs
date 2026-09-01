import assert from 'node:assert/strict'
import test from 'node:test'

import { createKimiSearchComposition, stripSearchPatchBlock } from '../src/search-composition.js'

const HEADER = '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n'

function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  const writes = []
  return {
    files,
    writes,
    fs: {
      async readFile(path) {
        if (!files.has(path)) {
          const error = new Error('ENOENT')
          error.code = 'ENOENT'
          throw error
        }
        return files.get(path)
      },
      async writeFile(path, content) {
        if (!path.endsWith('.tmp')) writes.push([path, content])
        files.set(path, content)
      },
      async rename(from, to) {
        files.set(to, files.get(from))
        files.delete(from)
      },
    },
  }
}

function editor(store, { baseConfig = { fetchProvider: 'http' }, profile = 'web' } = {}) {
  return createKimiSearchComposition({
    dshHome: '/dsh',
    findProfile: async () => profile,
    readBaseConfig: () => baseConfig,
    fs: store.fs,
  })
}

const profileless = store => createKimiSearchComposition({
  dshHome: '/dsh',
  findProfile: async () => undefined,
  readBaseConfig: () => ({ fetchProvider: 'http' }),
  fs: store.fs,
})

test('apply writes a marked web block over an empty patch list', async () => {
  const store = fakeFs({ '/dsh/profiles/web/cordis.patch.yml': HEADER })
  const composition = editor(store)
  assert.equal(await composition.apply('kimi-subscription-auto'), true)
  const content = store.files.get('/dsh/profiles/web/cordis.patch.yml')
  assert.match(content, /# >>> dsh-kimi-subscription: web search provider/u)
  assert.match(content, /- id: web\n {2}config:\n {4}fetchProvider: http\n {4}searchProvider: kimi-subscription-auto\n# <<< dsh-kimi-subscription/u)
  assert.doesNotMatch(content, /^\[\]$/um)
  assert.match(content, /Your patch layer/u)
})

test('apply is idempotent and refreshes the provider inside its own block only', async () => {
  const store = fakeFs({ '/dsh/profiles/web/cordis.patch.yml': HEADER })
  const composition = editor(store)
  await composition.apply('kimi-subscription-auto')
  assert.equal(await composition.apply('kimi-subscription-auto'), false)
  await composition.apply('kimi-subscription')
  const content = store.files.get('/dsh/profiles/web/cordis.patch.yml')
  assert.equal(content.match(/- id: web/gu)?.length, 1)
  assert.match(content, /searchProvider: kimi-subscription\n/u)
})

test('apply preserves unrelated patch entries verbatim', async () => {
  const other = `${HEADER.replace('[]', '')}- id: other\n  disabled: true\n`
  const store = fakeFs({ '/dsh/profiles/web/cordis.patch.yml': other })
  const composition = editor(store)
  await composition.apply('kimi-subscription-auto')
  const content = store.files.get('/dsh/profiles/web/cordis.patch.yml')
  assert.match(content, /- id: other\n {2}disabled: true\n/u)
  assert.match(content, /- id: web\n {2}config:/u)
})

test('remove strips only the marked block and restores an empty list', async () => {
  const store = fakeFs({ '/dsh/profiles/web/cordis.patch.yml': HEADER })
  const composition = editor(store)
  await composition.apply('kimi-subscription-auto')
  assert.equal(await composition.remove(), true)
  const content = store.files.get('/dsh/profiles/web/cordis.patch.yml')
  assert.doesNotMatch(content, /dsh-kimi-subscription/u)
  assert.match(content, /^\[\]$/um)
  assert.equal(await composition.remove(), false)
})

test('remove keeps unrelated entries and drops the block', async () => {
  const other = `${HEADER.replace('[]', '')}- id: other\n  disabled: true\n`
  const store = fakeFs({ '/dsh/profiles/web/cordis.patch.yml': other })
  const composition = editor(store)
  await composition.apply('kimi-subscription-auto')
  await composition.remove()
  const content = store.files.get('/dsh/profiles/web/cordis.patch.yml')
  assert.doesNotMatch(content, /dsh-kimi-subscription/u)
  assert.match(content, /- id: other\n {2}disabled: true/u)
  assert.doesNotMatch(content, /^\[\]$/um)
})

test('stripSearchPatchBlock is idempotent and marker-scoped', () => {
  const content = `before\n# >>> dsh-kimi-subscription: web search provider\n- id: web\n# <<< dsh-kimi-subscription: web search provider\nafter\n`
  assert.equal(stripSearchPatchBlock(content), 'before\nafter\n')
  assert.equal(stripSearchPatchBlock('plain\n'), 'plain\n')
})

test('a missing owning profile or patch file fails safely', async () => {
  const store = fakeFs()
  await assert.rejects(profileless(store).apply('kimi-subscription-auto'), /owning profile/u)
  const noFile = editor(store)
  assert.equal(await noFile.remove(), false)
  assert.equal(await noFile.apply('kimi-subscription-auto'), true)
  assert.match(store.files.get('/dsh/profiles/web/cordis.patch.yml'), /- id: web/u)
})
