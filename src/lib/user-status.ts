import { createClient } from '@supabase/supabase-js';
import { updateHopsworksUserStatus } from './hopsworks-api';
import { sendUserSuspended, sendUserDeleted, sendUserReactivated } from './marketing-webhooks';

/**
 * Centralized user status management
 * Ensures Supabase and Hopsworks stay in sync
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Hopsworks user status codes
 * 2 = ACTIVATED_ACCOUNT, 3 = DEACTIVATED_ACCOUNT
 */
export const HOPSWORKS_STATUS = {
  ACTIVATED_ACCOUNT: 2,
  DEACTIVATED_ACCOUNT: 3
} as const;

// ============================================================================
// Types
// ============================================================================

export interface StatusChangeResult {
  success: boolean;
  supabaseUpdated: boolean;
  hopsworksUpdated: boolean;
  error?: string;
}

/**
 * Get Hopsworks credentials for a user
 */
async function getHopsworksCredentials(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ apiUrl: string; apiKey: string; hopsworksUserId: number } | null> {
  const { data: assignment } = await supabase
    .from('user_hopsworks_assignments')
    .select(`
      hopsworks_user_id,
      hopsworks_clusters (
        api_url,
        api_key
      )
    `)
    .eq('user_id', userId)
    .single();

  if (!assignment?.hopsworks_clusters || !assignment.hopsworks_user_id) {
    return null;
  }

  const cluster = assignment.hopsworks_clusters as any;
  return {
    apiUrl: cluster.api_url,
    apiKey: cluster.api_key,
    hopsworksUserId: assignment.hopsworks_user_id as number
  };
}

/**
 * Suspend a user account
 * - Sets status='suspended' in Supabase
 * - Deactivates Hopsworks account (status 3 = DEACTIVATED_ACCOUNT)
 * - If user is an account owner, also suspends all team members
 */
export async function suspendUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  reason?: string
): Promise<StatusChangeResult> {
  const result: StatusChangeResult = {
    success: false,
    supabaseUpdated: false,
    hopsworksUpdated: false
  };

  try {
    // Get full user info for webhook payload
    const { data: user } = await supabase
      .from('users')
      .select(`
        email,
        name,
        account_owner_id,
        billing_mode,
        hopsworks_username
      `)
      .eq('id', userId)
      .single() as { data: { email: string; name: string | null; account_owner_id: string | null; billing_mode: string | null; hopsworks_username: string | null } | null };

    const userEmail: string = user?.email || userId;

    // Get cluster info if assigned
    const { data: assignment } = await supabase
      .from('user_hopsworks_assignments')
      .select(`
        hopsworks_username,
        hopsworks_clusters ( name )
      `)
      .eq('user_id', userId)
      .single() as { data: { hopsworks_username: string | null; hopsworks_clusters: { name: string } | null } | null };

    const clusterName: string | null = assignment?.hopsworks_clusters?.name || null;
    const hwUsername: string | null = assignment?.hopsworks_username || user?.hopsworks_username || null;

    // Get account owner email if this is a team member
    let accountOwnerEmail: string | null = null;
    if (user?.account_owner_id) {
      const { data: owner } = await supabase
        .from('users')
        .select('email')
        .eq('id', user.account_owner_id)
        .single() as { data: { email: string } | null };
      accountOwnerEmail = owner?.email || null;
    }

    // Update Supabase status; persist the reason so anti-abuse checks can
    // distinguish abuse suspensions from billing suspensions
    const { data: currentMeta } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', userId)
      .single() as { data: { metadata: Record<string, unknown> | null } | null };

    const { error: supabaseError } = await supabase
      .from('users')
      .update({
        status: 'suspended',
        metadata: { ...(currentMeta?.metadata ?? {}), suspension_reason: reason || 'unknown' }
      })
      .eq('id', userId);

    if (supabaseError) {
      result.error = `Failed to update Supabase: ${supabaseError.message}`;
      console.error(`[suspendUser] ${result.error}`, supabaseError);
      return result;
    }

    result.supabaseUpdated = true;
    console.log(`[suspendUser] Suspended user ${userEmail} in Supabase${reason ? ` (reason: ${reason})` : ''}`);

    // Deactivate in Hopsworks (status 3 = DEACTIVATED_ACCOUNT)
    try {
      const credentials = await getHopsworksCredentials(supabase, userId);
      if (credentials) {
        await updateHopsworksUserStatus(
          { apiUrl: credentials.apiUrl, apiKey: credentials.apiKey },
          credentials.hopsworksUserId,
          3 // DEACTIVATED_ACCOUNT
        );
        result.hopsworksUpdated = true;
        console.log(`[suspendUser] Deactivated Hopsworks user ${credentials.hopsworksUserId} for ${userEmail}`);
      } else {
        console.log(`[suspendUser] Could not deactivate Hopsworks user for ${userEmail} - no cluster assignment or Hopsworks user ID`);
      }
    } catch (error) {
      // Log but don't fail the whole operation
      console.error(`[suspendUser] Failed to deactivate Hopsworks user for ${userEmail}:`, error);
    }

    // If this user is an account owner (account_owner_id is null), suspend all team members too
    if (user?.account_owner_id === null) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id, email')
        .eq('account_owner_id', userId) as { data: { id: string; email: string }[] | null };

      if (teamMembers && teamMembers.length > 0) {
        console.log(`[suspendUser] Suspending ${teamMembers.length} team members of ${userEmail}`);
        for (const member of teamMembers) {
          // Recursive call but won't cascade further (team members have account_owner_id set)
          const memberResult = await suspendUser(supabase, member.id, `owner_suspended:${reason || 'unknown'}`);
          if (!memberResult.success) {
            console.error(`[suspendUser] Failed to suspend team member ${member.email}: ${memberResult.error}`);
          }
        }
      }
    }

    // Fire marketing webhook (fire-and-forget)
    sendUserSuspended({
      userId,
      email: userEmail,
      name: user?.name || null,
      reason: reason || 'unknown',
      accountType: user?.account_owner_id ? 'team_member' : 'owner',
      accountOwnerEmail,
      hopsworksUsername: hwUsername,
      cluster: clusterName,
      plan: user?.billing_mode || null
    }).catch(err => console.error('[suspendUser] Webhook error:', err));

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error('[suspendUser] Unexpected error:', error);
    return result;
  }
}

/**
 * Reactivate a suspended user account
 * - Sets status='active' in Supabase
 * - Reactivates Hopsworks account (status 2 = ACTIVATED_ACCOUNT)
 * - If user is an account owner, also reactivates all team members
 */
export async function reactivateUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  reason?: string
): Promise<StatusChangeResult> {
  const result: StatusChangeResult = {
    success: false,
    supabaseUpdated: false,
    hopsworksUpdated: false
  };

  try {
    // Get full user info for webhook payload
    const { data: user } = await supabase
      .from('users')
      .select(`
        email,
        name,
        account_owner_id,
        billing_mode,
        hopsworks_username
      `)
      .eq('id', userId)
      .single() as { data: { email: string; name: string | null; account_owner_id: string | null; billing_mode: string | null; hopsworks_username: string | null } | null };

    const userEmail: string = user?.email || userId;

    // Get cluster info if assigned
    const { data: assignment } = await supabase
      .from('user_hopsworks_assignments')
      .select(`
        hopsworks_username,
        hopsworks_clusters ( name )
      `)
      .eq('user_id', userId)
      .single() as { data: { hopsworks_username: string | null; hopsworks_clusters: { name: string } | null } | null };

    const clusterName: string | null = assignment?.hopsworks_clusters?.name || null;
    const hwUsername: string | null = assignment?.hopsworks_username || user?.hopsworks_username || null;

    // Get account owner email if this is a team member
    let accountOwnerEmail: string | null = null;
    if (user?.account_owner_id) {
      const { data: owner } = await supabase
        .from('users')
        .select('email')
        .eq('id', user.account_owner_id)
        .single() as { data: { email: string } | null };
      accountOwnerEmail = owner?.email || null;
    }

    // Update Supabase status, clear any lingering downgrade deadline and
    // suspension reason (a reactivated user's IP must not stay flagged)
    const { data: currentMeta } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', userId)
      .single() as { data: { metadata: Record<string, unknown> | null } | null };
    const { suspension_reason: _dropped, ...cleanedMeta } = currentMeta?.metadata ?? {};

    const { error: supabaseError } = await supabase
      .from('users')
      .update({
        status: 'active',
        downgrade_deadline: null,
        metadata: cleanedMeta
      })
      .eq('id', userId);

    if (supabaseError) {
      result.error = `Failed to update Supabase: ${supabaseError.message}`;
      console.error(`[reactivateUser] ${result.error}`, supabaseError);
      return result;
    }

    result.supabaseUpdated = true;
    console.log(`[reactivateUser] Reactivated user ${userEmail} in Supabase${reason ? ` (reason: ${reason})` : ''}`);

    // Reactivate in Hopsworks (status 2 = ACTIVATED_ACCOUNT)
    try {
      const credentials = await getHopsworksCredentials(supabase, userId);
      if (credentials) {
        await updateHopsworksUserStatus(
          { apiUrl: credentials.apiUrl, apiKey: credentials.apiKey },
          credentials.hopsworksUserId,
          2 // ACTIVATED_ACCOUNT
        );
        result.hopsworksUpdated = true;
        console.log(`[reactivateUser] Reactivated Hopsworks user ${credentials.hopsworksUserId} for ${userEmail}`);
      } else {
        console.log(`[reactivateUser] Could not reactivate Hopsworks user for ${userEmail} - no cluster assignment or Hopsworks user ID`);
      }
    } catch (error) {
      // Log but don't fail the whole operation
      console.error(`[reactivateUser] Failed to reactivate Hopsworks user for ${userEmail}:`, error);
    }

    // If this user is an account owner (account_owner_id is null), reactivate all team members too
    if (user?.account_owner_id === null) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id, email, status')
        .eq('account_owner_id', userId)
        .eq('status', 'suspended') as { data: { id: string; email: string; status: string }[] | null }; // Only reactivate suspended members

      if (teamMembers && teamMembers.length > 0) {
        console.log(`[reactivateUser] Reactivating ${teamMembers.length} team members of ${userEmail}`);
        for (const member of teamMembers) {
          const memberResult = await reactivateUser(supabase, member.id, `owner_reactivated:${reason || 'unknown'}`);
          if (!memberResult.success) {
            console.error(`[reactivateUser] Failed to reactivate team member ${member.email}: ${memberResult.error}`);
          }
        }
      }
    }

    // Fire marketing webhook (fire-and-forget)
    sendUserReactivated({
      userId,
      email: userEmail,
      name: user?.name || null,
      reason: reason || 'unknown',
      accountType: user?.account_owner_id ? 'team_member' : 'owner',
      accountOwnerEmail,
      hopsworksUsername: hwUsername,
      cluster: clusterName,
      plan: user?.billing_mode || null
    }).catch(err => console.error('[reactivateUser] Webhook error:', err));

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error('[reactivateUser] Unexpected error:', error);
    return result;
  }
}

/**
 * Deactivate a user account (soft delete)
 * - Sets status='deleted' and deleted_at in Supabase
 * - Deactivates Hopsworks account (status 3 = DEACTIVATED_ACCOUNT)
 */
export async function deactivateUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  reason?: string
): Promise<StatusChangeResult> {
  const result: StatusChangeResult = {
    success: false,
    supabaseUpdated: false,
    hopsworksUpdated: false
  };

  try {
    // Get full user info for webhook payload
    const { data: user } = await supabase
      .from('users')
      .select(`
        email,
        name,
        account_owner_id,
        billing_mode,
        hopsworks_username
      `)
      .eq('id', userId)
      .single() as { data: { email: string; name: string | null; account_owner_id: string | null; billing_mode: string | null; hopsworks_username: string | null } | null };

    const userEmail: string = user?.email || userId;

    // Get cluster info if assigned
    const { data: assignment } = await supabase
      .from('user_hopsworks_assignments')
      .select(`
        hopsworks_username,
        hopsworks_clusters ( name )
      `)
      .eq('user_id', userId)
      .single() as { data: { hopsworks_username: string | null; hopsworks_clusters: { name: string } | null } | null };

    const clusterName: string | null = assignment?.hopsworks_clusters?.name || null;
    const hwUsername: string | null = assignment?.hopsworks_username || user?.hopsworks_username || null;

    // Get account owner email if this is a team member
    let accountOwnerEmail: string | null = null;
    if (user?.account_owner_id) {
      const { data: owner } = await supabase
        .from('users')
        .select('email')
        .eq('id', user.account_owner_id)
        .single() as { data: { email: string } | null };
      accountOwnerEmail = owner?.email || null;
    }

    // Update Supabase status
    const { error: supabaseError } = await supabase
      .from('users')
      .update({
        status: 'deleted',
        deleted_at: new Date().toISOString(),
        deletion_reason: reason || 'user_requested'
      })
      .eq('id', userId);

    if (supabaseError) {
      result.error = `Failed to update Supabase: ${supabaseError.message}`;
      console.error(`[deactivateUser] ${result.error}`, supabaseError);
      return result;
    }

    result.supabaseUpdated = true;
    console.log(`[deactivateUser] Deactivated user ${userEmail} in Supabase${reason ? ` (reason: ${reason})` : ''}`);

    // Deactivate in Hopsworks (status 3 = DEACTIVATED_ACCOUNT)
    try {
      const credentials = await getHopsworksCredentials(supabase, userId);
      if (credentials) {
        await updateHopsworksUserStatus(
          { apiUrl: credentials.apiUrl, apiKey: credentials.apiKey },
          credentials.hopsworksUserId,
          3 // DEACTIVATED_ACCOUNT
        );
        result.hopsworksUpdated = true;
        console.log(`[deactivateUser] Deactivated Hopsworks user ${credentials.hopsworksUserId} for ${userEmail}`);
      } else {
        console.log(`[deactivateUser] Could not deactivate Hopsworks user for ${userEmail} - no cluster assignment or Hopsworks user ID`);
      }
    } catch (error) {
      // Log but don't fail the whole operation
      console.error(`[deactivateUser] Failed to deactivate Hopsworks user for ${userEmail}:`, error);
    }

    // Fire marketing webhook (fire-and-forget)
    sendUserDeleted({
      userId,
      email: userEmail,
      name: user?.name || null,
      reason: reason || 'user_requested',
      accountType: user?.account_owner_id ? 'team_member' : 'owner',
      accountOwnerEmail,
      hopsworksUsername: hwUsername,
      cluster: clusterName,
      plan: user?.billing_mode || null
    }).catch(err => console.error('[deactivateUser] Webhook error:', err));

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error('[deactivateUser] Unexpected error:', error);
    return result;
  }
}
