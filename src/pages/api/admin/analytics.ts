import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Business analytics for the admin panel: consumption by segment, top
// consumers, lifetime value, signup cohorts. Everything is aggregated in JS
// from paginated reads (usage_daily is ~14k rows total) — no SQL views to
// migrate, no denormalized state.

const PAGE = 1000;

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

type Segment = 'free' | 'postpaid' | 'prepaid' | 'limbo' | 'unknown';

function segmentOf(billingMode: string | null | undefined): Segment {
  if (billingMode === 'free' || billingMode === 'postpaid' || billingMode === 'prepaid') return billingMode;
  return 'limbo';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  try {
    const owners = await fetchAll<any>((from, to) =>
      supabase
        .from('users')
        .select('id, email, billing_mode, status, created_at, last_login_at, deleted_at')
        .is('account_owner_id', null)
        .range(from, to)
    );

    const usage = await fetchAll<any>((from, to) =>
      supabase
        .from('usage_daily')
        .select('user_id, account_owner_id, date, total_cost, total_credits, opencost_cpu_hours')
        .range(from, to)
    );

    const ownerById = new Map(owners.map(o => [o.id, o]));
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Per-owner accumulation
    interface OwnerAgg { lifetimeCost: number; monthCost: number; monthCpuHours: number; activeDays: number }
    const perOwner = new Map<string, OwnerAgg>();
    // Per-month, per-segment cost
    const perMonth = new Map<string, Record<Segment, number>>();

    for (const row of usage) {
      const ownerId = row.account_owner_id ?? row.user_id;
      const owner = ownerById.get(ownerId);
      const segment: Segment = owner ? segmentOf(owner.billing_mode) : 'unknown';
      const month = String(row.date).slice(0, 7);
      const cost = Number(row.total_cost) || 0;

      let m = perMonth.get(month);
      if (!m) {
        m = { free: 0, postpaid: 0, prepaid: 0, limbo: 0, unknown: 0 };
        perMonth.set(month, m);
      }
      m[segment] += cost;

      let agg = perOwner.get(ownerId);
      if (!agg) {
        agg = { lifetimeCost: 0, monthCost: 0, monthCpuHours: 0, activeDays: 0 };
        perOwner.set(ownerId, agg);
      }
      agg.lifetimeCost += cost;
      agg.activeDays += 1;
      if (month === currentMonth) {
        agg.monthCost += cost;
        agg.monthCpuHours += Number(row.opencost_cpu_hours) || 0;
      }
    }

    // Monthly trend, oldest first, last 6 months
    const monthly = Array.from(perMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, seg]) => {
        const rounded: Record<string, number> = {};
        for (const [k, v] of Object.entries(seg)) rounded[k] = Math.round((v as number) * 100) / 100;
        const total = Object.values(seg).reduce((s: number, v) => s + (v as number), 0);
        return { month, ...rounded, total: Math.round(total * 100) / 100 };
      });

    // Top consumers this month, per segment
    const consumers = Array.from(perOwner.entries())
      .filter(([, a]) => a.monthCost > 0)
      .map(([id, a]) => {
        const owner = ownerById.get(id);
        return {
          id,
          email: owner?.email ?? id,
          segment: owner ? segmentOf(owner.billing_mode) : ('unknown' as Segment),
          status: owner?.status ?? 'unknown',
          monthCost: Math.round(a.monthCost * 100) / 100,
          monthCpuHours: Math.round(a.monthCpuHours * 10) / 10,
          lifetimeCost: Math.round(a.lifetimeCost * 100) / 100,
        };
      })
      .sort((a, b) => b.monthCost - a.monthCost);

    const topBySegment: Record<string, typeof consumers> = {};
    for (const seg of ['free', 'postpaid', 'prepaid'] as Segment[]) {
      topBySegment[seg] = consumers.filter(c => c.segment === seg).slice(0, 10);
    }

    // Segment summary: population, activity, value
    const now = Date.now();
    const THIRTY_D = 30 * 24 * 3600 * 1000;
    const segments = (['free', 'postpaid', 'prepaid', 'limbo'] as Segment[]).map(seg => {
      const pop = owners.filter(o => !o.deleted_at && segmentOf(o.billing_mode) === seg);
      const consuming = pop.filter(o => (perOwner.get(o.id)?.monthCost ?? 0) > 0);
      const lifetimes = pop
        .map(o => perOwner.get(o.id)?.lifetimeCost ?? 0)
        .filter(v => v > 0)
        .sort((a, b) => a - b);
      const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
      return {
        segment: seg,
        users: pop.length,
        active30d: pop.filter(o => o.last_login_at && now - new Date(o.last_login_at).getTime() < THIRTY_D).length,
        consumingThisMonth: consuming.length,
        monthCost: Math.round(sum(consuming.map(o => perOwner.get(o.id)!.monthCost)) * 100) / 100,
        avgMonthCostPerConsumer: consuming.length
          ? Math.round((sum(consuming.map(o => perOwner.get(o.id)!.monthCost)) / consuming.length) * 100) / 100
          : 0,
        // Lifetime value proxy: cumulative metered value per ever-consuming user
        avgLifetimeValue: lifetimes.length ? Math.round((sum(lifetimes) / lifetimes.length) * 100) / 100 : 0,
        medianLifetimeValue: lifetimes.length ? Math.round(lifetimes[Math.floor(lifetimes.length / 2)] * 100) / 100 : 0,
      };
    });

    // Signup cohorts, last 6 months: who signed up, who is still around
    const cohortMap = new Map<string, { size: number; activeNow: number; consumingNow: number }>();
    for (const o of owners) {
      if (o.deleted_at) continue;
      const month = String(o.created_at).slice(0, 7);
      let c = cohortMap.get(month);
      if (!c) {
        c = { size: 0, activeNow: 0, consumingNow: 0 };
        cohortMap.set(month, c);
      }
      c.size += 1;
      if (o.last_login_at && now - new Date(o.last_login_at).getTime() < THIRTY_D) c.activeNow += 1;
      if ((perOwner.get(o.id)?.monthCost ?? 0) > 0) c.consumingNow += 1;
    }
    const cohorts = Array.from(cohortMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, c]) => ({ month, ...c }));

    return res.status(200).json({
      currentMonth,
      monthly,
      segments,
      topBySegment,
      cohorts,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    return res.status(500).json({ error: 'Failed to compute analytics' });
  }
}

export default async function (req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}
