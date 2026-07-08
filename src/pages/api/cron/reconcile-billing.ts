import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from '../../../lib/internal-auth';
import { reconcileBilling } from '../../../lib/billing-reconciler';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// NULL billing_mode accounts must never pass silently (BILLING_CONTROL_PLANE.md).
// They are an anomaly the reconciler cannot resolve, so surface them loudly.
async function alertUnresolved(accountIds: string[]) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  const text =
    `:warning: *Billing reconciliation* — ${accountIds.length} account(s) with NULL billing_mode ` +
    `skipped (cannot resolve enforcement):\n${accountIds.slice(0, 10).join(', ')}` +
    `${accountIds.length > 10 ? '…' : ''}`;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(err => console.error('[reconcile-billing] Slack alert failed:', err));
}

// Reconciles budget enforcement into applied_quota_tier for every active account.
// Runs on a schedule (vercel.json); the bookkeeper applies the resolved tier in-cluster.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireCronAuth(req, res)) return;

  try {
    const summary = await reconcileBilling(supabaseAdmin);
    console.log('[reconcile-billing] complete', summary);
    if (summary.unresolvedAccounts.length > 0) {
      await alertUnresolved(summary.unresolvedAccounts);
    }
    return res.status(200).json({ message: 'billing reconciliation complete', ...summary });
  } catch (error: any) {
    console.error('[reconcile-billing] failed', error);
    return res.status(500).json({ error: error.message || 'reconciliation failed' });
  }
}
