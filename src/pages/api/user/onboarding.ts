import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@auth0/nextjs-auth0';
import { createClient } from '@supabase/supabase-js';
import { resolveOnboardingState, OnboardingResolution } from '@/lib/onboarding';
import { assignUserToCluster } from '@/lib/cluster-assignment';
import { handleApiError } from '@/lib/error-handler';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

interface OnboardingResponse extends OnboardingResolution {
  hasAccount: boolean;
}

async function computeState(req: NextApiRequest, res: NextApiResponse): Promise<{
  response: OnboardingResponse;
  userId: string | null;
}> {
  const session = await getSession(req, res);
  if (!session?.user) {
    return { response: { state: 'unauthenticated', hasAccount: false }, userId: null };
  }

  const userId = session.user.sub as string;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('deleted_at, status, account_owner_id, terms_accepted_at, billing_mode, stripe_subscription_id')
    .eq('id', userId)
    .single();

  let hasClusterAssignment = false;
  if (user) {
    const { data: assignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('hopsworks_cluster_id')
      .eq('user_id', userId)
      .maybeSingle();
    hasClusterAssignment = !!assignment;
  }

  const resolution = resolveOnboardingState({
    authenticated: true,
    emailVerified: (session.user as any).email_verified,
    user: user
      ? {
          deletedAt: user.deleted_at,
          status: user.status,
          accountOwnerId: user.account_owner_id,
          termsAcceptedAt: user.terms_accepted_at,
          billingMode: user.billing_mode,
          hasSubscription: !!user.stripe_subscription_id,
        }
      : null,
    hasClusterAssignment,
  });

  return { response: { ...resolution, hasAccount: !!user }, userId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { response } = await computeState(req, res);
      return res.status(200).json(response);
    }

    if (req.method === 'POST') {
      // Single transition action: retry a failed/stuck cluster assignment.
      // Idempotent — assignUserToCluster short-circuits when already assigned.
      const { action } = req.body || {};
      if (action !== 'retry_cluster') {
        return res.status(400).json({ error: 'Unknown action' });
      }

      const { response, userId } = await computeState(req, res);
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      if (response.state !== 'assigning_cluster') {
        return res.status(200).json(response);
      }

      // Postpaid users passed the payment gate (resolver requires a
      // subscription to reach assigning_cluster), so the manual-assignment
      // path is safe — it is the same call the Stripe webhook makes.
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('billing_mode, account_owner_id')
        .eq('id', userId)
        .single();
      const isManual = !user?.account_owner_id && user?.billing_mode === 'postpaid';

      const result = await assignUserToCluster(supabaseAdmin, userId, isManual);
      if (!result.success) {
        console.error(`[Onboarding] Cluster retry failed for ${userId}: ${result.error}`);
      }

      const { response: after } = await computeState(req, res);
      return res.status(200).json({ ...after, retryError: result.success ? undefined : result.error });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(error, res, `${req.method} /api/user/onboarding`);
  }
}
