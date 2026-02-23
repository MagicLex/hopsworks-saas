import { SupabaseClient } from '@supabase/supabase-js';
import { createHopsworksOAuthUser, getHopsworksUserByEmail, getHopsworksUserById, updateUserProjectLimit } from './hopsworks-api';
import { sendClusterAssigned } from './marketing-webhooks';

// ============================================================================
// Pure logic functions - testable without DB/API dependencies
// ============================================================================

export interface ClusterCapacity {
  id: string;
  name: string;
  current_users: number;
  max_users: number;
}

/**
 * Select the best available cluster based on capacity (least loaded first)
 * Returns null if no cluster has capacity
 */
export function selectClusterByCapacity(clusters: ClusterCapacity[]): ClusterCapacity | null {
  if (!clusters || clusters.length === 0) return null;

  // Sort by current_users ascending (least loaded first)
  const sorted = [...clusters].sort((a, b) => a.current_users - b.current_users);

  // Find first with available capacity
  return sorted.find(c => c.current_users < c.max_users) || null;
}

/**
 * Calculate maxNumProjects based on user type and payment status
 * - Team members: always 0 (they use owner's projects)
 * - Account owners with payment (subscription or prepaid): 5
 * - Free tier users: 1
 * - Account owners without payment: 0
 */
export function calculateMaxNumProjects(
  isTeamMember: boolean,
  hasSubscription: boolean,
  isPrepaid: boolean,
  isFree: boolean = false
): number {
  if (isTeamMember) return 0;
  if (hasSubscription || isPrepaid) return 5;
  if (isFree) return 1;
  return 0;
}

/**
 * Determine if cluster assignment is allowed
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export function canAssignCluster(
  isManualAssignment: boolean,
  isPrepaid: boolean,
  isFree: boolean = false
): { allowed: true } | { allowed: false; reason: string } {
  // Manual assignment always allowed (admin action)
  if (isManualAssignment) return { allowed: true };

  // Prepaid and free users can auto-assign
  if (isPrepaid || isFree) return { allowed: true };

  // Postpaid users need manual assignment after payment verification
  return {
    allowed: false,
    reason: 'Automatic cluster assignment requires payment verification or prepaid/free status'
  };
}

// ============================================================================
// Main orchestration function
// ============================================================================

export async function assignUserToCluster(
  supabaseAdmin: SupabaseClient,
  userId: string,
  isManualAssignment: boolean = false
): Promise<{ success: boolean; clusterId?: string; error?: string }> {
  try {
    // Check if user already has cluster assignment
    const { data: currentAssignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('hopsworks_cluster_id')
      .eq('user_id', userId)
      .single();

    if (currentAssignment) {
      // User already assigned - but check if maxNumProjects needs correction
      // This handles cases like postpaid user switching to free tier
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('billing_mode, stripe_subscription_id, account_owner_id')
        .eq('id', userId)
        .single();

      if (user) {
        const isFree = user.billing_mode === 'free';
        const isTeamMember = !!user.account_owner_id;
        const isPrepaid = user.billing_mode === 'prepaid';
        const expectedMaxProjects = calculateMaxNumProjects(
          isTeamMember,
          !!user.stripe_subscription_id,
          isPrepaid,
          isFree
        );

        // Get cluster credentials and check/update maxNumProjects
        const { data: cluster } = await supabaseAdmin
          .from('hopsworks_clusters')
          .select('api_url, api_key')
          .eq('id', currentAssignment.hopsworks_cluster_id)
          .single();

        if (cluster) {
          const { data: assignment } = await supabaseAdmin
            .from('user_hopsworks_assignments')
            .select('hopsworks_user_id')
            .eq('user_id', userId)
            .single();

          if (assignment?.hopsworks_user_id) {
            try {
              const hopsworksUser = await getHopsworksUserById(
                { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                assignment.hopsworks_user_id
              );

              // Only bump UP, never reset down - the quota workaround in project-sync
              // bumps maxNumProjects above the base when users delete projects
              if (hopsworksUser && (hopsworksUser.maxNumProjects ?? 0) < expectedMaxProjects) {
                console.log(`[Cluster Assignment] Bumping maxNumProjects from ${hopsworksUser.maxNumProjects} to ${expectedMaxProjects} for user ${userId}`);
                await updateUserProjectLimit(
                  { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                  assignment.hopsworks_user_id,
                  expectedMaxProjects
                );
              }
            } catch (e) {
              console.error(`[Cluster Assignment] Failed to check/update maxNumProjects for existing user ${userId}:`, e);
            }
          }
        }
      }

      return {
        success: true,
        clusterId: currentAssignment.hopsworks_cluster_id,
        error: 'User already assigned to cluster'
      };
    }

    // Get user details including account owner
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, stripe_subscription_id, account_owner_id, email, name, hopsworks_user_id, hopsworks_username, billing_mode')
      .eq('id', userId)
      .single();

    if (!user) {
      return { 
        success: false, 
        error: 'User not found' 
      };
    }

    // If user is a team member, assign to same cluster as account owner
    if (user.account_owner_id) {
      const { data: ownerAssignment } = await supabaseAdmin
        .from('user_hopsworks_assignments')
        .select('hopsworks_cluster_id')
        .eq('user_id', user.account_owner_id)
        .single();

      if (!ownerAssignment) {
        return { 
          success: false, 
          error: 'Account owner must be assigned to a cluster first' 
        };
      }

      // Get cluster details
      const { data: cluster } = await supabaseAdmin
        .from('hopsworks_clusters')
        .select('api_url, api_key')
        .eq('id', ownerAssignment.hopsworks_cluster_id)
        .single();

      if (!cluster) {
        return { 
          success: false, 
          error: 'Cluster not found' 
        };
      }

      // Create Hopsworks user if not exists
      let hopsworksUserId = user.hopsworks_user_id;
      let hopsworksUsername = (user as any).hopsworks_username || null;
      
      if (!hopsworksUserId || !hopsworksUsername) {
        // Try to find existing Hopsworks user first
        try {
          const existingHopsworksUser = await getHopsworksUserByEmail(
            { apiUrl: cluster.api_url, apiKey: cluster.api_key },
            user.email
          );
          
          if (existingHopsworksUser) {
            hopsworksUserId = existingHopsworksUser.id;
            hopsworksUsername = existingHopsworksUser.username;
            console.log(`Found existing Hopsworks user ${hopsworksUsername} for team member ${user.email}`);
          }
        } catch (error) {
          console.log('No existing Hopsworks user found, will create new one');
        }
        
        // Create new Hopsworks user if not found
        if (!hopsworksUserId) {
          const maxRetries = 3;
          let lastError = null;
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              // Get names from Auth0 token (guaranteed by Auth0 Action)
              // For now, fallback to email parsing until we pass Auth0 claims
              const firstName = user.email.split('@')[0];
              const lastName = '.';
              
              console.log(`Attempt ${attempt}/${maxRetries}: Creating Hopsworks user for team member ${user.email}`);
              
              const hopsworksUser = await createHopsworksOAuthUser(
                { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                user.email,
                firstName,
                lastName,
                userId,
                0 // Team members stay at 0 projects
              );
              
              hopsworksUserId = hopsworksUser.id;
              hopsworksUsername = hopsworksUser.username;
              
              console.log(`Successfully created Hopsworks user ${hopsworksUsername} for team member ${user.email}`);
              break; // Success, exit retry loop
            } catch (error) {
              lastError = error;
              console.error(`Attempt ${attempt}/${maxRetries} failed to create Hopsworks user:`, error);
              
              if (attempt < maxRetries) {
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
              }
            }
          }
          
          if (!hopsworksUserId && lastError) {
            console.error('All attempts to create Hopsworks user failed:', lastError);
            await supabaseAdmin
              .from('health_check_failures')
              .insert({
                user_id: userId,
                email: user.email,
                check_type: 'hopsworks_user_creation_team',
                error_message: 'Failed to create Hopsworks user for team member after retries',
                details: { error: String(lastError), cluster_id: ownerAssignment.hopsworks_cluster_id }
              });
            return { success: false, error: 'Failed to create Hopsworks user for team member after retries' };
          }
        }
        
        // Update user with Hopsworks ID if we got one
        if (hopsworksUserId) {
          await supabaseAdmin
            .from('users')
            .update({ 
              hopsworks_user_id: hopsworksUserId,
              hopsworks_username: hopsworksUsername 
            })
            .eq('id', userId);
        }
      }

      // Check if already assigned before upserting
      const { data: existingAssignment } = await supabaseAdmin
        .from('user_hopsworks_assignments')
        .select('id')
        .eq('user_id', userId)
        .eq('hopsworks_cluster_id', ownerAssignment.hopsworks_cluster_id)
        .maybeSingle();

      // Assign team member to same cluster as owner (upsert to handle race conditions)
      const { error: assignError } = await supabaseAdmin
        .from('user_hopsworks_assignments')
        .upsert({
          user_id: userId,
          hopsworks_cluster_id: ownerAssignment.hopsworks_cluster_id,
          hopsworks_user_id: hopsworksUserId,
          hopsworks_username: hopsworksUsername,
          assigned_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,hopsworks_cluster_id'
        });

      if (assignError) {
        throw assignError;
      }

      // Only increment if this is a new assignment, not an upsert update
      if (!existingAssignment) {
        const { error: rpcError } = await supabaseAdmin.rpc('increment_cluster_users', {
          p_cluster_id: ownerAssignment.hopsworks_cluster_id
        });

        if (rpcError) {
          throw rpcError;
        }
      }

      // Get cluster name for webhook
      const { data: clusterInfo } = await supabaseAdmin
        .from('hopsworks_clusters')
        .select('name')
        .eq('id', ownerAssignment.hopsworks_cluster_id)
        .single();

      // Get account owner email
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', user.account_owner_id)
        .single();

      // Fire marketing webhook (fire-and-forget)
      if (hopsworksUsername && clusterInfo?.name) {
        sendClusterAssigned({
          userId,
          email: user.email,
          name: user.name || null,
          hopsworksUsername,
          cluster: clusterInfo.name,
          accountType: 'team_member',
          accountOwnerEmail: owner?.email || null
        }).catch(err => console.error('[Cluster Assignment] Webhook error:', err));
      }

      console.log(`Successfully assigned team member ${userId} to same cluster as account owner`);
      return {
        success: true,
        clusterId: ownerAssignment.hopsworks_cluster_id
      };
    }

    // For account owners, check payment method (skip for prepaid/free users)
    const isPrepaid = user.billing_mode === 'prepaid';
    const isFree = user.billing_mode === 'free';

    // IMPORTANT: Only allow cluster assignment for:
    // 1. Prepaid users (corporate)
    // 2. Free tier users
    // 3. Manual assignment (admin action or after payment verification)
    // DO NOT auto-assign based on stripe_customer_id alone!
    if (!isManualAssignment && !isPrepaid && !isFree) {
      return {
        success: false,
        error: 'Automatic cluster assignment requires payment verification or prepaid/free status'
      };
    }

    // Find available cluster with capacity
    const { data: clusters } = await supabaseAdmin
      .from('hopsworks_clusters')
      .select('id, name, current_users, max_users')
      .eq('status', 'active')
      .order('current_users', { ascending: true });

    const availableCluster = clusters?.find(c => c.current_users < c.max_users);

    if (!availableCluster) {
      return { 
        success: false, 
        error: 'No available clusters with capacity' 
      };
    }

    // Get cluster details for Hopsworks user creation
    const { data: clusterDetails } = await supabaseAdmin
      .from('hopsworks_clusters')
      .select('api_url, api_key')
      .eq('id', availableCluster.id)
      .single();

    if (!clusterDetails) {
      return { 
        success: false, 
        error: 'Cluster details not found' 
      };
    }

    // Create Hopsworks user if not exists
    let hopsworksUserId = user.hopsworks_user_id;
    let hopsworksUsername = (user as any).hopsworks_username || null;
    
    if (!hopsworksUserId || !hopsworksUsername) {
      // Try to find existing Hopsworks user first
      try {
        const existingHopsworksUser = await getHopsworksUserByEmail(
          { apiUrl: clusterDetails.api_url, apiKey: clusterDetails.api_key },
          user.email
        );
        
        if (existingHopsworksUser) {
          hopsworksUserId = existingHopsworksUser.id;
          hopsworksUsername = existingHopsworksUser.username;
          console.log(`Found existing Hopsworks user ${hopsworksUsername} for ${user.email}`);
          
          // Check and update maxNumProjects if needed
          const expectedMaxProjects = isFree ? 1 : (user.stripe_subscription_id || isPrepaid) ? 5 : 0;
          // Only bump UP, never reset down - quota workaround bumps above base on project deletion
          if ((existingHopsworksUser.maxNumProjects ?? 0) < expectedMaxProjects) {
            console.log(`Bumping maxNumProjects from ${existingHopsworksUser.maxNumProjects} to ${expectedMaxProjects} for ${user.email}`);
            await updateUserProjectLimit(
              { apiUrl: clusterDetails.api_url, apiKey: clusterDetails.api_key },
              existingHopsworksUser.id,
              expectedMaxProjects
            );
          }
        }
      } catch (error) {
        console.log('No existing Hopsworks user found, will create new one');
      }
      
      // Create new Hopsworks user if not found
      if (!hopsworksUserId) {
        const maxRetries = 3;
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Get names from Auth0 token (guaranteed by Auth0 Action)
            // For now, fallback to email parsing until we pass Auth0 claims
            const firstName = user.email.split('@')[0];
            const lastName = '.';
            
            // Account owners: paid/prepaid = 5, free = 1, otherwise = 0
            const maxProjects = isFree ? 1 : (user.stripe_subscription_id || isPrepaid) ? 5 : 0;

            console.log(`Attempt ${attempt}/${maxRetries}: Creating Hopsworks user for ${user.email} with ${maxProjects} max projects`);
            
            const hopsworksUser = await createHopsworksOAuthUser(
              { apiUrl: clusterDetails.api_url, apiKey: clusterDetails.api_key },
              user.email,
              firstName,
              lastName,
              userId,
              maxProjects
            );
            
            hopsworksUserId = hopsworksUser.id;
            hopsworksUsername = hopsworksUser.username;
            
            console.log(`Successfully created Hopsworks user ${hopsworksUsername} for ${user.email}`);
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt}/${maxRetries} failed to create Hopsworks user:`, error);
            
            if (attempt < maxRetries) {
              // Wait before retrying (exponential backoff)
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
          }
        }
        
        if (!hopsworksUserId && lastError) {
          console.error('All attempts to create Hopsworks user failed:', lastError);
          await supabaseAdmin
            .from('health_check_failures')
            .insert({
              user_id: userId,
              email: user.email,
              check_type: 'hopsworks_user_creation_owner',
              error_message: 'Failed to create Hopsworks user for account owner after retries',
              details: {
                error: String(lastError),
                cluster_id: availableCluster.id,
                has_payment: !!user.stripe_customer_id,
                is_prepaid: isPrepaid
              }
            });
          return { success: false, error: 'Failed to create Hopsworks user for account owner after retries' };
        }
      }
      
      // Update user with Hopsworks ID if we got one
      if (hopsworksUserId) {
        await supabaseAdmin
          .from('users')
          .update({ 
            hopsworks_user_id: hopsworksUserId,
            hopsworks_username: hopsworksUsername 
          })
          .eq('id', userId);
      }
    }

    // Check if already assigned before upserting
    const { data: priorAssignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('id')
      .eq('user_id', userId)
      .eq('hopsworks_cluster_id', availableCluster.id)
      .maybeSingle();

    // Assign user to cluster (upsert to handle race conditions)
    const { error: assignError } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .upsert({
        user_id: userId,
        hopsworks_cluster_id: availableCluster.id,
        hopsworks_user_id: hopsworksUserId,
        hopsworks_username: hopsworksUsername,
        assigned_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,hopsworks_cluster_id'
      });

    if (assignError) {
      throw assignError;
    }

    // Only increment if this is a new assignment, not an upsert update
    if (!priorAssignment) {
      const { error: rpcError } = await supabaseAdmin.rpc('increment_cluster_users', {
        p_cluster_id: availableCluster.id
      });

      if (rpcError) {
        throw rpcError;
      }
    }

    // Fire marketing webhook (fire-and-forget)
    if (hopsworksUsername) {
      sendClusterAssigned({
        userId,
        email: user.email,
        name: user.name || null,
        hopsworksUsername,
        cluster: availableCluster.name,
        accountType: 'owner',
        accountOwnerEmail: null
      }).catch(err => console.error('[Cluster Assignment] Webhook error:', err));
    }

    console.log(`Successfully assigned user ${userId} to cluster ${availableCluster.name} (${isManualAssignment ? 'manual' : 'automatic'})`);

    return {
      success: true,
      clusterId: availableCluster.id
    };
  } catch (error) {
    console.error('Error assigning user to cluster:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to assign cluster'
    };
  }
}