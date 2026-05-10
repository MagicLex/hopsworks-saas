import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { syncUserProjects } from '../../../lib/project-sync';
import { requireCronAuth } from '../../../lib/internal-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Cron job to sync all user projects from Hopsworks
 * This is CRITICAL for billing accuracy since users work directly in Hopsworks
 * 
 * Should be called periodically (e.g., every hour) to ensure we capture:
 * - New projects created in Hopsworks
 * - Projects deleted in Hopsworks
 * - Project ownership changes
 * 
 * Can be triggered by:
 * - Vercel Cron: Add to vercel.json with schedule
 * - External service: Uptime Robot, cron-job.org, etc.
 * - GitHub Actions: Scheduled workflow
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireCronAuth(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  console.log('🔄 [Cron] Starting project sync for all users...');

  try {
    // Get all active users with Hopsworks usernames (excluding team members)
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        hopsworks_username,
        account_owner_id,
        created_at,
        user_hopsworks_assignments (
          hopsworks_cluster_id
        )
      `)
      .not('hopsworks_username', 'is', null)
      .is('account_owner_id', null); // Only account owners, not team members

    if (usersError || !users) {
      console.error('❌ [Cron] Failed to fetch users:', usersError);
      return res.status(500).json({ 
        error: 'Failed to fetch users',
        details: usersError 
      });
    }

    console.log(`📊 [Cron] Found ${users.length} users to sync`);

    const stats = {
      totalUsers: users.length,
      usersWithProjects: 0,
      totalProjectsFound: 0,
      totalProjectsSynced: 0,
      errors: [] as Array<{ user: string; error: string }>,
      syncDuration: 0
    };

    // Process users in batches to avoid overwhelming the API
    const BATCH_SIZE = 5;
    const batches = [];
    
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      batches.push(users.slice(i, i + BATCH_SIZE));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`🔄 [Cron] Processing batch ${batchIndex + 1}/${batches.length}`);
      
      const batchPromises = batch.map(async (user) => {
        // Skip users without cluster assignment
        if (!user.user_hopsworks_assignments?.length) {
          console.log(`⏩ [Cron] Skipping ${user.email} - no cluster assignment`);
          return null;
        }

        try {
          const result = await syncUserProjects(user.id);
          
          if (result.success && result.projectsFound > 0) {
            stats.usersWithProjects++;
            stats.totalProjectsFound += result.projectsFound;
            stats.totalProjectsSynced += result.projectsSynced;
            console.log(`✅ [Cron] ${user.email}: ${result.projectsSynced}/${result.projectsFound} projects`);
          } else if (result.error) {
            stats.errors.push({ user: user.email, error: result.error });
            console.error(`❌ [Cron] ${user.email}: ${result.error}`);
          }
          
          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          stats.errors.push({ user: user.email, error: errorMsg });
          console.error(`❌ [Cron] Error syncing ${user.email}:`, error);
          return null;
        }
      });

      await Promise.all(batchPromises);
    }

    // Mark orphaned projects as inactive (don't delete - keep for audit)
    try {
      if (users.length > 0) {
        const { data: orphanedProjects } = await supabaseAdmin
          .from('user_projects')
          .select('id, user_id, project_name')
          .eq('status', 'active')
          .not('user_id', 'in', `(${users.map(u => u.id).join(',')})`);

        if (orphanedProjects && orphanedProjects.length > 0) {
          console.log(`🧹 [Cron] Found ${orphanedProjects.length} orphaned projects - marking as inactive`);
          
          await supabaseAdmin
            .from('user_projects')
            .update({ 
              status: 'inactive',
              updated_at: new Date().toISOString()
            })
            .in('id', orphanedProjects.map(p => p.id));

          console.log(`✅ [Cron] Marked ${orphanedProjects.length} orphaned projects as inactive`);
        }
      }
    } catch (error) {
      console.error('❌ [Cron] Error handling orphaned projects:', error);
    }

    // Get final project count
    const { count: totalProjects } = await supabaseAdmin
      .from('user_projects')
      .select('*', { count: 'exact', head: true });

    stats.syncDuration = Date.now() - startTime;

    // Log final summary
    console.log('=' .repeat(50));
    console.log('📊 [Cron] SYNC SUMMARY:');
    console.log('=' .repeat(50));
    console.log(`Total users processed: ${stats.totalUsers}`);
    console.log(`Users with projects: ${stats.usersWithProjects}`);
    console.log(`Projects found: ${stats.totalProjectsFound}`);
    console.log(`Projects synced: ${stats.totalProjectsSynced}`);
    console.log(`Total projects in DB: ${totalProjects}`);
    console.log(`Errors: ${stats.errors.length}`);
    console.log(`Duration: ${(stats.syncDuration / 1000).toFixed(2)}s`);
    console.log('=' .repeat(50));

    // Store sync metadata for monitoring (optional - table might not exist)
    try {
      await supabaseAdmin
        .from('system_logs')
        .insert({
          type: 'project_sync_cron',
          metadata: {
            ...stats,
            timestamp: new Date().toISOString()
          }
        })
        .select()
        .single();
    } catch (error) {
      // Ignore if system_logs doesn't exist
    }

    return res.status(200).json({
      success: true,
      message: 'Project sync completed',
      stats,
      totalProjects
    });

  } catch (error) {
    console.error('❌ [Cron] Fatal error:', error);
    return res.status(500).json({
      error: 'Project sync failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}