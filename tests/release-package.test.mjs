import assert from 'node:assert/strict'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (path, encoding = 'utf8') => readFile(new URL(`../${path}`, import.meta.url), encoding)

test('plugin card icon is declared, packaged, and within the host byte limit', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.icon, './icon-subscription.webp', 'DSH reads the top-level icon field')
  assert.equal(manifest.exports['./package.json'], './package.json', 'DSH must resolve the exported manifest')

  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
  const iconPath = await realpath(resolve(root, manifest.icon))
  const local = relative(root, iconPath)
  assert.ok(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`), 'icon must remain inside the package')
  assert.ok((await stat(iconPath)).isFile(), 'icon must be a regular file')
  assert.ok(manifest.files.includes(manifest.icon.slice(2)), 'publish files must include the icon')

  const bytes = await readFile(iconPath)
  assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024, 'DSH admits icon files of at most 256 KiB')
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP container must be complete')
})

test('plugin card title and description are localized through exported locale files', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', 'DSH resolves <package>/locale/<lang>.json through exports')
  assert.ok(manifest.files.includes('locale/*.json'), 'publish files must include the locale files')

  const expected = { en: 'Kimi Subscription', 'zh-CN': 'Kimi 订阅' }
  const languageId = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
  const present = (await readdir(new URL('../locale/', import.meta.url))).filter(name => name.endsWith('.json'))
  assert.deepEqual(present.sort(), Object.keys(expected).map(id => `${id}.json`).sort())
  for (const name of present) {
    assert.match(name.slice(0, -5), languageId, `${name} must be named by a language id`)
    const { meta } = JSON.parse(await read(`locale/${name}`))
    assert.equal(meta.title, expected[name.slice(0, -5)])
    assert.equal(typeof meta.description, 'string')
    assert.ok(meta.description.trim().length > 0, `${name} must carry a nonempty description`)
  }
})

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

test('release package includes every local README image', async () => {
  const manifest = JSON.parse(await read('package.json'))
  for (const path of ['README.md', 'README.en.md']) {
    const images = [...(await read(path)).matchAll(/<img\b[^>]*\bsrc="(docs\/[^"]+)"/gu)].map(match => match[1])
    assert.ok(images.includes('docs/assets/sponsor-wechat.png') && images.includes('docs/assets/sponsor-alipay.png'), `${path} must show both tip codes`)
    for (const image of images) {
      assert.ok(manifest.files.includes(image), `publish files must include ${image}`)
      assert.ok((await read(image, null)).length > 0, `${image} must exist and be nonempty`)
    }
  }
})
