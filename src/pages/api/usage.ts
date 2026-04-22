import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;
    const currentDate = new Date().toISOString().split('T')[0];

    // Get current month usage with detailed instance information
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: monthlyUsage, error: usageError } = await supabaseAdmin
      .from('usage_daily')
      .select('opencost_cpu_hours, opencost_gpu_hours, opencost_ram_gb_hours, online_storage_gb, offline_storage_gb, project_breakdown, created_at, updated_at, date')
      .eq('user_id', userId)
      .gte('date', startOfMonth.toISOString().split('T')[0])
      .lte('date', currentDate)
      .order('updated_at', { ascending: false });

    if (usageError) {
      console.error('Usage error:', usageError);
    }

    // Get the latest update time - use updated_at to show most recent collection
    const lastUpdate = monthlyUsage?.[0]?.updated_at || null;
    
    // Get project breakdown from today's data
    const todayUsage = monthlyUsage?.find(d => d.date === currentDate);
    const projectBreakdown = todayUsage?.project_breakdown || {};
    
    // Sum up the usage
    const totalUsage = monthlyUsage?.reduce((acc, day) => ({
      cpuHours: acc.cpuHours + (day.opencost_cpu_hours || 0),
      gpuHours: acc.gpuHours + (day.opencost_gpu_hours || 0),
      ramGbHours: acc.ramGbHours + (day.opencost_ram_gb_hours || 0),
      storageGB: Math.max(acc.storageGB, (day.online_storage_gb || 0) + (day.offline_storage_gb || 0)), // Use max for storage
      apiCalls: 0, // Not tracked in current schema
      featureStoreApiCalls: 0,
      modelInferenceCalls: 0
    }), { 
      cpuHours: 0, 
      gpuHours: 0,
      ramGbHours: 0, 
      storageGB: 0,
      apiCalls: 0,
      featureStoreApiCalls: 0,
      modelInferenceCalls: 0
    }) || { 
      cpuHours: 0, 
      gpuHours: 0,
      ramGbHours: 0,
      storageGB: 0,
      apiCalls: 0,
      featureStoreApiCalls: 0,
      modelInferenceCalls: 0
    };


    // Get user with their cluster assignment
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select(`
        email,
        user_hopsworks_assignments (
          hopsworks_clusters (
            id,
            api_url,
            api_key
          )
        )
      `)
      .eq('id', userId)
      .single();
    
    let modelsCount = 0;

    // Use our user_projects table — Hopsworks numActiveProjects includes deleted projects
    let projectsCount = 0;
    try {
      const { data: activeProjects } = await supabaseAdmin
        .from('user_projects')
        .select('project_id')
        .eq('user_id', userId)
        .eq('status', 'active');
      projectsCount = activeProjects?.length || 0;
    } catch (e) {
      console.error('[Usage] Failed to get project count:', e);
    }

    return res.status(200).json({
      cpuHours: totalUsage.cpuHours,
      gpuHours: totalUsage.gpuHours,
      ramGbHours: totalUsage.ramGbHours,
      storageGB: totalUsage.storageGB,
      featureGroups: projectsCount || 0,
      modelDeployments: modelsCount || 0,
      apiCalls: totalUsage.apiCalls,
      featureStoreApiCalls: totalUsage.featureStoreApiCalls,
      modelInferenceCalls: totalUsage.modelInferenceCalls,
      currentMonth: startOfMonth.toISOString().substring(0, 7), // YYYY-MM format
      lastUpdate,
      projectBreakdown
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    return res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}