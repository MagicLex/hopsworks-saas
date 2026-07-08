import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Platform health for the admin panel: metering freshness per cluster
// (watermark vs wall clock), unresolved health-check failures, collection
// recency. Read-only; the "collect now" control uses /api/admin/usage/collect.

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  try {
    const [{ data: clusters }, { data: watermarks }, { data: failures }, { data: recentUsage }] =
      await Promise.all([
        supabase.from('hopsworks_clusters').select('id, name, status, current_users, max_users'),
        supabase.from('metering_watermark').select('cluster_id, last_processed_hour, updated_at'),
        supabase
          .from('health_check_failures')
          .select('check_type, email, error_message, created_at')
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('usage_daily')
          .select('hopsworks_cluster_id, updated_at')
          .order('updated_at', { ascending: false })
          .limit(200),
      ]);

    const now = Date.now();
    const watermarkByCluster = new Map((watermarks ?? []).map(w => [w.cluster_id, w]));
    const lastUsageByCluster = new Map<string, string>();
    for (const row of recentUsage ?? []) {
      if (row.hopsworks_cluster_id && !lastUsageByCluster.has(row.hopsworks_cluster_id)) {
        lastUsageByCluster.set(row.hopsworks_cluster_id, row.updated_at);
      }
    }

    const clusterHealth = (clusters ?? []).map(c => {
      const wm = watermarkByCluster.get(c.id);
      const hoursBehind = wm
        ? Math.floor((now - new Date(wm.last_processed_hour).getTime()) / 3600_000)
        : null;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        users: c.current_users,
        maxUsers: c.max_users,
        lastMeteredHour: wm?.last_processed_hour ?? null,
        // 1 is nominal (the in-progress hour is not metered yet)
        meteringHoursBehind: hoursBehind,
        lastCollectionAt: lastUsageByCluster.get(c.id) ?? null,
      };
    });

    const failuresByType: Record<string, number> = {};
    for (const f of failures ?? []) {
      failuresByType[f.check_type] = (failuresByType[f.check_type] ?? 0) + 1;
    }

    return res.status(200).json({
      clusters: clusterHealth,
      unresolvedFailures: {
        total: (failures ?? []).length,
        byType: failuresByType,
        latest: (failures ?? []).slice(0, 10),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin health error:', error);
    return res.status(500).json({ error: 'Failed to compute health' });
  }
}

export default async function (req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}
