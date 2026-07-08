/**
 * Billing Enforcement Regression Tests
 *
 * Tests the pure policy resolution that drives applied_quota_tier.
 * If these break, accounts get throttled/frozen wrong = lost customers or money leaks.
 */

import { describe, it, expect } from 'vitest'
import {
  effectiveBudgetUsd,
  computeEnforcementState,
  resolveAppliedTier,
  FREE_DEFAULT_BUDGET_USD,
  THROTTLE_AT,
} from '@/config/enforcement'

describe('effectiveBudgetUsd', () => {
  it('free accounts get the default budget', () => {
    expect(effectiveBudgetUsd('free', null)).toBe(FREE_DEFAULT_BUDGET_USD)
    // free override: an explicit cap below the default still applies
    expect(effectiveBudgetUsd('free', null)).toBe(10)
  })

  it('paying accounts have no budget unless they set a cap', () => {
    expect(effectiveBudgetUsd('postpaid', null)).toBeNull()
    expect(effectiveBudgetUsd('prepaid', null)).toBeNull()
    expect(effectiveBudgetUsd('postpaid', 0)).toBeNull()
    expect(effectiveBudgetUsd('postpaid', 100)).toBe(100)
  })
})

describe('computeEnforcementState', () => {
  it('no budget is never enforced', () => {
    expect(computeEnforcementState(999999, null)).toBe('normal')
  })

  it('normal below the throttle threshold', () => {
    expect(computeEnforcementState(0, 10)).toBe('normal')
    expect(computeEnforcementState(8.99, 10)).toBe('normal')
  })

  it('throttled at the threshold, below budget', () => {
    expect(computeEnforcementState(10 * THROTTLE_AT, 10)).toBe('throttled')
    expect(computeEnforcementState(9.99, 10)).toBe('throttled')
  })

  it('frozen at or over budget', () => {
    expect(computeEnforcementState(10, 10)).toBe('frozen')
    expect(computeEnforcementState(11, 10)).toBe('frozen')
  })
})

describe('resolveAppliedTier', () => {
  it('normal state keeps the capacity ceiling', () => {
    expect(resolveAppliedTier('small', 'normal')).toBe('small')
    expect(resolveAppliedTier('medium', 'normal')).toBe('medium')
    expect(resolveAppliedTier('exempt', 'normal')).toBe('exempt')
  })

  it('budget enforcement overrides the ceiling', () => {
    expect(resolveAppliedTier('exempt', 'throttled')).toBe('throttled')
    expect(resolveAppliedTier('large', 'frozen')).toBe('frozen')
    expect(resolveAppliedTier('small', 'throttled')).toBe('throttled')
  })
})

describe('end-to-end ladder', () => {
  const resolve = (mode: string, cap: number | null, mtd: number, capacity: any) =>
    resolveAppliedTier(capacity, computeEnforcementState(mtd, effectiveBudgetUsd(mode, cap)))

  it('paying account with no cap stays unlimited regardless of spend', () => {
    expect(resolve('postpaid', null, 100000, 'exempt')).toBe('exempt')
  })

  it('free account walks normal -> throttled -> frozen', () => {
    expect(resolve('free', null, 5, 'small')).toBe('small')
    expect(resolve('free', null, 9, 'small')).toBe('throttled')
    expect(resolve('free', null, 10, 'small')).toBe('frozen')
  })

  it('paying self-cap walks the same ladder against the cap', () => {
    expect(resolve('postpaid', 100, 50, 'exempt')).toBe('exempt')
    expect(resolve('postpaid', 100, 90, 'exempt')).toBe('throttled')
    expect(resolve('postpaid', 100, 100, 'exempt')).toBe('frozen')
  })
})
