import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';

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

  if (req.method === 'GET') {
    // Team member project tracking removed - too complex for read-only display
    // Users should manage projects directly in Hopsworks UI
    // See docs/reference/hopsworks-api.md for implementation details
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

/* POST method removed - team member project assignment should be done via Hopsworks UI
  } else if (req.method === 'POST') {
    const { memberId, projectName, projectId, role, action } = req.body;

    if (!memberId || !projectName || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate role
    const validRoles = ['Data owner', 'Data scientist'];
    if (action === 'add' && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    try {
      // Verify the member belongs to this owner's team
      const { data: teamMember } = await supabaseAdmin
        .from('users')
        .select('account_owner_id, hopsworks_user_id, hopsworks_username, email')
        .eq('id', memberId)
        .single();

      if (!teamMember || teamMember.account_owner_id !== userId) {
        return res.status(403).json({ error: 'Member not in your team' });
      }

      if (!teamMember.hopsworks_user_id) {
        return res.status(400).json({ error: 'Member has no Hopsworks user ID yet' });
      }

      // Get owner's cluster credentials
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select(`
          user_hopsworks_assignments!inner (
            hopsworks_cluster_id,
            hopsworks_clusters!inner (
              api_url,
              api_key
            )
          )
        `)
        .eq('id', userId)
        .single();

      if (!owner?.user_hopsworks_assignments?.[0]) {
        return res.status(404).json({ error: 'No cluster assignment found' });
      }

      const assignment = owner.user_hopsworks_assignments[0] as any;
      const credentials = {
        apiUrl: assignment.hopsworks_clusters.api_url,
        apiKey: assignment.hopsworks_clusters.api_key
      };

      if (action === 'add') {
        // Check if user already has a role for this project
        const { data: existingRole } = await supabaseAdmin
          .from('project_member_roles')
          .select('*')
          .eq('member_id', memberId)
          .eq('project_name', projectName)
          .eq('account_owner_id', userId)
          .single();

        if (existingRole) {
          // User already has access to this project - check if it's just a role change
          if (existingRole.role === role) {
            return res.status(400).json({
              error: `${teamMember.email} already has ${role} access to ${projectName}`
            });
          }

          // This is a role change - only allow if already synced to Hopsworks
          if (!existingRole.synced_to_hopsworks) {
            return res.status(400).json({
              error: `Cannot change role for ${teamMember.email} in ${projectName} - initial sync pending or failed`
            });
          }

          // For role changes, we should update not create
          // But Hopsworks doesn't support role updates via API yet
          return res.status(400).json({
            error: 'Role changes are not yet supported. Please remove the user and re-add with the new role.'
          });
        }

        // This is a new assignment - create it
        const { data: roleRecord, error: dbError } = await supabaseAdmin
          .rpc('upsert_project_member_role', {
            p_member_id: memberId,
            p_owner_id: userId,
            p_project_id: projectId || 0, // Will need to get this from Hopsworks
            p_project_name: projectName,
            p_role: role,
            p_added_by: userId
          });

        if (dbError) {
          console.error('Failed to save role to database:', dbError);
          return res.status(500).json({ error: 'Failed to save project assignment' });
        }

        try {
          // Then sync to Hopsworks
          await addUserToProject(credentials, projectName, teamMember.hopsworks_user_id, role as any);

          // Mark as synced if successful
          if (roleRecord) {
            await supabaseAdmin
              .from('project_member_roles')
              .update({
                synced_to_hopsworks: true,
                last_sync_at: new Date().toISOString(),
                sync_error: null
              })
              .eq('id', roleRecord);
          }

          return res.status(200).json({
            message: `Successfully added ${teamMember.email} to ${projectName} as ${role}`,
            project: projectName,
            role,
            synced: true
          });

        } catch (hopsworksError: any) {
          // If Hopsworks sync fails, keep the record but mark it as unsynced
          const errorMessage = hopsworksError.message || 'Failed to sync to Hopsworks';
          console.error('Hopsworks sync failed:', errorMessage);

          if (roleRecord) {
            await supabaseAdmin
              .from('project_member_roles')
              .update({
                synced_to_hopsworks: false,
                last_sync_at: new Date().toISOString(),
                sync_error: errorMessage
              })
              .eq('id', roleRecord);
          }

          // Return success but with sync warning
          return res.status(200).json({
            message: `Added ${teamMember.email} to ${projectName} as ${role} (pending sync)`,
            project: projectName,
            role,
            synced: false,
            warning: 'Project assignment saved but could not sync to Hopsworks',
            syncError: errorMessage
          });
        }

        // This line was moved into the try block above

      } else {
        return res.status(400).json({ error: 'Invalid action. Only "add" is supported.' });
      }

    } catch (error) {
      console.error('Failed to manage project role:', error);
      return res.status(500).json({ error: 'Failed to update project role' });
    }
*/
