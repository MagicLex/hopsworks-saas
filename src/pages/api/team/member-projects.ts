import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { removeUserFromProject } from '@/lib/hopsworks-team';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  // Check if user is an account owner
  const { data: currentUser } = await supabaseAdmin
    .from('users')
    .select('account_owner_id')
    .eq('id', userId)
    .single();

  if (!currentUser || currentUser.account_owner_id !== null) {
    return res.status(403).json({ error: 'Only account owners can manage team projects' });
  }

  if (req.method === 'DELETE') {
    const { memberId, projectName } = req.body;

    if (!memberId || typeof memberId !== 'string' || !projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: 'memberId and projectName are required' });
    }

    try {
      // Verify the member belongs to this owner's team
      const { data: member } = await supabaseAdmin
        .from('users')
        .select('id, email, account_owner_id, hopsworks_user_id')
        .eq('id', memberId)
        .single();

      if (!member || member.account_owner_id !== userId) {
        return res.status(404).json({ error: 'Member not in your team' });
      }

      const { data: memberRole } = await supabaseAdmin
        .from('project_member_roles')
        .select('id, project_id, synced_to_hopsworks')
        .eq('member_id', memberId)
        .eq('project_name', projectName)
        .eq('account_owner_id', userId)
        .single();

      if (!memberRole) {
        return res.status(404).json({ error: `${member.email} has no access to ${projectName}` });
      }

      // Hopsworks first, DB second: a failed upstream removal must not leave
      // a silent desync where the chip disappears but access remains.
      // Never-synced rows have nothing to remove upstream.
      if (memberRole.synced_to_hopsworks && member.hopsworks_user_id) {
        const { data: ownerAssignment } = await supabaseAdmin
          .from('user_hopsworks_assignments')
          .select('hopsworks_clusters!inner(api_url, api_key)')
          .eq('user_id', userId)
          .single();
        const cluster = (ownerAssignment as any)?.hopsworks_clusters;

        if (!cluster) {
          return res.status(400).json({ error: 'No cluster assignment found' });
        }

        await removeUserFromProject(
          { apiUrl: cluster.api_url, apiKey: cluster.api_key },
          memberRole.project_id,
          member.hopsworks_user_id
        );
      }

      const { error: deleteError } = await supabaseAdmin
        .from('project_member_roles')
        .delete()
        .eq('id', memberRole.id);

      if (deleteError) {
        console.error('Failed to delete project member role:', deleteError);
        return res.status(500).json({ error: 'Removed from Hopsworks but failed to update records. Refresh and retry.' });
      }

      return res.status(200).json({
        message: `${member.email} removed from ${projectName}`,
        project: projectName
      });
    } catch (error: any) {
      console.error('Failed to remove member from project:', error);
      return res.status(502).json({ error: `Failed to remove from project: ${error.message || 'Hopsworks error'}` });
    }

  } else if (req.method === 'GET') {
    // Team member project tracking removed - too complex for read-only display
    // Users should manage projects directly in Hopsworks UI
    return res.status(200).json({
      projects: [],
      pendingCount: 0,
      hasPendingSync: false,
      message: 'Project management is handled in Hopsworks UI'
    });

  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
