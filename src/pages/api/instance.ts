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

    // Get user's billing mode
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('billing_mode')
      .eq('id', userId)
      .single();

    const billingMode = userData?.billing_mode || 'free';
    const planName = billingMode === 'postpaid' ? 'Pay-as-you-go' :
                     billingMode === 'free' ? 'Free' : 'Prepaid';

    // Get user's assigned Hopsworks cluster
    const { data: clusterAssignment, error: assignmentError } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select(`
        assigned_at,
        hopsworks_clusters!inner (
          name,
          api_url,
          status
        )
      `)
      .eq('user_id', userId)
      .single();
    
    // If user has no cluster assignment yet
    if (!clusterAssignment || assignmentError) {
      return res.status(200).json({
        name: 'Hopsworks Instance',
        status: 'Not Assigned',
        endpoint: '',
        plan: planName,
        created: null
      });
    }

    // Access the cluster data - Supabase returns it as an array even for single joins
    const hopsworksCluster = Array.isArray(clusterAssignment.hopsworks_clusters) 
      ? clusterAssignment.hopsworks_clusters[0] 
      : clusterAssignment.hopsworks_clusters;

    // Return the shared cluster information
    return res.status(200).json({
      name: hopsworksCluster?.name || 'Hopsworks Instance',
      status: hopsworksCluster?.status || 'Active',
      endpoint: hopsworksCluster?.api_url || '',
      plan: planName,
      created: clusterAssignment.assigned_at || new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching instance:', error);
    return res.status(500).json({ error: 'Failed to fetch instance data' });
  }
}