import assert from 'node:assert/strict'
import test from 'node:test'

import { formatKimiComposerQuota, selectKimiComposerQuota } from '../src/composer-quota.js'

test('composer quota selects and formats 5-hour and 7-day remaining windows uniformly', () => {
  const usage = {
    summary: { window: { duration: 1, unit: 'week' }, remainingPercent: 64, resetAt: '2026-08-03T00:00:00Z' },
    limits: [
      { window: { duration: 5, unit: 'hour' }, remainingPercent: 82, resetAt: '2026-07-29T00:00:00Z' },
      { window: { duration: 1, unit: 'day' }, remainingPercent: 12 },
    ],
  }
  const quota = selectKimiComposerQuota(usage)
  assert.equal(quota.fiveHour.remainingPercent, 82)
  assert.equal(quota.sevenDay.remainingPercent, 64)
  assert.equal(formatKimiComposerQuota(quota), '5h 82%　7d 64%')
})

test('composer quota tolerates one missing window and rejects malformed values', () => {
  assert.equal(formatKimiComposerQuota(selectKimiComposerQuota({
    summary: null,
    limits: [{ window: { duration: 5, unit: 'hour' }, remainingPercent: 42.4 }],
  })), '5h 42%')
  assert.equal(selectKimiComposerQuota({
    summary: { window: { duration: 1, unit: 'week' }, remainingPercent: 101 },
    limits: [],
  }), undefined)
})
