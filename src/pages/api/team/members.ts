import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';
import { suspendUser } from '@/lib/user-status';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  if (req.method === 'GET') {
    try {
      // Check if user is an account owner
      const { data: currentUser, error: userError } = await supabase
        .from('users')
        .select('account_owner_id')
        .eq('id', userId)
        .single();

      if (userError || !currentUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // If user is a team member, they can only see their own team
      const accountOwnerId = currentUser.account_owner_id || userId;

      // Get all team members for this account with their project assignments
      const { data: teamMembers, error } = await supabase
        .from('users')
        .select(`
          id,
          email,
          name,
          created_at,
          last_login_at,
          hopsworks_username,
          status,
          project_member_roles:project_member_roles!project_member_roles_member_id_fkey (
            project_name,
            role,
            synced_to_hopsworks
          )
        `)
        .eq('account_owner_id', accountOwnerId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch team members:', error);
        return res.status(500).json({ error: 'Failed to fetch team members' });
      }

      // Also get the account owner info
      const { data: owner, error: ownerError } = await supabase
        .from('users')
        .select(`
          id,
          email,
          name,
          created_at,
          stripe_customer_id
        `)
        .eq('id', accountOwnerId)
        .single();

      if (ownerError) {
        console.error('Failed to fetch owner:', ownerError);
        return res.status(500).json({ error: 'Failed to fetch account owner' });
      }

      return res.status(200).json({
        account_owner: owner,
        team_members: teamMembers || [],
        is_owner: userId === accountOwnerId
      });

    } catch (error) {
      console.error('List team members error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else if (req.method === 'DELETE') {
    try {
      const { memberId } = req.query;

      if (!memberId || typeof memberId !== 'string') {
        return res.status(400).json({ error: 'Member ID is required' });
      }

      // Only account owners can remove team members
      const { data: currentUser } = await supabase
        .from('users')
        .select('account_owner_id')
        .eq('id', userId)
        .single();

      if (currentUser?.account_owner_id !== null) {
        return res.status(403).json({ error: 'Only account owners can remove team members' });
      }

      // Verify the member belongs to this account
      const { data: member, error: memberError } = await supabase
        .from('users')
        .select('account_owner_id, email')
        .eq('id', memberId)
        .single();

      if (memberError || !member || member.account_owner_id !== userId) {
        return res.status(404).json({ error: 'Team member not found' });
      }

      // Suspend the member FIRST to revoke Hopsworks access
      // This must succeed before we orphan them from the team
      const suspendResult = await suspendUser(supabase as any, memberId, 'removed_from_team');
      if (!suspendResult.success) {
        console.error(`Failed to suspend team member ${memberId}:`, suspendResult.error);
        return res.status(500).json({
          error: 'Failed to revoke member access. Please try again or contact support.',
          details: suspendResult.error
        });
      }

      // Delete project_member_roles to clean up project access records
      const { error: rolesDeleteError } = await supabase
        .from('project_member_roles')
        .delete()
        .eq('member_id', memberId);

      if (rolesDeleteError) {
        console.error(`Failed to delete project roles for ${memberId}:`, rolesDeleteError);
        // Log but don't fail - member is already suspended, roles are orphaned but harmless
      }

      // Remove team member by setting account_owner_id to NULL
      // This converts them to a standalone (suspended) account
      const { error } = await supabase
        .from('users')
        .update({
          account_owner_id: null
        })
        .eq('id', memberId);

      if (error) {
        console.error('Failed to remove team member:', error);
        return res.status(500).json({ error: 'Failed to remove team member' });
      }

      // Track team member removal in PostHog
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: 'team_member_removed',
        properties: {
          removedMemberId: memberId,
          removedMemberEmail: member.account_owner_id ? 'team_member' : 'unknown',
        }
      });
      await posthog.shutdown();

      return res.status(200).json({ message: 'Team member removed successfully' });

    } catch (error) {
      console.error('Remove team member error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else if (req.method === 'PATCH') {
    // PATCH endpoint removed - team member project assignment should be handled via user_projects table
    return res.status(501).json({ error: 'Team member project assignment has been deprecated' });
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}