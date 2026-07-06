import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';
import { handleApiError } from '../../../lib/error-handler';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Never ship api_key / kubeconfig / mysql_password to the browser, admin or not.
const CLUSTER_PUBLIC_COLUMNS =
  'id, name, api_url, max_users, current_users, status, environment, region, metadata, created_at, updated_at';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { data: clusters, error } = await supabase
        .from('hopsworks_clusters')
        .select(`
          ${CLUSTER_PUBLIC_COLUMNS},
          user_hopsworks_assignments (count)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching clusters:', error);
        return res.status(500).json({ error: 'Failed to fetch clusters' });
      }

      // Map the count from user_hopsworks_assignments to current_users for display
      const clustersWithCounts = clusters?.map(cluster => ({
        ...cluster,
        current_users: cluster.user_hopsworks_assignments?.[0]?.count || 0
      })) || [];

      return res.status(200).json({ clusters: clustersWithCounts });
    } catch (error) {
      return handleApiError(error, res, 'GET /api/admin/clusters');
    }
  } else if (req.method === 'POST') {
    try {
      const { name, api_url, api_key, max_users } = req.body;

      const { data: cluster, error } = await supabase
        .from('hopsworks_clusters')
        .insert({
          name,
          api_url,
          api_key,
          max_users: max_users || 100,
          current_users: 0,
          status: 'active'
        })
        .select(CLUSTER_PUBLIC_COLUMNS)
        .single();

      if (error) {
        console.error('Error creating cluster:', error);
        return res.status(500).json({ error: 'Failed to create cluster' });
      }

      return res.status(201).json({ cluster });
    } catch (error) {
      return handleApiError(error, res, 'POST /api/admin/clusters');
    }
  } else if (req.method === 'PUT') {
    try {
      const { id, ...updates } = req.body;

      const { data: cluster, error } = await supabase
        .from('hopsworks_clusters')
        .update(updates)
        .eq('id', id)
        .select(CLUSTER_PUBLIC_COLUMNS)
        .single();

      if (error) {
        console.error('Error updating cluster:', error);
        return res.status(500).json({ error: 'Failed to update cluster' });
      }

      return res.status(200).json({ cluster });
    } catch (error) {
      return handleApiError(error, res, 'PUT /api/admin/clusters');
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

const adminClustersHandler = function (req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}

export default adminClustersHandler;