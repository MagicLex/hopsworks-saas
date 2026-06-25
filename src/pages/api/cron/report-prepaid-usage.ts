import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from '../../../lib/internal-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function sendSlack(text: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[report-prepaid-usage] SLACK_WEBHOOK_URL not set, skipping');
    return;
  }
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(err => console.error('[report-prepaid-usage] Slack failed:', err));
}

// Prepaid (corporate) accounts are metered but invoiced manually offline, never charged
// automatically. This monthly report surfaces last month's prepaid usage so finance can
// invoice it without it being forgotten. total_cost is the all-in amount to invoice
// (compute + prorated storage); compute hours and egress are shown for context.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireCronAuth(req, res)) return;

  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startStr = monthStart.toISOString().split('T')[0];
    const endStr = monthEnd.toISOString().split('T')[0];
    const label = startStr.slice(0, 7);

    // Prepaid account owners.
    const { data: owners, error: oErr } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('billing_mode', 'prepaid')
      .is('account_owner_id', null)
      .eq('status', 'active');
    if (oErr) throw new Error(`users query failed: ${oErr.message}`);
    if (!owners || owners.length === 0) {
      return res.status(200).json({ message: 'no prepaid accounts', month: label });
    }
    const ownerById = new Map(owners.map(o => [o.id, o]));

    // Last calendar month usage, aggregated to the account (coalesce account_owner_id, user_id).
    const { data: usage, error: uErr } = await supabaseAdmin
      .from('usage_daily')
      .select('user_id, account_owner_id, total_cost, opencost_cpu_hours, opencost_gpu_hours, opencost_ram_gb_hours, network_egress_gb')
      .gte('date', startStr)
      .lt('date', endStr);
    if (uErr) throw new Error(`usage_daily query failed: ${uErr.message}`);

    const totals = new Map<string, { cost: number; cpu: number; gpu: number; ram: number; egress: number }>();
    for (const row of usage || []) {
      const key = row.account_owner_id || row.user_id;
      if (!ownerById.has(key)) continue; // prepaid only
      const t = totals.get(key) || { cost: 0, cpu: 0, gpu: 0, ram: 0, egress: 0 };
      t.cost += row.total_cost || 0;
      t.cpu += row.opencost_cpu_hours || 0;
      t.gpu += row.opencost_gpu_hours || 0;
      t.ram += row.opencost_ram_gb_hours || 0;
      t.egress += row.network_egress_gb || 0;
      totals.set(key, t);
    }

    const lines = Array.from(totals.entries())
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([key, t]) => {
        const o = ownerById.get(key)!;
        return `• ${o.email}: *$${t.cost.toFixed(2)}* — cpu ${t.cpu.toFixed(1)}h, gpu ${t.gpu.toFixed(1)}h, ram ${t.ram.toFixed(0)}GB-h, egress ${t.egress.toFixed(1)}GB`;
      });

    if (lines.length > 0) {
      await sendSlack(`*Prepaid usage for ${label}* — invoice manually:\n${lines.join('\n')}`);
    }

    return res.status(200).json({ message: 'prepaid report sent', month: label, accounts: lines.length });
  } catch (error: any) {
    console.error('[report-prepaid-usage] failed', error);
    return res.status(500).json({ error: error.message || 'prepaid report failed' });
  }
}
