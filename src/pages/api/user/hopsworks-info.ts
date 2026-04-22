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

    // Get user with their cluster assignment
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select(`
        email,
        user_hopsworks_assignments (
          hopsworks_clusters (
            id,
            name,
            api_url,
            api_key
          )
        )
      `)
      .eq('id', userId)
      .single();

    if (!userData?.user_hopsworks_assignments?.[0]?.hopsworks_clusters) {
      return res.status(200).json({
        hasCluster: false,
        message: 'No Hopsworks cluster assigned'
      });
    }

    const clusterData = userData.user_hopsworks_assignments[0].hopsworks_clusters;
    // Handle both array and single object response from Supabase
    const cluster = Array.isArray(clusterData) ? clusterData[0] : clusterData;
    
    if (!cluster) {
      return res.status(200).json({
        hasCluster: true,
        clusterName: 'Unknown',
        error: 'Cluster data not found'
      });
    }
    
    try {
      const { getHopsworksUserByEmail } = await import('../../../lib/hopsworks-api');
      
      const credentials = {
        apiUrl: cluster.api_url,
        apiKey: cluster.api_key
      };

      // Get Hopsworks user
      const hopsworksUser = await getHopsworksUserByEmail(credentials, userData.email);
      
      if (!hopsworksUser) {
        return res.status(200).json({
          hasCluster: true,
          clusterName: cluster.name,
          hasHopsworksUser: false,
          message: 'User not found in Hopsworks'
        });
      }

      // Get user's projects - check owned projects AND team member access
      let projects: any[] = [];

      // First check if user is a team member with project access
      const { data: memberProjects } = await supabaseAdmin
        .from('project_member_roles')
        .select('project_id, project_name, role')
        .eq('member_id', userId)
        .eq('synced_to_hopsworks', true);

      if (memberProjects && memberProjects.length > 0) {
        // Team member with project access
        projects = memberProjects.map(p => ({
          id: p.project_id,
          name: p.project_name,
          role: p.role,
          owner: 'team',
          created: new Date().toISOString()
        }));
        console.log(`Found ${projects.length} team projects for ${userData.email}`);
      } else {
        // Use our user_projects table (synced by project-sync on every login).
        // Hopsworks API returns deleted projects as if active — our DB is the source of truth.
        const { data: userProjects } = await supabaseAdmin
          .from('user_projects')
          .select('project_id, project_name')
          .eq('user_id', userId)
          .eq('status', 'active');

        if (userProjects && userProjects.length > 0) {
          projects = userProjects.map(p => ({
            id: p.project_id,
            name: p.project_name,
            owner: hopsworksUser.username,
            created: null
          }));
        }
      }

      return res.status(200).json({
        hasCluster: true,
        clusterName: cluster.name,
        clusterEndpoint: cluster.api_url.replace('/hopsworks-api/api', ''),
        hasHopsworksUser: true,
        hopsworksUser: {
          username: hopsworksUser.username,
          email: hopsworksUser.email,
          accountType: hopsworksUser.accountType,
          status: hopsworksUser.status,
          maxNumProjects: hopsworksUser.maxNumProjects,

          activated: hopsworksUser.activated
        },
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          owner: p.owner,
          created: p.created
        }))
      });
    } catch (error) {
      console.error('Error fetching Hopsworks data:', error);
      return res.status(200).json({
        hasCluster: true,
        clusterName: cluster.name,
        projects: [],
        error: 'Failed to fetch Hopsworks data'
      });
    }
  } catch (error) {
    console.error('Error in hopsworks-info:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}