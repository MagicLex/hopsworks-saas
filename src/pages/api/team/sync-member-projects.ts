import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { addUserToProject } from '../../../lib/hopsworks-team';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;
  const { memberId } = req.body;

  if (!memberId || typeof memberId !== 'string') {
    return res.status(400).json({ error: 'Member ID required' });
  }

  try {
    // Check if user is an account owner
    const { data: currentUser } = await supabaseAdmin
      .from('users')
      .select('account_owner_id')
      .eq('id', userId)
      .single();

    if (!currentUser || currentUser.account_owner_id !== null) {
      return res.status(403).json({ error: 'Only account owners can sync team projects' });
    }

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

    // Get all projects that need syncing (either never synced or have errors)
    const { data: unsyncedProjects, error: fetchError } = await supabaseAdmin
      .from('project_member_roles')
      .select('*')
      .eq('member_id', memberId)
      .eq('account_owner_id', userId)
      .or('synced_to_hopsworks.eq.false,sync_error.not.is.null');

    if (fetchError) {
      console.error('Failed to fetch unsynced projects:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch projects' });
    }

    if (!unsyncedProjects || unsyncedProjects.length === 0) {
      return res.status(200).json({ 
        message: 'All projects are already synced',
        syncedCount: 0,
        failedCount: 0
      });
    }

    // Try to sync each project
    const results = {
      synced: [] as string[],
      failed: [] as { project: string; error: string }[]
    };

    for (const project of unsyncedProjects) {
      try {
        // Attempt to add user to project in Hopsworks
        await addUserToProject(
          credentials,
          project.project_name,
          teamMember.hopsworks_user_id,
          project.role as any
        );

        // Mark as synced if successful
        await supabaseAdmin
          .from('project_member_roles')
          .update({ 
            synced_to_hopsworks: true, 
            last_sync_at: new Date().toISOString(),
            sync_error: null 
          })
          .eq('id', project.id);

        results.synced.push(project.project_name);
        console.log(`Successfully synced ${teamMember.email} to project ${project.project_name}`);

      } catch (error: any) {
        const errorMessage = error.message || 'Unknown sync error';
        
        // Update sync error in database
        await supabaseAdmin
          .from('project_member_roles')
          .update({ 
            sync_error: errorMessage,
            last_sync_at: new Date().toISOString()
          })
          .eq('id', project.id);

        results.failed.push({ 
          project: project.project_name, 
          error: errorMessage 
        });
        
        console.error(`Failed to sync ${teamMember.email} to project ${project.project_name}:`, error);
      }
    }

    // Return detailed results
    const response: any = {
      message: results.synced.length > 0 
        ? `Successfully synced ${results.synced.length} project(s)` 
        : 'No projects could be synced',
      syncedCount: results.synced.length,
      failedCount: results.failed.length,
      syncedProjects: results.synced,
      failedProjects: results.failed
    };

    // Add warning if some projects failed
    if (results.failed.length > 0) {
      response.warning = `Failed to sync ${results.failed.length} project(s)`;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}