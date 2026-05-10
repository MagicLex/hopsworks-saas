import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { assignUserToCluster } from '@/lib/cluster-assignment';
import { getPostHogClient } from '@/lib/posthog-server';
import { handleApiError } from '@/lib/error-handler';
import { sendUserRegistered, sendUserActivated } from '@/lib/marketing-webhooks';
import { hashInviteToken } from '@/lib/invite-token';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireActiveSession(req, res);
  if (!session) return;

  try {
    const { token, termsAccepted, marketingConsent } = req.body;
    const userId = session.user.sub;
    const userEmail = session.user.email;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid invite token' });
    }

    // Terms must be accepted to join
    if (!termsAccepted) {
      return res.status(400).json({ error: 'You must accept the Terms of Service to join' });
    }

    // Atomically claim the invite - UPDATE with WHERE accepted_at IS NULL
    // This prevents race conditions where two requests could both see the invite as valid.
    // Lookup by SHA256 hash; plaintext is never queried.
    const tokenHash = hashInviteToken(token);
    const { data: invite, error: claimError } = await supabase
      .from('team_invites')
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: userId
      })
      .eq('token_hash', tokenHash)
      .is('accepted_at', null)
      .select('*')
      .single();

    if (claimError || !invite) {
      return res.status(404).json({ error: 'Invite not found or already used' });
    }

    // Check if invite is expired (claimed but expired - rollback not needed, just reject)
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired' });
    }

    // Verify email matches
    if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
      // Unclaim the invite since email doesn't match
      await supabase
        .from('team_invites')
        .update({ accepted_at: null, accepted_by_user_id: null })
        .eq('id', invite.id);
      return res.status(403).json({ error: 'This invite is for a different email address' });
    }

    // Check if user is already part of a team
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, account_owner_id')
      .eq('id', userId)
      .single();

    if (existingUser?.account_owner_id) {
      // Unclaim the invite since user is already in a team
      await supabase
        .from('team_invites')
        .update({ accepted_at: null, accepted_by_user_id: null })
        .eq('id', invite.id);
      return res.status(400).json({ error: 'You are already part of a team' });
    }

    // Upsert user - either create new or update existing
    const { error: upsertError } = await supabase
      .from('users')
      .upsert({
        id: userId,
        email: userEmail,
        name: session.user.name || null,
        account_owner_id: invite.account_owner_id,
        status: 'active',
        updated_at: new Date().toISOString(),
        // Legal consent
        terms_accepted_at: termsAccepted ? new Date().toISOString() : null,
        marketing_consent: marketingConsent || false,
        // Only set these on insert, not update
        ...(!existingUser && {
          login_count: 1,
          last_login_at: new Date().toISOString(),
          metadata: {}
        })
      }, {
        onConflict: 'id'
      });

    if (upsertError) {
      console.error('Failed to upsert user:', upsertError);
      return res.status(500).json({ error: 'Failed to join team' });
    }

    // Fire marketing webhooks for team member join
    try {
      // Fetch owner's email and billing_mode for webhook context
      const { data: ownerData } = await supabase
        .from('users')
        .select('email, billing_mode')
        .eq('id', invite.account_owner_id)
        .single();

      const accountOwnerEmail = ownerData?.email || null;
      const ownerBillingMode = ownerData?.billing_mode || 'free';

      await sendUserRegistered({
        userId,
        email: userEmail,
        name: session.user.name || null,
        source: 'team_invite',
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null,
        accountType: 'team_member',
        accountOwnerEmail
      });

      await sendUserActivated({
        userId,
        email: userEmail,
        plan: ownerBillingMode,
        marketingConsent: marketingConsent || false,
        accountType: 'team_member',
        accountOwnerEmail
      });
    } catch (webhookError) {
      console.error('Failed to send team join webhooks:', webhookError);
      // Don't fail the join operation for webhook errors
    }

    // Assign team member to cluster (same as account owner)
    const clusterAssignment = await assignUserToCluster(supabase, userId);
    
    if (!clusterAssignment.success) {
      console.log('Failed to assign team member to cluster:', clusterAssignment.error);
      // Don't fail the join operation, they can be assigned later
    }

    // If auto_assign_projects is true and we have a cluster, add to owner's projects
    let projectsAssigned: string[] = [];
    let projectErrors: string[] = [];
    if (invite.auto_assign_projects && clusterAssignment.success) {
      try {
        // Get owner's cluster and Hopsworks username
        const { data: owner } = await supabase
          .from('users')
          .select(`
            hopsworks_username,
            user_hopsworks_assignments!inner (
              hopsworks_cluster_id,
              hopsworks_clusters!inner (
                api_url,
                api_key,
                kubeconfig,
                mysql_password
              )
            )
          `)
          .eq('id', invite.account_owner_id)
          .single();

        // Get team member's Hopsworks user ID (might need to wait for it to be created)
        const { data: teamMember } = await supabase
          .from('users')
          .select('hopsworks_user_id, hopsworks_username')
          .eq('id', userId)
          .single();

        if (owner?.hopsworks_username && teamMember?.hopsworks_user_id) {
          const { getUserProjects, addUserToProject } = await import('@/lib/hopsworks-team');
          const assignment = owner.user_hopsworks_assignments[0] as any;
          const credentials = {
            apiUrl: assignment.hopsworks_clusters.api_url,
            apiKey: assignment.hopsworks_clusters.api_key,
            kubeconfig: assignment.hopsworks_clusters.kubeconfig,
            mysqlPassword: assignment.hopsworks_clusters.mysql_password
          };

          // Get owner's projects
          const ownerProjects = await getUserProjects(credentials, owner.hopsworks_username);
          const projectRole = invite.project_role || 'Data scientist';

          // Add team member to each project
          for (const project of ownerProjects) {
            try {
              await addUserToProject(credentials, project.name, teamMember.hopsworks_user_id, projectRole);
              projectsAssigned.push(project.name);
              console.log(`Added ${userEmail} to project ${project.name} as ${projectRole}`);
              
              // Save successful assignment to database
              await supabase.rpc('upsert_project_member_role', {
                p_member_id: userId,
                p_owner_id: invite.account_owner_id,
                p_project_id: project.id || 0,
                p_project_name: project.name,
                p_role: projectRole,
                p_added_by: invite.account_owner_id
              });
              
              // Mark as synced
              await supabase
                .from('project_member_roles')
                .update({ 
                  synced_to_hopsworks: true,
                  last_sync_at: new Date().toISOString(),
                  sync_error: null
                })
                .eq('member_id', userId)
                .eq('project_name', project.name);
                
            } catch (error: any) {
              console.error(`Failed to add ${userEmail} to project ${project.name}:`, error);
              projectErrors.push(`${project.name}: ${error.message || 'sync failed'}`);
            }
          }
        }
      } catch (error) {
        console.error('Failed to auto-assign projects:', error);
        // Don't fail the join operation
      }
    }

    // Track team invite acceptance in PostHog
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'team_invite_accepted',
      properties: {
        accountOwnerId: invite.account_owner_id,
        userEmail,
        clusterAssigned: clusterAssignment.success,
        projectsAssignedCount: projectsAssigned.length,
        projectsFailedCount: projectErrors.length,
        autoAssignedProjects: invite.auto_assign_projects,
        projectRole: invite.project_role,
      }
    });

    // Identify the user in PostHog with their team relationship
    posthog.identify({
      distinctId: userId,
      properties: {
        email: userEmail,
        isTeamMember: true,
        accountOwnerId: invite.account_owner_id,
      }
    });
    await posthog.shutdown();

    // Prepare response with warnings if needed
    const response: any = {
      message: 'Successfully joined team',
      account_owner_id: invite.account_owner_id,
      cluster_assigned: clusterAssignment.success,
      projects_assigned: projectsAssigned
    };

    // Add warnings if there were project assignment errors
    if (projectErrors.length > 0) {
      response.warning = 'Some projects could not be assigned. The cluster may need to be upgraded to support OAuth group mappings.';
      response.project_errors = projectErrors;
    }

    return res.status(200).json(response);

  } catch (error) {
    return handleApiError(error, res, 'POST /api/team/join');
  }
}