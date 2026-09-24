import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'kimi-subscription'
export const SEARCH_PROVIDER_FIELD = 'searchProvider'
export const SEARCH_PROVIDER_DEFAULT = 'default'
export const SEARCH_PROVIDER_AUTO = 'auto'
export const SEARCH_PROVIDER_KIMI = 'kimi'
export const SEARCH_PROVIDER_CHOICES = Object.freeze([
  SEARCH_PROVIDER_DEFAULT,
  SEARCH_PROVIDER_AUTO,
  SEARCH_PROVIDER_KIMI,
])

const choice = () => z.union(SEARCH_PROVIDER_CHOICES).default(SEARCH_PROVIDER_DEFAULT)

/**
 * DSH 0.1.7 stores plugin preferences as volatile Config fields. Older hosts
 * still expose `settings.register`, which rejects a volatile schema, so the
 * legacy registration keeps a plain field.
 */
export const Config = z.object({
  [SEARCH_PROVIDER_FIELD]: typeof choice().volatile === 'function' ? choice().volatile() : choice(),
})

const readChoice = value => SEARCH_PROVIDER_CHOICES.includes(value) ? value : SEARCH_PROVIDER_DEFAULT

const currentChoice = config => {
  const field = config?.[SEARCH_PROVIDER_FIELD]
  const value = field !== null && typeof field === 'object' && typeof field.get === 'function'
    ? field.get()
    : field
  return readChoice(value)
}

/**
 * Search-provider preference for both settings implementations.
 * @param ctx Host plugin context. `settings.register` selects the legacy store.
 * @param config Resolved plugin Config on hosts that pass it to `apply`.
 */
export function createSearchSettings(ctx, config) {
  if (typeof ctx.settings?.register === 'function') {
    return ctx.settings.register(SETTINGS_NAMESPACE, z.object({
      [SEARCH_PROVIDER_FIELD]: choice(),
    }))
  }

  const watchers = new Set()
  const notify = () => {
    const value = { [SEARCH_PROVIDER_FIELD]: currentChoice(config) }
    for (const watcher of watchers) watcher(value)
  }
  if (typeof ctx.settings?.configure === 'function') {
    ctx.effect?.(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  }
  ctx.on?.('loader/volatile-update', () => notify())
  return {
    get: () => ({ [SEARCH_PROVIDER_FIELD]: currentChoice(config) }),
    watch: callback => {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },
    update: async patch => {
      const value = readChoice(patch?.[SEARCH_PROVIDER_FIELD])
      if (value !== patch?.[SEARCH_PROVIDER_FIELD]) throw new Error('Invalid search provider preference')
      const entryId = ctx.fiber?.entry?.options?.id ?? SETTINGS_NAMESPACE
      if (typeof ctx.settings?.update !== 'function') throw new Error('Kimi search preference is unavailable')
      await ctx.settings.update(entryId, { [SEARCH_PROVIDER_FIELD]: value })
      notify()
    },
  }
}
