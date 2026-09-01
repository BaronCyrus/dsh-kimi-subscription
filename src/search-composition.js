import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SEARCH_PATCH_FILE = 'cordis.patch.yml'

const BLOCK_BEGIN = '# >>> dsh-kimi-subscription: web search provider'
const BLOCK_END = '# <<< dsh-kimi-subscription: web search provider'
const EMPTY_LIST = /^\[\]\s*$/u
const LIST_ITEM = /^- /u

const hasEntries = content => content.split('\n').some(line => LIST_ITEM.test(line))

/** Remove this plugin's marked patch block; idempotent. */
export function stripSearchPatchBlock(content) {
  const lines = content.split('\n')
  const out = []
  let inside = false
  for (const line of lines) {
    if (line.includes(BLOCK_BEGIN)) {
      inside = true
      continue
    }
    if (line.includes(BLOCK_END)) {
      inside = false
      continue
    }
    if (!inside) out.push(line)
  }
  return out.join('\n')
}

function yamlScalar(value) {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value)
  if (typeof value !== 'string') throw new Error('Kimi search composition only supports scalar web config values')
  return /^[A-Za-z0-9._-]+$/u.test(value) ? value : JSON.stringify(value)
}

function patchBlock(searchProvider, baseConfig) {
  const config = {}
  for (const [key, value] of Object.entries(baseConfig)) {
    if (key === 'searchProvider') continue
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') config[key] = value
  }
  config.searchProvider = searchProvider
  const lines = Object.entries(config).map(([key, value]) => `    ${key}: ${yamlScalar(value)}`)
  return `${BLOCK_BEGIN}\n- id: web\n  config:\n${lines.join('\n')}\n${BLOCK_END}\n`
}

/**
 * Maintain this plugin's marked `- id: web` block inside the owning profile's
 * `cordis.patch.yml`. The DSH boot layer watches that file and hot-applies
 * edits transactionally, so writing the block changes the web row's base
 * `searchProvider` without a restart and without contesting the runtime slot
 * another subscription plugin's switcher keeps re-writing. Only the marked
 * block is ever touched; every other patch entry is preserved verbatim.
 */
export function createKimiSearchComposition({
  findProfile,
  readBaseConfig,
  dshHome,
  fs = { readFile, writeFile, rename },
} = {}) {
  if (typeof findProfile !== 'function') throw new Error('Kimi search composition requires findProfile')
  if (typeof readBaseConfig !== 'function') throw new Error('Kimi search composition requires readBaseConfig')
  if (typeof dshHome !== 'string' || dshHome === '') throw new Error('Kimi search composition requires dshHome')

  const patchPath = async () => {
    const profile = await findProfile()
    if (typeof profile !== 'string' || profile === '') {
      throw new Error('Kimi search composition could not find the owning profile')
    }
    return join(dshHome, 'profiles', profile, SEARCH_PATCH_FILE)
  }

  const readPatch = async file => {
    try {
      return await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      throw error
    }
  }

  const writePatch = async (file, content, previous) => {
    if (content === previous) return false
    const temporary = `${file}.tmp`
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, file)
    return true
  }

  return Object.freeze({
    /** Write (or refresh) the marked block so the web base config selects the provider. */
    async apply(searchProvider) {
      const file = await patchPath()
      const existing = await readPatch(file)
      const stripped = stripSearchPatchBlock(existing)
      const kept = hasEntries(stripped) ? stripped : stripped.split('\n').filter(line => !EMPTY_LIST.test(line)).join('\n')
      const head = kept.trimEnd()
      const block = patchBlock(searchProvider, readBaseConfig())
      const body = head === '' ? block : `${head}\n${block}`
      return writePatch(file, body, existing)
    },

    /** Remove the marked block, restoring an empty patch list when nothing else remains. */
    async remove() {
      const file = await patchPath()
      const existing = await readPatch(file)
      if (existing === '') return false
      const stripped = stripSearchPatchBlock(existing)
      if (stripped === existing) return false
      const head = stripped.trimEnd()
      const body = hasEntries(stripped) ? `${head}\n` : head === '' ? '[]\n' : `${head}\n[]\n`
      return writePatch(file, body, existing)
    },
  })
}
