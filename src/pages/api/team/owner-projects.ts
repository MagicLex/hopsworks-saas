import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { getUserProjects } from '../../../lib/hopsworks-team';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if user is an account owner
    const { data: currentUser } = await supabaseAdmin
      .from('users')
      .select('account_owner_id, hopsworks_username, email')
      .eq('id', userId)
      .single();

    if (!currentUser || currentUser.account_owner_id !== null) {
      return res.status(403).json({ error: 'Only account owners can access this endpoint' });
    }

    if (!currentUser.email) {
      return res.status(400).json({ error: 'No email found for user' });
    }

    // Get owner's cluster credentials
    const { data: owner } = await supabaseAdmin
      .from('users')
      .select(`
        user_hopsworks_assignments!inner (
          hopsworks_cluster_id,
          hopsworks_clusters!inner (
            api_url,
            api_key
          )
        )
      `)
      .eq('id', userId)
      .single();

    if (!owner?.user_hopsworks_assignments?.[0]) {
      return res.status(404).json({ error: 'No cluster assignment found' });
    }

    const assignment = owner.user_hopsworks_assignments[0] as any;
    const credentials = {
      apiUrl: assignment.hopsworks_clusters.api_url,
      apiKey: assignment.hopsworks_clusters.api_key
    };

    // Get ALL projects from Hopsworks then filter by owner email
    // Note: Hopsworks stores project owner as email, not hopsworks_username
    const hopsworksProjects = await getUserProjects(credentials, currentUser.email);

    const projects = hopsworksProjects.map(p => ({
      id: p.id,
      name: p.name,
      namespace: p.namespace
    }));

    console.log(`Found ${projects.length} projects owned by ${currentUser.email}`);
    return res.status(200).json({ projects });

  } catch (error) {
    console.error('Failed to fetch owner projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
}