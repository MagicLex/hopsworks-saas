// Billing enforcement policy. Edit these values to retune; the resolution logic
// stays the same. See docs/BILLING_CONTROL_PLANE.md.

export const CAPACITY_TIERS = ['small', 'medium', 'large', 'exempt'] as const;
export type CapacityTier = typeof CAPACITY_TIERS[number];

export const ENFORCEMENT_STATES = ['normal', 'throttled', 'frozen'] as const;
export type EnforcementState = typeof ENFORCEMENT_STATES[number];

export type AppliedQuotaTier = CapacityTier | 'throttled' | 'frozen';

// Default month budget (USD) for free accounts. Paying accounts have no budget
// unless they set a spending_cap (self-imposed); that cap then drives the same ladder.
export const FREE_DEFAULT_BUDGET_USD = 10;

// Fraction of budget at which compute is throttled; at or over 100% it is frozen.
export const THROTTLE_AT = 0.9;

// Resolve the budget that applies to an account. null means "no budget, never enforced".
export function effectiveBudgetUsd(
  billingMode: string | null | undefined,
  spendingCap: number | null | undefined,
): number | null {
  if (billingMode === 'free') return FREE_DEFAULT_BUDGET_USD;
  // Paying: only a self-set cap creates a budget.
  return spendingCap && spendingCap > 0 ? spendingCap : null;
}

// Capacity axis: paying accounts are exempt (usage is billed), free accounts are
// capped at small. medium/large are reserved for future fixed-price plans and are
// only ever set manually, so deriving small/exempt must never overwrite them.
export function capacityForBillingMode(billingMode: string | null | undefined): 'small' | 'exempt' {
  return billingMode === 'postpaid' || billingMode === 'prepaid' ? 'exempt' : 'small';
}

// Budget axis: month-to-date recorded cost vs the account budget.
export function computeEnforcementState(
  monthToDateUsd: number,
  budgetUsd: number | null,
): EnforcementState {
  if (budgetUsd == null) return 'normal';
  if (monthToDateUsd >= budgetUsd) return 'frozen';
  if (monthToDateUsd >= budgetUsd * THROTTLE_AT) return 'throttled';
  return 'normal';
}

// Resolve the single field the bookkeeper applies. Budget enforcement overrides
// the capacity ceiling; otherwise the project keeps its ceiling.
export function resolveAppliedTier(
  capacityTier: CapacityTier,
  state: EnforcementState,
): AppliedQuotaTier {
  if (state === 'frozen') return 'frozen';
  if (state === 'throttled') return 'throttled';
  return capacityTier;
}
