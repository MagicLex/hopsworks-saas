import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { alertBillingFailure } from '../../../lib/error-handler';
import { requireCronAuth } from '../../../lib/internal-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

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

// This endpoint syncs usage data to Stripe
// Should be called daily by a cron job
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireCronAuth(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reportDate = yesterday.toISOString().split('T')[0];

    console.log(`Starting Stripe usage sync for date: ${reportDate}`);

    // Get all unreported usage for yesterday (postpaid account owners only)
    const { data: unreportedUsage, error: usageError } = await supabaseAdmin
      .from('usage_daily')
      .select(`
        *,
        users!usage_daily_user_id_fkey!inner (
          stripe_customer_id,
          stripe_subscription_id,
          email,
          billing_mode,
          account_owner_id
        )
      `)
      .eq('date', reportDate)
      .eq('reported_to_stripe', false)
      .eq('users.billing_mode', 'postpaid')
      .is('users.account_owner_id', null)
      .not('users.stripe_subscription_id', 'is', null);

    if (usageError) {
      throw new Error(`Failed to fetch usage data: ${usageError.message}`);
    }

    if (!unreportedUsage || unreportedUsage.length === 0) {
      return res.status(200).json({ 
        message: 'No unreported usage found',
        date: reportDate 
      });
    }

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Process each user's usage
    for (const usage of unreportedUsage) {
      try {
        const customerId = usage.users.stripe_customer_id;

        // Idempotency key base - ensures retry won't double-bill
        const idempotencyBase = `usage_${usage.id}`;

        // Report compute credits (send as centi-credits for Stripe integer requirement)
        if (usage.total_credits > 0) {
          const centiCredits = Math.round(usage.total_credits * 100); // 1.11 credits → 111 centi-credits
          const cpuUsageRecord = await stripe.billing.meterEvents.create({
            event_name: 'compute_credits',
            payload: {
              value: String(centiCredits),
              stripe_customer_id: customerId,
            },
            timestamp: Math.floor(new Date(reportDate).getTime() / 1000)
          }, {
            idempotencyKey: `${idempotencyBase}_compute`
          });

          // Update our record with Stripe ID
          const { error: updateError } = await supabaseAdmin
            .from('usage_daily')
            .update({
              stripe_usage_record_id: cpuUsageRecord.identifier
            })
            .eq('id', usage.id);

          if (updateError) {
            console.error(`Failed to update usage_daily with Stripe record ID for user ${usage.user_id}:`, updateError);
            // Don't throw - we already reported to Stripe, log for manual reconciliation
          }
        }

        // Report online storage GB (prorated daily for GB-month billing)
        // We send daily_snapshot / 30, Stripe sums over month → correct GB-month
        // Example: 1.2 GB stored → send 0.04/day → 30 days = 1.2 GB-month
        if (usage.online_storage_gb > 0) {
          const dailyOnlineGb = usage.online_storage_gb / 30;
          await stripe.billing.meterEvents.create({
            event_name: 'storage_online_gb',
            payload: {
              value: String(Math.round(dailyOnlineGb * 1000) / 1000), // 3 decimal precision
              stripe_customer_id: customerId,
            },
            timestamp: Math.floor(new Date(reportDate).getTime() / 1000)
          }, {
            idempotencyKey: `${idempotencyBase}_online_storage`
          });
        }

        // Report offline storage GB (prorated daily for GB-month billing)
        if (usage.offline_storage_gb > 0) {
          const dailyOfflineGb = usage.offline_storage_gb / 30;
          await stripe.billing.meterEvents.create({
            event_name: 'storage_offline_gb',
            payload: {
              value: String(Math.round(dailyOfflineGb * 1000) / 1000), // 3 decimal precision
              stripe_customer_id: customerId,
            },
            timestamp: Math.floor(new Date(reportDate).getTime() / 1000)
          }, {
            idempotencyKey: `${idempotencyBase}_offline_storage`
          });
        }

        // Mark as reported
        const { error: reportedError } = await supabaseAdmin
          .from('usage_daily')
          .update({ reported_to_stripe: true })
          .eq('id', usage.id);

        if (reportedError) {
          console.error(`[BILLING] Failed to mark usage as reported for ${usage.users.email}:`, reportedError);
          // Data is in Stripe - idempotency keys prevent double-billing on retry
        }

        results.successful++;
      } catch (error) {
        console.error(`Failed to sync usage for user ${usage.user_id}:`, error);
        results.failed++;
        results.errors.push(`User ${usage.users.email}: ${error instanceof Error ? error.message : String(error)}`);

        // Failed to report - error already logged
      }
    }

    console.log(`Stripe sync completed: ${results.successful} successful, ${results.failed} failed`);

    // Alert if any failures
    if (results.failed > 0) {
      await alertBillingFailure(
        'sync_stripe_usage',
        `${results.failed} users`,
        new Error(results.errors.slice(0, 3).join('; ')),
        { date: reportDate, failed: results.failed, successful: results.successful }
      );
    }

    return res.status(200).json({
      message: 'Usage sync completed',
      date: reportDate,
      results
    });
  } catch (error) {
    console.error('Error syncing usage to Stripe:', error);
    return res.status(500).json({ 
      error: 'Failed to sync usage data',
      message: error instanceof Error ? error.message : String(error) 
    });
  }
}