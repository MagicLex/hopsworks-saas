import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { sendUserActivated, sendPlanUpdated, sendMarketingUpdated } from '../../../lib/marketing-webhooks';
import { assignUserToCluster } from '../../../lib/cluster-assignment';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;
    const { marketingConsent, plan } = req.body;

    // Validate plan if provided
    if (plan && !['free', 'postpaid'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be "free" or "postpaid"' });
    }

    // Get current user state
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('email, billing_mode, marketing_consent, terms_accepted_at, account_owner_id')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Team members cannot change billing
    if (user.account_owner_id && plan) {
      return res.status(400).json({ error: 'Team members cannot select a plan' });
    }

    const oldBillingMode = user.billing_mode;
    const oldMarketingConsent = user.marketing_consent;
    const isFirstActivation = !user.terms_accepted_at;
    const newMarketingConsent = !!marketingConsent;

    // Build update object
    const updateData: Record<string, any> = {
      terms_accepted_at: new Date().toISOString(),
      marketing_consent: newMarketingConsent
    };

    // Set billing_mode if plan provided and user doesn't have one yet (or is explicitly changing)
    if (plan && !user.billing_mode) {
      updateData.billing_mode = plan;
    }

    // Update user
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating terms acceptance:', updateError);
      return res.status(500).json({ error: 'Failed to save consent' });
    }

    const finalPlan = updateData.billing_mode || user.billing_mode;

    // Fire webhooks based on what changed
    const webhookPromises: Promise<void>[] = [];

    // user.activated: First time user completes terms + has a plan
    if (isFirstActivation && finalPlan) {
      webhookPromises.push(
        sendUserActivated({
          userId,
          email: user.email,
          plan: finalPlan,
          marketingConsent: newMarketingConsent
        })
      );
    }

    // plan.updated: billing_mode changed
    if (plan && !oldBillingMode) {
      webhookPromises.push(
        sendPlanUpdated({
          userId,
          email: user.email,
          oldPlan: oldBillingMode,
          newPlan: plan,
          trigger: 'user_choice'
        })
      );
    }

    // marketing.updated: consent changed (for returning users)
    if (!isFirstActivation && oldMarketingConsent !== newMarketingConsent) {
      webhookPromises.push(
        sendMarketingUpdated({
          userId,
          email: user.email,
          oldConsent: oldMarketingConsent,
          newConsent: newMarketingConsent
        })
      );
    }

    // Fire webhooks (don't block response)
    Promise.all(webhookPromises).catch(err => {
      console.error('[Marketing] Webhook error in accept-terms:', err);
    });

    // Assign cluster for free users who just selected free plan
    let clusterAssigned = false;
    if (plan === 'free' && !oldBillingMode) {
      const clusterResult = await assignUserToCluster(supabaseAdmin, userId);
      clusterAssigned = clusterResult.success;
      if (clusterResult.success) {
        console.log(`Assigned free user ${userId} to cluster ${clusterResult.clusterId}`);
      } else {
        console.error(`Failed to assign free user ${userId}: ${clusterResult.error}`);
        await supabaseAdmin
          .from('health_check_failures')
          .insert({
            user_id: userId,
            email: user.email,
            check_type: 'cluster_assignment',
            error_message: clusterResult.error || 'Failed to assign cluster in accept-terms',
            details: { source: 'accept-terms', billing_mode: 'free' }
          });
      }
    }

    return res.status(200).json({
      success: true,
      plan: finalPlan,
      marketingConsent: newMarketingConsent,
      clusterAssigned
    });
  } catch (error) {
    console.error('Error in accept-terms:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
