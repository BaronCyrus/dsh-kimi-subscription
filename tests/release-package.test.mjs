import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path, encoding = 'utf8') => readFile(new URL(`../${path}`, import.meta.url), encoding)

test('release package includes bilingual documentation and the README mascot', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const required = ['README.md', 'README.en.md', 'docs/guide.zh-CN.md', 'docs/guide.en.md', 'docs/assets/dsh-kimi-mascot.png']
  for (const path of required) {
    assert.ok(manifest.files.includes(path), `publish files must include ${path}`)
    assert.ok((await read(path, null)).length > 0, `${path} must exist and be nonempty`)
  }
  for (const path of ['README.md', 'README.en.md']) {
    assert.ok((await read(path)).includes('docs/assets/dsh-kimi-mascot.png'))
  }
  for (const path of ['docs/guide.zh-CN.md', 'docs/guide.en.md']) {
    const guide = await read(path)
    assert.ok(guide.includes(`${manifest.name}@${manifest.version}`), `${path} must pin the release version`)
    assert.ok(guide.includes(`${manifest.name}-${manifest.version}.tgz`), `${path} must name the release archive`)
  }
  assert.ok((await read('CHANGELOG.md')).includes(`## ${manifest.version}`))
})
