import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';
import { OpenCostDirect } from '../../../../lib/opencost-direct';
import { currentClusterEnvironment } from '../../../../lib/environment';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the active cluster in the current environment.
    // Note: .single() will throw if there's more than one active cluster per env;
    // this debug endpoint assumes one. If you run multiple, pass ?clusterId=<id> explicitly.
    const { data: cluster } = await supabaseAdmin
      .from('hopsworks_clusters')
      .select('*')
      .eq('status', 'active')
      .eq('environment', currentClusterEnvironment())
      .single();

    if (!cluster) {
      return res.status(400).json({ error: 'No active cluster found' });
    }

    // Initialize OpenCost client
    const opencost = new OpenCostDirect(cluster.kubeconfig);

    try {
      // Get 24 hour window to see more projects with activity
      const allocations = await opencost.getOpenCostAllocations('24h');
      
      // Convert to readable format
      const namespaces = [];
      for (const [namespace, allocation] of Array.from(allocations.entries())) {
        namespaces.push({
          namespace,
          cpuHours: allocation.cpuCoreHours || 0,
          gpuHours: allocation.gpuHours || 0,
          ramGBHours: (allocation.ramByteHours || 0) / (1024 * 1024 * 1024),
          totalCost: allocation.totalCost,
          cpuEfficiency: allocation.cpuEfficiency,
          ramEfficiency: allocation.ramEfficiency
        });
      }

      return res.status(200).json({
        timestamp: new Date().toISOString(),
        window: 'Last 24 hours',
        totalNamespaces: namespaces.length,
        totalCost: namespaces.reduce((sum, ns) => sum + ns.totalCost, 0),
        namespaces: namespaces.sort((a, b) => b.totalCost - a.totalCost)
      });
    } finally {
      await opencost.cleanup();
    }
  } catch (error) {
    console.error('Error checking OpenCost:', error);
    return res.status(500).json({ 
      error: 'Failed to check OpenCost',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export default function checkOpenCostHandler(req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}