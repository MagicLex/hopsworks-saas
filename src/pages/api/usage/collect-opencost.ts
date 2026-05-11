import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { OpenCostDirect } from '../../../lib/opencost-direct';
import { getUserProjects, getAllProjects } from '../../../lib/hopsworks-api';
import { calculateCreditsUsed, calculateDollarAmount } from '../../../config/billing-rates';
import { checkSpendingCap } from '../../../lib/spending-alerts';
import { requireCronAuth } from '../../../lib/internal-auth';
import { currentClusterEnvironment } from '../../../lib/environment';

type ProjectBreakdownEntry = {
  name: string;
  cpuHours: number;
  gpuHours: number;
  ramGBHours: number;
  onlineStorageGB: number;
  offlineStorageGB: number;
  cpuEfficiency?: number;
  ramEfficiency?: number;
  lastUpdated: string;
  lastContribution?: {
    cpuHours: number;
    gpuHours: number;
    ramGBHours: number;
    onlineStorageGB: number;
    offlineStorageGB: number;
    hourlyCost: number;
    processedAt: string;
  };
};

const HOURS_PER_MONTH = 30 * 24;

// Hopsworks system projects to ignore (no billable user)
// Note: comparison is case-insensitive so store lowercase
const SYSTEM_PROJECTS = new Set([
  'airflow',
  'glassfish_timers',
  'ycsb',
  'hopsworks',
  'metastore',
  'mysql',
  'heartbeat',
  'hops',
  'information_schema',
  'performance_schema'
]);

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
  if (!requireCronAuth(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await collectOpenCostMetrics();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error collecting OpenCost metrics:', error);
    return res.status(500).json({ 
      error: 'Failed to collect metrics',
      message: error instanceof Error ? error.message : String(error) 
    });
  }
}

async function collectOpenCostMetrics() {
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0];
  const currentHourUtc = now.getUTCHours();
  const nowIso = now.toISOString();

  const accountOwnerCache = new Map<string, string | null>();

  const resolveAccountOwnerId = async (userId: string): Promise<string | null> => {
    if (accountOwnerCache.has(userId)) {
      return accountOwnerCache.get(userId)!;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('account_owner_id')
      .eq('id', userId)
      .single();

    const accountOwnerId = error ? null : (data?.account_owner_id ?? null);
    accountOwnerCache.set(userId, accountOwnerId);
    return accountOwnerId;
  };

  const isSameUtcHour = (previousIso?: string): boolean => {
    if (!previousIso) {
      return false;
    }
    const previous = new Date(previousIso);
    return (
      previous.getUTCFullYear() === now.getUTCFullYear() &&
      previous.getUTCMonth() === now.getUTCMonth() &&
      previous.getUTCDate() === now.getUTCDate() &&
      previous.getUTCHours() === currentHourUtc
    );
  };

  const hydrateBreakdown = (data: any): Record<string, ProjectBreakdownEntry> => {
    if (!data || typeof data !== 'object') {
      return {};
    }

    const hydrated: Record<string, ProjectBreakdownEntry> = {};

    for (const [namespace, value] of Object.entries(data as Record<string, any>)) {
      // Sanitize any existing negative values (self-healing for corrupted data)
      const rawCpuHours = Number(value.cpuHours) || 0;
      const rawGpuHours = Number(value.gpuHours) || 0;
      const rawRamGBHours = Number(value.ramGBHours) || 0;

      hydrated[namespace] = {
        name: typeof value.name === 'string' ? value.name : namespace,
        cpuHours: Math.max(0, rawCpuHours),
        gpuHours: Math.max(0, rawGpuHours),
        ramGBHours: Math.max(0, rawRamGBHours),
        onlineStorageGB: Math.max(0, Number(value.onlineStorageGB) || 0),
        offlineStorageGB: Math.max(0, Number(value.offlineStorageGB) || 0),
        cpuEfficiency: typeof value.cpuEfficiency === 'number' ? value.cpuEfficiency : undefined,
        ramEfficiency: typeof value.ramEfficiency === 'number' ? value.ramEfficiency : undefined,
        lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : nowIso,
        lastContribution: value.lastContribution
          ? {
              cpuHours: Math.max(0, Number(value.lastContribution.cpuHours) || 0),
              gpuHours: Math.max(0, Number(value.lastContribution.gpuHours) || 0),
              ramGBHours: Math.max(0, Number(value.lastContribution.ramGBHours) || 0),
              onlineStorageGB: Math.max(0, Number(value.lastContribution.onlineStorageGB) || 0),
              offlineStorageGB: Math.max(0, Number(value.lastContribution.offlineStorageGB) || 0),
              hourlyCost: Math.max(0, Number(value.lastContribution.hourlyCost) || 0),
              processedAt:
                typeof value.lastContribution.processedAt === 'string'
                  ? value.lastContribution.processedAt
                  : undefined
            }
          : undefined
      };
    }

    return hydrated;
  };

  const sumStorageFromBreakdown = (breakdown: Record<string, ProjectBreakdownEntry>) => {
    return Object.values(breakdown).reduce(
      (acc, entry) => {
        acc.online += entry.onlineStorageGB || 0;
        acc.offline += entry.offlineStorageGB || 0;
        return acc;
      },
      { online: 0, offline: 0 }
    );
  };

  const computeHourlyCost = (metrics?: {
    cpuHours?: number;
    gpuHours?: number;
    ramGBHours?: number;
    onlineStorageGB?: number;
    offlineStorageGB?: number;
  }): number => {
    if (!metrics) {
      return 0;
    }

    const credits = calculateCreditsUsed({
      cpuHours: metrics.cpuHours || 0,
      gpuHours: metrics.gpuHours || 0,
      ramGbHours: metrics.ramGBHours || 0,
      onlineStorageGb: (metrics.onlineStorageGB || 0) / HOURS_PER_MONTH,
      offlineStorageGb: (metrics.offlineStorageGB || 0) / HOURS_PER_MONTH
    });

    return calculateDollarAmount(credits);
  };

  console.log(`Starting OpenCost collection for: ${currentDate} hour ${currentHourUtc} (UTC)`);

  // Get ALL Hopsworks clusters with kubeconfig (status doesn't matter for billing)
  // 'inactive' clusters may still have users generating costs.
  // Env filter prevents prod cron from exec'ing kubectl against a staging kubeconfig.
  const { data: clusters, error: clusterError } = await supabaseAdmin
    .from('hopsworks_clusters')
    .select('*')
    .eq('environment', currentClusterEnvironment())
    .not('kubeconfig', 'is', null);

  if (clusterError || !clusters || clusters.length === 0) {
    throw new Error(`Failed to fetch clusters: ${clusterError?.message || 'No clusters with kubeconfig'}`);
  }

  console.log(`Found ${clusters.length} cluster(s) to process`);

  const aggregatedResults = {
    successful: 0,
    failed: 0,
    errors: [] as string[],
    namespaces: [] as any[],
    clusters: [] as any[]
  };

  // Process each cluster
  for (const cluster of clusters) {
    console.log(`\n=== Processing cluster: ${cluster.name} (${cluster.id}) ===`);

    let opencost: OpenCostDirect | null = null;

    try {
      // Initialize OpenCost direct client for this cluster
      opencost = new OpenCostDirect(cluster.kubeconfig);

      // Get hourly allocations from OpenCost using kubectl exec
      const allocations = await opencost.getOpenCostAllocations('1h');

      // Get storage metrics in batch (once for all projects) - run in parallel
      console.log(`[${cluster.name}] Collecting storage metrics...`);
      const [offlineStorage, onlineStorage] = await Promise.all([
        opencost.getOfflineStorageBatch(),
        opencost.getOnlineStorageBatch(cluster.mysql_password || '')
      ]);
      console.log(`[${cluster.name}] Storage collected: ${offlineStorage.size} offline, ${onlineStorage.size} online`);

      console.log(`[${cluster.name}] Found ${allocations.size} namespaces with costs`);

      const clusterResults = {
        clusterId: cluster.id,
        clusterName: cluster.name,
        successful: 0,
        failed: 0,
        errors: [] as string[],
        namespaces: [] as any[]
      };

  // Process each namespace with costs
  for (const [namespace, allocation] of Array.from(allocations.entries())) {
    try {
      // Skip system namespaces
      const SYSTEM_NAMESPACES = ['hopsworks', 'ingress-nginx', 'kube-system', 'kube-public', 'kube-node-lease', 'opencost'];
      if (SYSTEM_NAMESPACES.includes(namespace)) {
        continue;
      }

      console.log(`Processing namespace: ${namespace}, cost: $${allocation.totalCost.toFixed(4)}`);

      // Look up project owner in our database first
      const { data: project } = await supabaseAdmin
        .from('user_projects')
        .select('user_id, project_name, project_id')
        .eq('namespace', namespace)
        .eq('status', 'active')
        .single();

      let userId: string | null = null;
      let projectName = namespace;
      let projectId: number | null = null;

      if (project) {
        // Found in our cache - verify user is on this cluster
        const { data: userAssignment } = await supabaseAdmin
          .from('user_hopsworks_assignments')
          .select('hopsworks_cluster_id')
          .eq('user_id', project.user_id)
          .single();

        if (userAssignment?.hopsworks_cluster_id === cluster.id) {
          userId = project.user_id;
          projectName = project.project_name;
          projectId = project.project_id;

          // Update last seen
          await supabaseAdmin
            .from('user_projects')
            .update({ last_seen_at: nowIso })
            .eq('namespace', namespace);
        } else {
          console.warn(`[${cluster.name}] Namespace ${namespace} mapped to user on different cluster, will re-resolve`);
        }
      } else {
        // Query Hopsworks API to find owner
        console.log(`Namespace ${namespace} not in cache, querying Hopsworks...`);
        
        // Try to get project info from Hopsworks
        const hopsworksProjects = await getAllProjects(
          { apiUrl: cluster.api_url, apiKey: cluster.api_key },
          `ApiKey ${cluster.api_key}`
        );

        // Match by K8s namespace (returned by Hopsworks API)
        const hopsworksProject = hopsworksProjects.find(p =>
          p.namespace.toLowerCase() === namespace.toLowerCase()
        );

        if (hopsworksProject) {
          // Find user by Hopsworks username AND verify they're on this cluster
          const { data: user } = await supabaseAdmin
            .from('users')
            .select(`
              id,
              user_hopsworks_assignments!inner (
                hopsworks_cluster_id
              )
            `)
            .eq('hopsworks_username', hopsworksProject.owner)
            .eq('user_hopsworks_assignments.hopsworks_cluster_id', cluster.id)
            .single();

          if (user) {
            userId = user.id;
            projectName = hopsworksProject.name;
            projectId = hopsworksProject.id;

            // Cache the mapping
            await supabaseAdmin
              .from('user_projects')
              .upsert({
                user_id: userId,
                project_id: projectId,
                project_name: projectName,
                namespace: hopsworksProject.namespace,
                status: 'active',
                last_seen_at: nowIso
              }, {
                onConflict: 'namespace'
              });
          } else {
            console.warn(`[${cluster.name}] Found project ${hopsworksProject.name} but owner ${hopsworksProject.owner} not on this cluster`);
          }
        }
      }

      if (!userId) {
        // Try to identify what type of namespace this is
        let namespaceType = 'user project';
        if (namespace.includes('admin') || namespace === 'hopsworks') {
          namespaceType = 'admin/system';
        }
        
        console.warn(`[${cluster.name}] No user found for namespace ${namespace} (type: ${namespaceType})`);
        clusterResults.errors.push(`Namespace ${namespace}: No user mapping found`);
        clusterResults.failed++;
        continue;
      }

      // Extract compute usage metrics
      const rawCpuHours = allocation.cpuCoreHours || 0;
      const rawRamGBHours = (allocation.ramByteHours || 0) / (1024 * 1024 * 1024);
      const rawGpuHours = allocation.gpuHours || 0;

      // Validate: OpenCost should never return negative values
      // Negative values indicate Prometheus is not scraping OpenCost metrics
      // See: https://www.opencost.io/docs/troubleshooting
      if (rawCpuHours < 0 || rawRamGBHours < 0 || rawGpuHours < 0) {
        console.error(`[BILLING CRITICAL] OpenCost returned negative values for namespace ${namespace} on cluster ${cluster.name}:`, {
          cpuCoreHours: rawCpuHours,
          ramGBHours: rawRamGBHours,
          gpuHours: rawGpuHours,
          fix: 'Add prometheus.io/scrape annotation to OpenCost service or add opencost job to Prometheus scrape_configs'
        });
        clusterResults.errors.push(`Namespace ${namespace}: OpenCost returned negative values (Prometheus scrape misconfiguration)`);
      }

      // Sanitize to prevent data corruption while issue is being fixed
      const cpuHours = Math.max(0, rawCpuHours);
      const ramGBHours = Math.max(0, rawRamGBHours);
      const gpuHours = Math.max(0, rawGpuHours);

      // Get storage for this project (convert bytes to GB)
      const offlineStorageBytes = offlineStorage.get(projectName) || 0;
      const onlineStorageBytes = onlineStorage.get(projectName) || 0;
      const offlineStorageGB = offlineStorageBytes / (1024 * 1024 * 1024);
      const onlineStorageGB = onlineStorageBytes / (1024 * 1024 * 1024);

      // Calculate cost using our rates
      const creditsUsed = calculateCreditsUsed({
        cpuHours,
        gpuHours,
        ramGbHours: ramGBHours,
        onlineStorageGb: onlineStorageGB / HOURS_PER_MONTH, // Pro-rata for this hour
        offlineStorageGb: offlineStorageGB / HOURS_PER_MONTH
      });
      const hourlyTotalCredits = creditsUsed;
      const hourlyTotalCost = calculateDollarAmount(creditsUsed);

      const accountOwnerId = await resolveAccountOwnerId(userId);

      const { data: existingUsage } = await supabaseAdmin
        .from('usage_daily')
        .select('*')
        .eq('user_id', userId)
        .eq('date', currentDate)
        .single();

      const breakdown = hydrateBreakdown(existingUsage?.project_breakdown);
      const previousEntry = breakdown[namespace];
      const previousContribution = previousEntry?.lastContribution;

      let totalCpuHours = existingUsage?.opencost_cpu_hours || 0;
      let totalGpuHours = existingUsage?.opencost_gpu_hours || 0;
      let totalRamGbHours = existingUsage?.opencost_ram_gb_hours || 0;
      let totalCredits = existingUsage?.total_credits || 0;
      let totalCost = existingUsage?.total_cost || 0;

      if (previousContribution && isSameUtcHour(previousContribution.processedAt)) {
        totalCpuHours = Math.max(0, totalCpuHours - (previousContribution.cpuHours || 0));
        totalGpuHours = Math.max(0, totalGpuHours - (previousContribution.gpuHours || 0));
        totalRamGbHours = Math.max(0, totalRamGbHours - (previousContribution.ramGBHours || 0));
        const previousHourlyCost =
          previousContribution.hourlyCost || computeHourlyCost(previousContribution);
        totalCost = Math.max(0, totalCost - previousHourlyCost);

        if (previousEntry) {
          previousEntry.cpuHours = Math.max(0, (previousEntry.cpuHours || 0) - (previousContribution.cpuHours || 0));
          previousEntry.gpuHours = Math.max(0, (previousEntry.gpuHours || 0) - (previousContribution.gpuHours || 0));
          previousEntry.ramGBHours = Math.max(0, (previousEntry.ramGBHours || 0) - (previousContribution.ramGBHours || 0));
        }
      }

      const updatedEntry: ProjectBreakdownEntry = {
        name: projectName,
        cpuHours: (breakdown[namespace]?.cpuHours || 0) + cpuHours,
        gpuHours: (breakdown[namespace]?.gpuHours || 0) + gpuHours,
        ramGBHours: (breakdown[namespace]?.ramGBHours || 0) + ramGBHours,
        onlineStorageGB: onlineStorageGB,
        offlineStorageGB: offlineStorageGB,
        cpuEfficiency: allocation.cpuEfficiency,
        ramEfficiency: allocation.ramEfficiency,
        lastUpdated: nowIso,
        lastContribution: {
          cpuHours,
          gpuHours,
          ramGBHours,
          onlineStorageGB,
          offlineStorageGB,
          hourlyCost: hourlyTotalCost,
          processedAt: nowIso
        }
      };

      breakdown[namespace] = updatedEntry;
      const storageTotals = sumStorageFromBreakdown(breakdown);

      const payload = {
        account_owner_id: accountOwnerId,
        opencost_cpu_hours: totalCpuHours + cpuHours,
        opencost_gpu_hours: totalGpuHours + gpuHours,
        opencost_ram_gb_hours: totalRamGbHours + ramGBHours,
        online_storage_gb: storageTotals.online,
        offline_storage_gb: storageTotals.offline,
        total_credits: totalCredits + hourlyTotalCredits,
        total_cost: totalCost + hourlyTotalCost,
        project_breakdown: breakdown,
        hopsworks_cluster_id: cluster.id
      };

      if (existingUsage) {
        await supabaseAdmin
          .from('usage_daily')
          .update(payload)
          .eq('id', existingUsage.id);
      } else {
        await supabaseAdmin
          .from('usage_daily')
          .insert({
            user_id: userId,
            date: currentDate,
            ...payload
          });
      }

      clusterResults.successful++;
      clusterResults.namespaces.push({
        namespace,
        projectName,
        userId,
        cpuHours,
        gpuHours,
        ramGBHours,
        onlineStorageGB,
        offlineStorageGB
      });

    } catch (error) {
      console.error(`[${cluster.name}] Failed to process namespace ${namespace}:`, error);
      clusterResults.failed++;
      clusterResults.errors.push(`Namespace ${namespace}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

      // Second pass: Process storage-only projects (no compute in last hour)
      console.log(`[${cluster.name}] Processing storage-only projects...`);

      // Get all project names that have storage
      const allProjectsWithStorage = new Set<string>();
      for (const projectName of Array.from(offlineStorage.keys())) {
        allProjectsWithStorage.add(projectName);
      }
      for (const projectName of Array.from(onlineStorage.keys())) {
        allProjectsWithStorage.add(projectName);
      }

      // Track which projects were already processed in the compute loop
      const processedProjects = new Set(
        clusterResults.namespaces.map(ns => ns.projectName)
      );

      // Process projects with storage but no compute
      for (const projectName of Array.from(allProjectsWithStorage)) {
        if (processedProjects.has(projectName)) {
          continue; // Already processed in compute loop
        }

        // Skip system projects (uses module-level SYSTEM_PROJECTS Set)
        if (SYSTEM_PROJECTS.has(projectName.toLowerCase())) {
          continue;
        }

        try {
          // Look up project owner in our database
          const { data: project } = await supabaseAdmin
            .from('user_projects')
            .select('user_id, project_name, project_id, namespace')
            .eq('project_name', projectName)
            .eq('status', 'active')
            .single();

          let userId: string | null = null;
          let projectId: number | null = null;
          let namespace = projectName;

          if (project) {
            // Verify user is on this cluster
            const { data: userAssignment } = await supabaseAdmin
              .from('user_hopsworks_assignments')
              .select('hopsworks_cluster_id')
              .eq('user_id', project.user_id)
              .single();

            if (userAssignment?.hopsworks_cluster_id === cluster.id) {
              userId = project.user_id;
              projectId = project.project_id;
              namespace = project.namespace;

              // Update last seen
              await supabaseAdmin
                .from('user_projects')
                .update({ last_seen_at: nowIso })
                .eq('project_name', projectName);
            }
          } else {
            // Query Hopsworks API to find owner
            const hopsworksProjects = await getAllProjects(
              { apiUrl: cluster.api_url, apiKey: cluster.api_key },
              `ApiKey ${cluster.api_key}`
            );

            const hopsworksProject = hopsworksProjects.find(p =>
              p.name.toLowerCase() === projectName.toLowerCase()
            );

            if (hopsworksProject) {
              const { data: user } = await supabaseAdmin
                .from('users')
                .select(`
                  id,
                  user_hopsworks_assignments!inner (
                    hopsworks_cluster_id
                  )
                `)
                .eq('hopsworks_username', hopsworksProject.owner)
                .eq('user_hopsworks_assignments.hopsworks_cluster_id', cluster.id)
                .single();

              if (user) {
                userId = user.id;
                projectId = hopsworksProject.id;
                namespace = hopsworksProject.namespace;

                // Cache the mapping
                await supabaseAdmin
                  .from('user_projects')
                  .upsert({
                    user_id: userId,
                    project_id: projectId,
                    project_name: projectName,
                    namespace: hopsworksProject.namespace,
                    status: 'active',
                    last_seen_at: nowIso
                  }, {
                    onConflict: 'namespace'
                  });
              }
            }
          }

          if (!userId) {
            // Skip system projects silently
            if (SYSTEM_PROJECTS.has(projectName.toLowerCase())) {
              continue;
            }
            console.warn(`[${cluster.name}] No user found for storage-only project ${projectName}`);
            continue;
          }

          // Get storage for this project
          const offlineStorageBytes = offlineStorage.get(projectName) || 0;
          const onlineStorageBytes = onlineStorage.get(projectName) || 0;
          const offlineStorageGB = offlineStorageBytes / (1024 * 1024 * 1024);
          const onlineStorageGB = onlineStorageBytes / (1024 * 1024 * 1024);

          // Skip if no significant storage
          if (offlineStorageGB < 0.001 && onlineStorageGB < 0.001) {
            continue;
          }

          console.log(`[${cluster.name}] Storage-only project: ${projectName}, offline: ${offlineStorageGB.toFixed(3)} GB, online: ${onlineStorageGB.toFixed(3)} GB`);

          // Calculate storage-only cost
          const creditsUsed = calculateCreditsUsed({
            cpuHours: 0,
            gpuHours: 0,
            ramGbHours: 0,
            onlineStorageGb: onlineStorageGB / HOURS_PER_MONTH,
            offlineStorageGb: offlineStorageGB / HOURS_PER_MONTH
          });
          const hourlyTotalCredits = creditsUsed;
          const hourlyTotalCost = calculateDollarAmount(creditsUsed);

          const accountOwnerId = await resolveAccountOwnerId(userId);

          const { data: existingUsage } = await supabaseAdmin
            .from('usage_daily')
            .select('*')
            .eq('user_id', userId)
            .eq('date', currentDate)
            .single();

          const breakdown = hydrateBreakdown(existingUsage?.project_breakdown);
          const previousEntry = breakdown[namespace];
          const previousContribution = previousEntry?.lastContribution;

          let totalCpuHours = existingUsage?.opencost_cpu_hours || 0;
          let totalGpuHours = existingUsage?.opencost_gpu_hours || 0;
          let totalRamGbHours = existingUsage?.opencost_ram_gb_hours || 0;
          let totalCredits = existingUsage?.total_credits || 0;
          let totalCost = existingUsage?.total_cost || 0;

          if (previousContribution && isSameUtcHour(previousContribution.processedAt)) {
            const previousHourlyCost =
              previousContribution.hourlyCost || computeHourlyCost(previousContribution);
            totalCost = Math.max(0, totalCost - previousHourlyCost);

            if (previousEntry) {
              totalCpuHours = Math.max(0, totalCpuHours - (previousContribution.cpuHours || 0));
              totalGpuHours = Math.max(0, totalGpuHours - (previousContribution.gpuHours || 0));
              totalRamGbHours = Math.max(0, totalRamGbHours - (previousContribution.ramGBHours || 0));
              previousEntry.cpuHours = Math.max(
                0,
                (previousEntry.cpuHours || 0) - (previousContribution.cpuHours || 0)
              );
              previousEntry.gpuHours = Math.max(
                0,
                (previousEntry.gpuHours || 0) - (previousContribution.gpuHours || 0)
              );
              previousEntry.ramGBHours = Math.max(
                0,
                (previousEntry.ramGBHours || 0) - (previousContribution.ramGBHours || 0)
              );
            }
          }

          const updatedEntry: ProjectBreakdownEntry = {
            name: projectName,
            cpuHours: breakdown[namespace]?.cpuHours || 0,
            gpuHours: breakdown[namespace]?.gpuHours || 0,
            ramGBHours: breakdown[namespace]?.ramGBHours || 0,
            onlineStorageGB: onlineStorageGB,
            offlineStorageGB: offlineStorageGB,
            cpuEfficiency: 0,
            ramEfficiency: 0,
            lastUpdated: nowIso,
            lastContribution: {
              cpuHours: 0,
              gpuHours: 0,
              ramGBHours: 0,
              onlineStorageGB,
              offlineStorageGB,
              hourlyCost: hourlyTotalCost,
              processedAt: nowIso
            }
          };

          breakdown[namespace] = updatedEntry;
          const storageTotals = sumStorageFromBreakdown(breakdown);

          const payload = {
            account_owner_id: accountOwnerId,
            opencost_cpu_hours: totalCpuHours,
            opencost_gpu_hours: totalGpuHours,
            opencost_ram_gb_hours: totalRamGbHours,
            online_storage_gb: storageTotals.online,
            offline_storage_gb: storageTotals.offline,
            total_credits: totalCredits + hourlyTotalCredits,
            total_cost: totalCost + hourlyTotalCost,
            project_breakdown: breakdown,
            hopsworks_cluster_id: cluster.id
          };

          if (existingUsage) {
            await supabaseAdmin
              .from('usage_daily')
              .update(payload)
              .eq('id', existingUsage.id);
          } else {
            await supabaseAdmin
              .from('usage_daily')
              .insert({
                user_id: userId,
                date: currentDate,
                ...payload
              });
          }

          clusterResults.successful++;
          clusterResults.namespaces.push({
            namespace,
            projectName,
            userId,
            cpuHours: 0,
            gpuHours: 0,
            ramGBHours: 0,
            onlineStorageGB,
            offlineStorageGB
          });

        } catch (error) {
          console.error(`[${cluster.name}] Failed to process storage-only project ${projectName}:`, error);
          clusterResults.failed++;
          clusterResults.errors.push(`Storage-only project ${projectName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      console.log(`[${cluster.name}] Storage-only processing completed`);

      // Mark projects as inactive if not seen in 30 days (per cluster)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await supabaseAdmin
        .from('user_projects')
        .update({ status: 'inactive' })
        .lt('last_seen_at', thirtyDaysAgo.toISOString())
        .eq('status', 'active');

      console.log(`[${cluster.name}] Collection completed: ${clusterResults.successful} successful, ${clusterResults.failed} failed`);

      // Aggregate cluster results
      aggregatedResults.successful += clusterResults.successful;
      aggregatedResults.failed += clusterResults.failed;
      aggregatedResults.errors.push(...clusterResults.errors);
      aggregatedResults.namespaces.push(...clusterResults.namespaces);
      aggregatedResults.clusters.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        successful: clusterResults.successful,
        failed: clusterResults.failed,
        namespaceCount: clusterResults.namespaces.length
      });

    } catch (error) {
      console.error(`[${cluster.name}] Failed to collect metrics for cluster:`, error);
      aggregatedResults.errors.push(`Cluster ${cluster.name}: ${error instanceof Error ? error.message : String(error)}`);
      aggregatedResults.clusters.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        error: error instanceof Error ? error.message : String(error),
        successful: 0,
        failed: 0,
        namespaceCount: 0
      });
    } finally {
      // Clean up temporary kubeconfig file for this cluster
      if (opencost) {
        await opencost.cleanup();
      }
    }
  }

  // Check spending caps for all users who had usage processed
  console.log(`\n=== Checking Spending Caps ===`);
  const processedUserIds = new Set(aggregatedResults.namespaces.map(ns => ns.userId));

  if (processedUserIds.size > 0) {
    // Get current month's start date
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const startOfMonthStr = startOfMonth.toISOString().split('T')[0];

    // Get monthly totals for all processed users
    const { data: monthlyUsage } = await supabaseAdmin
      .from('usage_daily')
      .select('user_id, account_owner_id, total_cost')
      .in('user_id', Array.from(processedUserIds))
      .gte('date', startOfMonthStr);

    // Aggregate by account owner (or user if no owner)
    const monthlyTotals = new Map<string, { total: number; accountOwnerId: string | null }>();

    for (const usage of monthlyUsage || []) {
      const key = usage.account_owner_id || usage.user_id;
      const existing = monthlyTotals.get(key) || { total: 0, accountOwnerId: usage.account_owner_id };
      existing.total += usage.total_cost || 0;
      monthlyTotals.set(key, existing);
    }

    // Check spending caps for each account owner
    let capsChecked = 0;
    for (const [targetUserId, data] of Array.from(monthlyTotals.entries())) {
      try {
        await checkSpendingCap(supabaseAdmin, targetUserId, data.accountOwnerId, data.total);
        capsChecked++;
      } catch (error) {
        console.error(`[SpendingCap] Error checking cap for user ${targetUserId}:`, error);
      }
    }
    console.log(`Spending caps checked for ${capsChecked} account owners`);
  }

  console.log(`\n=== Overall OpenCost Collection Summary ===`);
  console.log(`Clusters processed: ${aggregatedResults.clusters.length}`);
  console.log(`Total successful: ${aggregatedResults.successful}`);
  console.log(`Total failed: ${aggregatedResults.failed}`);
  console.log(`Total errors: ${aggregatedResults.errors.length}`);

  return {
    message: 'OpenCost metrics collection completed for all clusters',
    timestamp: currentDate,
    hour: currentHourUtc,
    clustersProcessed: aggregatedResults.clusters.length,
    results: aggregatedResults
  };
}
