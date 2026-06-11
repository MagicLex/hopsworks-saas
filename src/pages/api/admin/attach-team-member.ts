import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';
import { assignUserToCluster } from '../../../lib/cluster-assignment';
import { addUserToProject } from '../../../lib/hopsworks-team';
import { updateUserProjectLimit } from '../../../lib/hopsworks-api';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Admin: attach an EXISTING standalone account to a team, bypassing the
 * invite/consent flow. Equivalent of the member accepting an invite:
 * account_owner_id set, own billing cleared, maxNumProjects dropped to 0,
 * optionally added to all the owner's projects.
 *
 * Refuses members with a live Stripe subscription: cancel it first (the
 * consent belongs to the member, not the admin).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { memberEmail, ownerEmail, addToAllProjects = false, role = 'Data scientist' } = req.body;

  if (!memberEmail || !ownerEmail) {
    return res.status(400).json({ error: 'memberEmail and ownerEmail are required' });
  }
  if (!['Data scientist', 'Data owner', 'Observer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const [{ data: member }, { data: owner }] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, email, account_owner_id, stripe_subscription_id, hopsworks_user_id, deleted_at, status')
        .eq('email', memberEmail.toLowerCase())
        .single(),
      supabaseAdmin
        .from('users')
        .select('id, email, account_owner_id, hopsworks_username')
        .eq('email', ownerEmail.toLowerCase())
        .single()
    ]);

    if (!member) return res.status(404).json({ error: `Member ${memberEmail} not found` });
    if (!owner) return res.status(404).json({ error: `Owner ${ownerEmail} not found` });
    if (member.id === owner.id) return res.status(400).json({ error: 'Member and owner are the same account' });
    if (member.deleted_at || member.status === 'suspended') {
      return res.status(400).json({ error: 'Member account is suspended or deleted' });
    }
    if (member.account_owner_id) {
      return res.status(400).json({ error: 'Member is already part of a team' });
    }
    if (owner.account_owner_id) {
      return res.status(400).json({ error: `${ownerEmail} is a team member, not an account owner` });
    }
    if (member.stripe_subscription_id) {
      return res.status(409).json({
        error: 'Member has a live Stripe subscription. Cancel it first (or have them accept an invite, which asks their consent).'
      });
    }

    // Cluster guard: owner must be assigned; member (if assigned) must be on
    // the same cluster — Hopsworks user IDs are cluster-local.
    const [{ data: ownerAssignment }, { data: memberAssignment }] = await Promise.all([
      supabaseAdmin
        .from('user_hopsworks_assignments')
        .select('hopsworks_cluster_id, hopsworks_clusters!inner(api_url, api_key)')
        .eq('user_id', owner.id)
        .single(),
      supabaseAdmin
        .from('user_hopsworks_assignments')
        .select('hopsworks_cluster_id, hopsworks_user_id')
        .eq('user_id', member.id)
        .single()
    ]);

    if (!ownerAssignment) {
      return res.status(400).json({ error: 'Owner has no cluster assignment' });
    }
    if (memberAssignment && memberAssignment.hopsworks_cluster_id !== ownerAssignment.hopsworks_cluster_id) {
      return res.status(409).json({ error: 'Member is on a different cluster than the owner' });
    }

    // Attach: team link + shed own billing (no subscription by guard above)
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        account_owner_id: owner.id,
        billing_mode: null,
        stripe_subscription_id: null,
        stripe_subscription_status: null,
        downgrade_deadline: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', member.id);

    if (updateError) {
      console.error('[Admin attach] Failed to update member:', updateError);
      return res.status(500).json({ error: 'Failed to attach member to team' });
    }

    const cluster = (ownerAssignment as any).hopsworks_clusters;
    const credentials = { apiUrl: cluster.api_url, apiKey: cluster.api_key };

    // No assignment yet → assign to the owner's cluster (creates the Hopsworks user)
    if (!memberAssignment) {
      const assignResult = await assignUserToCluster(supabaseAdmin as any, member.id);
      if (!assignResult.success) {
        console.error(`[Admin attach] Cluster assignment failed for ${memberEmail}: ${assignResult.error}`);
      }
    }

    // Team-member quota baseline. The ratchet never lowers, so set explicitly.
    const { data: refreshedAssignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('hopsworks_user_id')
      .eq('user_id', member.id)
      .single();
    const memberHopsworksId = refreshedAssignment?.hopsworks_user_id || member.hopsworks_user_id;
    if (memberHopsworksId) {
      try {
        await updateUserProjectLimit(credentials, memberHopsworksId, 0);
      } catch (e) {
        console.error(`[Admin attach] Failed to set maxNumProjects=0 for ${memberEmail}:`, e);
      }
    }

    // Optionally add to all the owner's tracked projects
    const projectsAssigned: string[] = [];
    const projectErrors: string[] = [];
    if (addToAllProjects && memberHopsworksId) {
      const { data: ownerProjects } = await supabaseAdmin
        .from('user_projects')
        .select('project_id, project_name')
        .eq('user_id', owner.id)
        .eq('status', 'active');

      for (const project of ownerProjects ?? []) {
        try {
          await addUserToProject(credentials, project.project_name, memberHopsworksId, role);
          await supabaseAdmin.rpc('upsert_project_member_role', {
            p_member_id: member.id,
            p_owner_id: owner.id,
            p_project_id: project.project_id,
            p_project_name: project.project_name,
            p_role: role,
            p_added_by: owner.id
          });
          await supabaseAdmin
            .from('project_member_roles')
            .update({ synced_to_hopsworks: true, last_sync_at: new Date().toISOString(), sync_error: null })
            .eq('member_id', member.id)
            .eq('project_id', project.project_id);
          projectsAssigned.push(project.project_name);
        } catch (e: any) {
          projectErrors.push(`${project.project_name}: ${e.message || 'failed'}`);
        }
      }
    }

    console.log(`[Admin attach] ${memberEmail} attached to team of ${ownerEmail} (projects: ${projectsAssigned.join(', ') || 'none'})`);
    return res.status(200).json({
      success: true,
      member: memberEmail,
      owner: ownerEmail,
      projectsAssigned,
      projectErrors: projectErrors.length > 0 ? projectErrors : undefined
    });
  } catch (error) {
    console.error('[Admin attach] Error:', error);
    return res.status(500).json({ error: 'Failed to attach member to team' });
  }
}

export default function attachTeamMemberHandler(req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}
