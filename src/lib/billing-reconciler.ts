import { SupabaseClient } from '@supabase/supabase-js';
import {
  effectiveBudgetUsd,
  computeEnforcementState,
  resolveAppliedTier,
  capacityForBillingMode,
  CapacityTier,
  EnforcementState,
} from '../config/enforcement';

export interface ReconcileSummary {
  accountsEvaluated: number;
  enforcementChanges: number; // accounts whose enforcement_state changed
  tierChanges: number;        // projects whose applied_quota_tier changed
  throttled: number;          // accounts currently throttled
  frozen: number;             // accounts currently frozen
  unresolved: number;         // accounts skipped because billing_mode is NULL (anomaly)
  unresolvedAccounts: string[]; // their ids, for alerting (never silent)
}

function startOfMonthUtc(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

// PostgREST caps responses at 1000 rows; a plain select silently truncates past
// that, which for billing data means silently under-counting. Page explicitly.
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${label} query failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Month-to-date recorded cost per account. Cost is attributed to the account owner
// via usage_daily.account_owner_id (NULL on the owner's own rows), so the account
// key is coalesce(account_owner_id, user_id) — same keying as the spending-cap check.
export async function monthToDateByAccount(
  supabase: SupabaseClient,
  startOfMonthStr: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const data = await fetchAll<{ user_id: string; account_owner_id: string | null; total_cost: number | null }>(
    (from, to) =>
      supabase
        .from('usage_daily')
        .select('user_id, account_owner_id, total_cost')
        .gte('date', startOfMonthStr)
        .order('id')
        .range(from, to),
    'usage_daily',
  );
  for (const row of data) {
    const key = row.account_owner_id || row.user_id;
    totals.set(key, (totals.get(key) || 0) + (row.total_cost || 0));
  }
  return totals;
}

// Reconcile loop: for every active account, derive the budget enforcement state from
// month-to-date cost and resolve each active project's applied_quota_tier. Idempotent
// (only writes on change) and self-healing (re-asserts state every run, including the
// month rollover that lifts a freeze). The bookkeeper materialises the resolved field
// into a Kubernetes ResourceQuota.
export async function reconcileBilling(supabase: SupabaseClient): Promise<ReconcileSummary> {
  const startOfMonthStr = startOfMonthUtc();
  const mtd = await monthToDateByAccount(supabase, startOfMonthStr);

  // Account owners only (account_owner_id IS NULL). Team members inherit the owner's
  // enforcement; their projects live under the owner in user_projects.
  const owners = await fetchAll<{
    id: string;
    billing_mode: string | null;
    spending_cap: number | null;
    enforcement_state: EnforcementState | null;
  }>(
    (from, to) =>
      supabase
        .from('users')
        .select('id, billing_mode, spending_cap, enforcement_state')
        .is('account_owner_id', null)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    'users',
  );

  // All active projects in one pass, grouped by owner: a per-owner query is ~1000
  // sequential round trips and blows the function's maxDuration.
  const allProjects = await fetchAll<{
    id: string;
    user_id: string;
    namespace: string;
    capacity_tier: string | null;
    applied_quota_tier: string | null;
  }>(
    (from, to) =>
      supabase
        .from('user_projects')
        .select('id, user_id, namespace, capacity_tier, applied_quota_tier')
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    'user_projects',
  );
  const projectsByOwner = new Map<string, typeof allProjects>();
  for (const p of allProjects) {
    const list = projectsByOwner.get(p.user_id);
    if (list) list.push(p);
    else projectsByOwner.set(p.user_id, [p]);
  }

  const summary: ReconcileSummary = {
    accountsEvaluated: 0,
    enforcementChanges: 0,
    tierChanges: 0,
    throttled: 0,
    frozen: 0,
    unresolved: 0,
    unresolvedAccounts: [],
  };

  for (const owner of owners || []) {
    summary.accountsEvaluated++;
    const monthlyTotal = mtd.get(owner.id) || 0;

    // NULL billing_mode must never silently resolve to 'normal' (unlimited). A
    // limbo account has no cluster and no projects; a NULL one with recorded cost
    // is an anomaly that needs resolving, not a free pass through every gate.
    if (!owner.billing_mode) {
      summary.unresolved++;
      summary.unresolvedAccounts.push(owner.id);
      console.error(
        `[reconcile] ${owner.id}: NULL billing_mode with $${monthlyTotal.toFixed(2)} month-to-date; ` +
          `skipping enforcement, needs resolution`,
      );
      continue;
    }

    const budget = effectiveBudgetUsd(owner.billing_mode, owner.spending_cap);
    const state: EnforcementState = computeEnforcementState(monthlyTotal, budget);
    if (state === 'frozen') summary.frozen++;
    else if (state === 'throttled') summary.throttled++;

    const prevState: EnforcementState = owner.enforcement_state || 'normal';
    if (state !== prevState) {
      const { error: upErr } = await supabase
        .from('users')
        .update({ enforcement_state: state })
        .eq('id', owner.id);
      if (upErr) {
        console.error(`[reconcile] ${owner.id}: failed to set enforcement_state: ${upErr.message}`);
        continue;
      }
      summary.enforcementChanges++;
      const budgetLabel = budget == null ? 'no budget' : `$${budget}`;
      console.log(
        `[reconcile] ${owner.id}: ${prevState} -> ${state} ($${monthlyTotal.toFixed(2)} / ${budgetLabel})`,
      );
    }

    // Resolve capacity and applied_quota_tier per active project of this account.
    // Capacity derives from billing_mode (webhook-created projects default to
    // 'small' regardless of the owner's plan, and up/downgrades must propagate);
    // medium/large are manual overrides for future fixed-price plans, left alone.
    const derivedCapacity = capacityForBillingMode(owner.billing_mode);
    const projects = projectsByOwner.get(owner.id) || [];

    for (const p of projects) {
      const current: CapacityTier = (p.capacity_tier as CapacityTier) || 'small';
      const capacity: CapacityTier =
        current === 'medium' || current === 'large' ? current : derivedCapacity;
      const applied = resolveAppliedTier(capacity, state);
      if (applied !== p.applied_quota_tier || capacity !== p.capacity_tier) {
        const { error: tErr } = await supabase
          .from('user_projects')
          .update({
            capacity_tier: capacity,
            applied_quota_tier: applied,
            quota_updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);
        if (tErr) {
          console.error(`[reconcile] ${p.namespace}: failed to set applied_quota_tier: ${tErr.message}`);
          continue;
        }
        summary.tierChanges++;
        console.log(`[reconcile] ${p.namespace}: ${p.applied_quota_tier} -> ${applied} (capacity ${capacity})`);
      }
    }
  }

  return summary;
}
