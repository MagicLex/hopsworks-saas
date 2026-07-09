import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Per-user activity for the admin panel: lifecycle webhook events
// (lifecycle_events, populated since the receiver started logging) joined
// with usage_daily for the compute side. No filter = recent global feed.

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    if (!email) {
      const { data: events, error } = await supabase
        .from('lifecycle_events')
        .select('event, email, project_name, cluster_id, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ events: events ?? [], daily: null, user: null });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, email, billing_mode, status, last_login_at, login_count, created_at')
      .ilike('email', email)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) {
      return res.status(404).json({ error: `No user with email ${email}` });
    }

    const sinceDate = since.slice(0, 10);
    const [{ data: events, error: evErr }, { data: usage, error: usErr }] = await Promise.all([
      supabase
        .from('lifecycle_events')
        .select('event, project_name, created_at')
        .or(`user_id.eq.${JSON.stringify(user.id)},email.eq.${JSON.stringify(user.email)}`)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('usage_daily')
        .select('date, total_cost, opencost_cpu_hours, opencost_gpu_hours, online_storage_gb, project_breakdown')
        .eq('user_id', user.id)
        .gte('date', sinceDate)
        .order('date', { ascending: false }),
    ]);
    if (evErr) throw evErr;
    if (usErr) throw usErr;

    // Daily rollup: events condensed per type + metered usage, one row per day
    const byDay = new Map<string, { events: Record<string, number>; cost: number; cpuHours: number; namespaces: string[] }>();
    const day = (iso: string) => String(iso).slice(0, 10);
    const ensure = (d: string) => {
      let row = byDay.get(d);
      if (!row) {
        row = { events: {}, cost: 0, cpuHours: 0, namespaces: [] };
        byDay.set(d, row);
      }
      return row;
    };
    for (const e of events ?? []) {
      const row = ensure(day(e.created_at));
      row.events[e.event] = (row.events[e.event] ?? 0) + 1;
    }
    for (const u of usage ?? []) {
      const row = ensure(day(u.date));
      row.cost += Number(u.total_cost) || 0;
      row.cpuHours += Number(u.opencost_cpu_hours) || 0;
      row.namespaces = Object.keys(u.project_breakdown ?? {});
    }
    const daily = Array.from(byDay.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, row]) => ({
        date,
        events: row.events,
        cost: Math.round(row.cost * 100) / 100,
        cpuHours: Math.round(row.cpuHours * 10) / 10,
        namespaces: row.namespaces,
      }));

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        billingMode: user.billing_mode,
        status: user.status,
        lastLoginAt: user.last_login_at,
        loginCount: user.login_count,
        createdAt: user.created_at,
      },
      daily,
      events: (events ?? []).slice(0, 100),
    });
  } catch (error) {
    console.error('Admin activity error:', error);
    return res.status(500).json({ error: 'Failed to load activity' });
  }
}

export default async function (req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}
