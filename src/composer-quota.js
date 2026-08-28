const WINDOW_SECONDS = Object.freeze({ minute: 60, hour: 3600, day: 86_400, week: 604_800 })

function displayable(row) {
  return Number.isFinite(row?.remainingPercent)
    && row.remainingPercent >= 0
    && row.remainingPercent <= 100
}

function windowSeconds(row) {
  const factor = WINDOW_SECONDS[row?.window?.unit]
  const duration = row?.window?.duration
  return Number.isFinite(factor) && Number.isFinite(duration) && duration > 0
    ? factor * duration
    : undefined
}

function findWindow(rows, seconds) {
  return rows.find(row => displayable(row) && windowSeconds(row) === seconds)
}

/** Select the two Kimi plan windows rendered beside the conversation input. */
export function selectKimiComposerQuota(usage) {
  const rows = [usage?.summary, ...(Array.isArray(usage?.limits) ? usage.limits : [])].filter(Boolean)
  const fiveHour = findWindow(rows, 5 * 3600)
  const sevenDay = findWindow(rows, 7 * 86_400)
  if (fiveHour === undefined && sevenDay === undefined) return undefined
  return {
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(sevenDay === undefined ? {} : { sevenDay }),
  }
}

export function formatKimiComposerQuota(quota) {
  if (quota === undefined) return undefined
  const parts = []
  if (quota.fiveHour !== undefined) parts.push(`5h ${Math.round(quota.fiveHour.remainingPercent)}%`)
  if (quota.sevenDay !== undefined) parts.push(`7d ${Math.round(quota.sevenDay.remainingPercent)}%`)
  return parts.length === 0 ? undefined : parts.join('　')
}
