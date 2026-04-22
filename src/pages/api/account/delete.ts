import { NextApiRequest, NextApiResponse } from 'next';
import { withApiAuthRequired } from '@auth0/nextjs-auth0';
import { createClient } from '@supabase/supabase-js';
import { deactivateUser } from '../../../lib/user-status';
import { requireActiveSession } from '@/lib/require-active-session';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default withApiAuthRequired(async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;
    const { reason } = req.body || {};

    // Check if user is account owner with team members
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('account_owner_id')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('Error fetching user:', userError);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    // Only account owners (account_owner_id IS NULL) can self-delete
    // Team members should be removed by their owner
    if (user.account_owner_id !== null) {
      return res.status(403).json({
        error: 'Team members cannot self-delete. Contact your account owner to be removed.'
      });
    }

    // Check for team members
    const { data: teamMembers, error: teamError } = await supabase
      .from('users')
      .select('id')
      .eq('account_owner_id', userId);

    if (teamError) {
      console.error('Error fetching team members:', teamError);
      return res.status(500).json({ error: 'Failed to check team members' });
    }

    if (teamMembers && teamMembers.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete account with active team members. Remove all team members first.'
      });
    }

    // Deactivate user (soft delete - includes Hopsworks deactivation)
    const result = await deactivateUser(supabase as any, userId, reason || 'user_requested');

    if (!result.success) {
      console.error('Error deactivating user:', result.error);
      return res.status(500).json({ error: 'Failed to delete account' });
    }

    return res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Error in account deletion:', error);
    return res.status(500).json({
      error: 'Failed to process account deletion'
    });
  }
});