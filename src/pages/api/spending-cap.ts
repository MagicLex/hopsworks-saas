import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  // Check if user is account owner (team members can't set caps)
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, account_owner_id, spending_cap, spending_alerts_sent')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.account_owner_id) {
    return res.status(403).json({ error: 'Team members cannot manage spending caps' });
  }

  if (req.method === 'GET') {
    // Get current spending cap and monthly usage
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    // Get monthly total for this user (and their team members)
    const { data: monthlyUsage } = await supabaseAdmin
      .from('usage_daily')
      .select('total_cost')
      .or(`user_id.eq.${userId},account_owner_id.eq.${userId}`)
      .gte('date', startOfMonth.toISOString().split('T')[0]);

    const monthlyTotal = monthlyUsage?.reduce((sum, day) => sum + (day.total_cost || 0), 0) || 0;

    const percentUsed = user.spending_cap && user.spending_cap > 0
      ? (monthlyTotal / user.spending_cap) * 100
      : 0;

    return res.status(200).json({
      spendingCap: user.spending_cap,
      monthlyTotal,
      percentUsed: Math.round(percentUsed * 10) / 10,
      alertsSent: user.spending_alerts_sent
    });

  } else if (req.method === 'POST') {
    const { cap } = req.body;

    // Validate cap value
    if (cap !== null && cap !== undefined) {
      const capValue = parseFloat(cap);
      if (isNaN(capValue) || capValue < 0) {
        return res.status(400).json({ error: 'Invalid cap value. Must be a positive number or null to disable.' });
      }
    }

    // Update the spending cap
    const newCap = cap === null || cap === undefined || cap === '' ? null : parseFloat(cap);

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        spending_cap: newCap,
        // Reset alerts when cap changes (so user gets fresh notifications at new thresholds)
        spending_alerts_sent: null
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update spending cap:', updateError);
      return res.status(500).json({ error: 'Failed to update spending cap' });
    }

    return res.status(200).json({
      message: newCap === null ? 'Spending cap disabled' : `Spending cap set to $${newCap.toFixed(2)}`,
      spendingCap: newCap
    });

  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
