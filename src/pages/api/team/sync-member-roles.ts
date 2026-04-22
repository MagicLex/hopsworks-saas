import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Create HTTPS agent for self-signed certificates
let httpsAgent: any = undefined;
if (typeof process !== 'undefined' && process.versions?.node) {
  const https = require('https');
  httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if user is an account owner
    const { data: currentUser } = await supabaseAdmin
      .from('users')
      .select('account_owner_id, hopsworks_username')
      .eq('id', userId)
      .single();

    if (!currentUser || currentUser.account_owner_id !== null) {
      return res.status(403).json({ error: 'Only account owners can sync roles' });
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

    // Get all team members
    const { data: teamMembers } = await supabaseAdmin
      .from('users')
      .select('id, email, hopsworks_username')
      .eq('account_owner_id', userId);

    if (!teamMembers || teamMembers.length === 0) {
      return res.status(200).json({ message: 'No team members to sync' });
    }

    // Get all owner's projects from Hopsworks
    const projectsResponse = await fetch(
      `${credentials.apiUrl}/hopsworks-api/api/project`,
      {
        headers: {
          'Authorization': `ApiKey ${credentials.apiKey}`
        },
        // @ts-ignore
        agent: httpsAgent
      }
    );

    if (!projectsResponse.ok) {
      throw new Error('Failed to fetch projects from Hopsworks');
    }

    const projectsData = await projectsResponse.json();
    const projects = Array.isArray(projectsData) ? projectsData : (projectsData.items || []);

    let syncedCount = 0;
    let errors = [];

    // For each project, fetch its members and their roles
    for (const project of projects) {
      try {
        const membersResponse = await fetch(
          `${credentials.apiUrl}/hopsworks-api/api/project/${project.id}/projectMembers`,
          {
            headers: {
              'Authorization': `ApiKey ${credentials.apiKey}`
            },
            // @ts-ignore
            agent: httpsAgent
          }
        );

        if (!membersResponse.ok) {
          console.error(`Failed to fetch members for project ${project.name}`);
          continue;
        }

        const projectMembers = await membersResponse.json();
        
        // Match Hopsworks members with our team members
        for (const member of teamMembers) {
          if (!member.hopsworks_username) continue;
          
          // Find this member in the project members list
          const hopsworksMember = projectMembers.find((pm: any) => 
            pm.user?.username === member.hopsworks_username ||
            pm.username === member.hopsworks_username
          );

          if (hopsworksMember) {
            // Member has access to this project - upsert their role
            const role = hopsworksMember.projectRole || hopsworksMember.teamRole || 'Data scientist';
            
            const { error: upsertError } = await supabaseAdmin
              .rpc('upsert_project_member_role', {
                p_member_id: member.id,
                p_owner_id: userId,
                p_project_id: project.id,
                p_project_name: project.name,
                p_role: role,
                p_added_by: userId
              });

            if (!upsertError) {
              // Mark as synced
              await supabaseAdmin
                .from('project_member_roles')
                .update({ 
                  synced_to_hopsworks: true,
                  last_sync_at: new Date().toISOString(),
                  sync_error: null
                })
                .eq('member_id', member.id)
                .eq('project_id', project.id);
              
              syncedCount++;
            } else {
              errors.push(`Failed to sync ${member.email} for ${project.name}: ${upsertError.message}`);
            }
          } else {
            // Member doesn't have access to this project - remove if exists in our DB
            await supabaseAdmin
              .from('project_member_roles')
              .delete()
              .eq('member_id', member.id)
              .eq('project_id', project.id);
          }
        }
      } catch (projectError: any) {
        errors.push(`Failed to sync project ${project.name}: ${projectError.message}`);
      }
    }

    // Also clean up any roles for projects that no longer exist
    const projectIds = projects.map((p: any) => p.id);
    if (projectIds.length > 0) {
      await supabaseAdmin
        .from('project_member_roles')
        .delete()
        .eq('account_owner_id', userId)
        .not('project_id', 'in', `(${projectIds.join(',')})`);
    }

    return res.status(200).json({ 
      message: `Synced ${syncedCount} role assignments`,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error('Failed to sync member roles:', error);
    return res.status(500).json({ error: 'Failed to sync roles', details: error.message });
  }
}