import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@auth0/nextjs-auth0';
import { createClient } from '@supabase/supabase-js';
import { assignUserToCluster } from '../../../lib/cluster-assignment';
import { sendPlanUpdated, sendUserActivated } from '../../../lib/marketing-webhooks';

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
    const session = await getSession(req, res);
    if (!session?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = session.user.sub;

    // Get current user state
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, email, billing_mode, stripe_subscription_id, account_owner_id')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow team members to change billing
    if (user.account_owner_id) {
      return res.status(400).json({ error: 'Team members cannot change billing mode' });
    }

    // Don't allow if already has subscription (paid user)
    if (user.stripe_subscription_id) {
      return res.status(400).json({ error: 'User already has an active subscription' });
    }

    // Only change from postpaid (or null) to free
    if (user.billing_mode === 'prepaid') {
      return res.status(400).json({ error: 'Prepaid users cannot switch to free' });
    }

    // If already free, just ensure cluster is assigned
    const oldBillingMode = user.billing_mode;
    if (oldBillingMode !== 'free') {
      // Update billing mode to free
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ billing_mode: 'free' })
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update billing mode:', updateError);
        return res.status(500).json({ error: 'Failed to update billing mode' });
      }

      console.log(`User ${userId} switched from ${oldBillingMode || 'null'} to free`);

      // Fire webhooks (don't block response)
      // If this is first plan selection (oldBillingMode was null), also fire user.activated
      const isFirstPlan = !oldBillingMode;

      sendPlanUpdated({
        userId,
        email: user.email,
        oldPlan: oldBillingMode,
        newPlan: 'free',
        trigger: 'user_choice'
      }).catch(err => console.error('[Marketing] Plan webhook failed:', err));

      if (isFirstPlan) {
        // Get marketing consent for activation event
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('marketing_consent')
          .eq('id', userId)
          .single();

        sendUserActivated({
          userId,
          email: user.email,
          plan: 'free',
          marketingConsent: userData?.marketing_consent ?? false
        }).catch(err => console.error('[Marketing] Activation webhook failed:', err));
      }
    }

    // Assign cluster (will create Hopsworks user with maxProjects=1)
    const clusterResult = await assignUserToCluster(supabaseAdmin, userId);

    if (!clusterResult.success && !clusterResult.clusterId) {
      console.error(`Failed to assign cluster for free user ${userId}:`, clusterResult.error);
      await supabaseAdmin
        .from('health_check_failures')
        .insert({
          user_id: userId,
          email: user.email,
          check_type: 'cluster_assignment',
          error_message: clusterResult.error || 'Failed to assign cluster in start-free',
          details: { source: 'start-free', billing_mode: 'free' }
        });
      // Don't fail the request - user is now free, cluster will be assigned on next sync
    }

    return res.status(200).json({
      success: true,
      billingMode: 'free',
      clusterAssigned: clusterResult.success,
      clusterId: clusterResult.clusterId
    });
  } catch (error) {
    console.error('Error in start-free:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
