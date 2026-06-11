import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../../middleware/adminAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clusterId, kubeconfig } = req.body;

  if (!clusterId || !kubeconfig) {
    return res.status(400).json({ error: 'clusterId and kubeconfig are required' });
  }

  try {
    // First, let's check if the cluster exists
    const { data: cluster, error: fetchError } = await supabase
      .from('hopsworks_clusters')
      .select('id')
      .eq('id', clusterId)
      .single();

    if (fetchError || !cluster) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    // Update the cluster with the kubeconfig. Never echo secrets back.
    const { data, error } = await supabase
      .from('hopsworks_clusters')
      .update({ kubeconfig })
      .eq('id', clusterId)
      .select('id, name')
      .single();

    if (error) {
      console.error('Error updating kubeconfig:', error);
      return res.status(500).json({ error: 'Failed to update kubeconfig' });
    }

    return res.status(200).json({
      success: true,
      cluster: data,
      message: 'Kubeconfig updated successfully'
    });

  } catch (error) {
    console.error('Error updating kubeconfig:', error);
    return res.status(500).json({ error: 'Failed to update kubeconfig' });
  }
}

export default function updateKubeconfigHandler(req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}