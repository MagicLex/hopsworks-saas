import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireCronAuth } from '../../../lib/internal-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface IntegrityIssue {
  check: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  count: number;
  affected: string[];
}

async function sendSlackAlert(issues: IntegrityIssue[]) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;

  const issueList = issues
    .map(i => `• *${i.severity.toUpperCase()}* \`${i.check}\`: ${i.count} affected\n  ${i.affected.slice(0, 3).join(', ')}${i.affected.length > 3 ? '...' : ''}`)
    .join('\n');

  const text = `:warning: *Data Integrity Alert*\n${criticalCount} critical, ${highCount} high severity issues found\n\n${issueList}`;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(err => console.error('[Slack] Failed to send alert:', err));
}

interface DailyStats {
  totalUsers: number;
  activeUsers: number;
  paidUsers: number;
  onboardingUsers: number;
  freeUsers: number;
  prepaidUsers: number;
  teamMembers: number;
  newUsersToday: number;
  newUsers7d: number;
  clustersActive: number;
  totalUsageThisMonth: number;
}

async function sendDailyDigest(stats: DailyStats, issues: IntegrityIssue[]) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const actionableIssues = issues.filter(i => i.severity !== 'info');
  const statusEmoji = actionableIssues.length === 0 ? ':white_check_mark:' : ':warning:';
  const issueLines = actionableIssues.length === 0
    ? 'All systems healthy'
    : actionableIssues.map(i => `• *${i.severity.toUpperCase()}* \`${i.check}\`: ${i.count} affected\n  ${i.affected.slice(0, 5).join(', ')}${i.affected.length > 5 ? ` (+${i.affected.length - 5} more)` : ''}`).join('\n');

  const text = `:chart_with_upwards_trend: *Daily SaaS Report* - ${new Date().toISOString().split('T')[0]}

*Users*
• Total: *${stats.totalUsers}* (${stats.activeUsers} active)
• Paid (postpaid): *${stats.paidUsers}*
• Onboarding (no sub): *${stats.onboardingUsers}*
• Free tier: *${stats.freeUsers}*
• Prepaid/Corporate: *${stats.prepaidUsers}*
• Team members: *${stats.teamMembers}*

*Growth*
• New last 24h: *${stats.newUsersToday}*
• New last 7d: *${stats.newUsers7d}*

*Infrastructure*
• Active clusters: *${stats.clustersActive}*
• Usage this month: *$${stats.totalUsageThisMonth.toFixed(2)}*

*Health* ${statusEmoji}
${issueLines}`;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(err => console.error('[Slack] Failed to send daily digest:', err));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireCronAuth(req, res)) return;

  const issues: IntegrityIssue[] = [];

  try {
  // CHECK 1: hopsworks_user_id desync between users and assignments
  const { data: hwIdDesync } = await supabaseAdmin.rpc('check_hopsworks_id_desync');

  if (!hwIdDesync) {
    // Fallback to direct query if RPC doesn't exist
    const { data: desyncUsers } = await supabaseAdmin
      .from('users')
      .select(`
        email,
        hopsworks_user_id,
        user_hopsworks_assignments!left(hopsworks_user_id)
      `)
      .not('hopsworks_user_id', 'is', null)
      .is('deleted_at', null);

    const desynced = desyncUsers?.filter(u => {
      const assignment = (u as any).user_hopsworks_assignments?.[0];
      return !assignment?.hopsworks_user_id || assignment.hopsworks_user_id !== u.hopsworks_user_id;
    }) || [];

    if (desynced.length > 0) {
      issues.push({
        check: 'hopsworks_user_id_desync',
        severity: 'critical',
        count: desynced.length,
        affected: desynced.map(u => u.email)
      });
    }
  }

  // CHECK 2: Users with assignment but no hopsworks_user_id anywhere
  const { data: missingHwId } = await supabaseAdmin
    .from('user_hopsworks_assignments')
    .select(`
      user_id,
      users!inner(email, hopsworks_user_id)
    `)
    .is('hopsworks_user_id', null);

  const missingBoth = missingHwId?.filter(a => !(a as any).users?.hopsworks_user_id) || [];
  if (missingBoth.length > 0) {
    issues.push({
      check: 'assignment_without_hopsworks_user',
      severity: 'info',
      count: missingBoth.length,
      affected: missingBoth.map(a => (a as any).users?.email)
    });
  }

  // CHECK 3: Postpaid users without subscription (stuck/blocked)
  const { data: stuckPostpaid } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('billing_mode', 'postpaid')
    .is('stripe_subscription_id', null)
    .is('account_owner_id', null)
    .is('deleted_at', null);

  if (stuckPostpaid && stuckPostpaid.length > 0) {
    issues.push({
      check: 'postpaid_without_subscription',
      severity: 'high',
      count: stuckPostpaid.length,
      affected: stuckPostpaid.map(u => u.email)
    });
  }

  // CHECK 4: Subscription desync - DB says active but Stripe says canceled/missing
  // Only check users whose DB status is NOT already canceled (those are legitimately in cancellation flow)
  const { data: usersWithSub } = await supabaseAdmin
    .from('users')
    .select('id, email, stripe_subscription_id, stripe_subscription_status')
    .eq('billing_mode', 'postpaid')
    .not('stripe_subscription_id', 'is', null)
    .neq('stripe_subscription_status', 'canceled')
    .is('deleted_at', null)
    .limit(20); // Limit to avoid Stripe rate limits

  const desyncedUsers: string[] = [];
  for (const user of usersWithSub || []) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id!);
      // If subscription is canceled/incomplete_expired, user has "ghost access"
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        desyncedUsers.push(`${user.email} (${sub.status})`);
      }
    } catch (e: any) {
      // Subscription doesn't exist in Stripe at all
      if (e.code === 'resource_missing') {
        desyncedUsers.push(`${user.email} (not found in Stripe)`);
      }
    }
  }

  if (desyncedUsers.length > 0) {
    issues.push({
      check: 'subscription_desync',
      severity: 'high',
      count: desyncedUsers.length,
      affected: desyncedUsers
    });
  }

  // CHECK 5: Cluster user count drift
  const { data: clusters } = await supabaseAdmin
    .from('hopsworks_clusters')
    .select('id, name, current_users');

  for (const cluster of clusters || []) {
    const { count } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('hopsworks_cluster_id', cluster.id);

    if (count !== null && count !== cluster.current_users) {
      // Auto-correct: assignments table is source of truth
      await supabaseAdmin
        .from('hopsworks_clusters')
        .update({ current_users: count })
        .eq('id', cluster.id);

      issues.push({
        check: 'cluster_user_count_drift',
        severity: 'medium',
        count: Math.abs(count - cluster.current_users),
        affected: [`${cluster.name}: current_users=${cluster.current_users} → corrected to ${count}`]
      });
    }
  }

  // CHECK 4: Orphan project_member_roles (member_id not in users)
  const { data: orphanRoles } = await supabaseAdmin
    .from('project_member_roles')
    .select(`
      id,
      member_id,
      users!project_member_roles_member_id_fkey(id)
    `);

  const orphaned = orphanRoles?.filter(r => !(r as any).users) || [];
  if (orphaned.length > 0) {
    issues.push({
      check: 'orphan_project_member_roles',
      severity: 'medium',
      count: orphaned.length,
      affected: orphaned.map(r => r.member_id)
    });
  }

  // CHECK 6: Stripe sync didn't run (yesterday's postpaid usage unreported at 6 AM)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toISOString().split('T')[0];

  const { data: unreportedYesterday } = await supabaseAdmin
    .from('usage_daily')
    .select(`
      id,
      users!usage_daily_user_id_fkey!inner(email)
    `)
    .eq('date', yesterdayDate)
    .eq('reported_to_stripe', false)
    .eq('users.billing_mode', 'postpaid')
    .is('users.account_owner_id', null)
    .not('users.stripe_subscription_id', 'is', null)
    .gt('total_credits', 0);

  if (unreportedYesterday && unreportedYesterday.length > 0) {
    issues.push({
      check: 'stripe_sync_not_run',
      severity: 'critical',
      count: unreportedYesterday.length,
      affected: unreportedYesterday.map(u => (u as any).users?.email)
    });
  }

  // CHECK 7: Unresolved health check failures older than 7 days
  const { data: oldFailures, count: oldFailureCount } = await supabaseAdmin
    .from('health_check_failures')
    .select('email, check_type', { count: 'exact' })
    .is('resolved_at', null)
    .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (oldFailureCount && oldFailureCount > 0) {
    issues.push({
      check: 'stale_health_check_failures',
      severity: 'medium',
      count: oldFailureCount,
      affected: (oldFailures || []).slice(0, 10).map(f => `${f.email}: ${f.check_type}`)
    });
  }

  // Log critical/high issues to health_check_failures and send Slack alert
  const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'high');

  if (criticalIssues.length > 0) {
    await supabaseAdmin
      .from('health_check_failures')
      .insert({
        user_id: 'system',
        email: 'data-integrity-check',
        check_type: 'data_integrity_alert',
        error_message: `Found ${criticalIssues.length} critical/high integrity issues`,
        details: { issues: criticalIssues, timestamp: new Date().toISOString() }
      });

    // Send Slack alert
    await sendSlackAlert(criticalIssues);

    console.error('[Data Integrity] ALERT:', JSON.stringify(criticalIssues, null, 2));
  }

  // DAILY STATS for digest
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Total users (not deleted)
  const { count: totalUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  // Active users (logged in last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: activeUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('last_login_at', thirtyDaysAgo);

  // Paid users (postpaid with active subscription)
  const { count: paidUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('account_owner_id', null)
    .eq('billing_mode', 'postpaid')
    .not('stripe_subscription_id', 'is', null);

  // Onboarding users (defaulted to postpaid but never completed payment setup)
  const { count: onboardingUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('account_owner_id', null)
    .eq('billing_mode', 'postpaid')
    .is('stripe_subscription_id', null);

  // Free tier users
  const { count: freeUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('account_owner_id', null)
    .eq('billing_mode', 'free');

  // Prepaid/corporate users
  const { count: prepaidUsers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('account_owner_id', null)
    .eq('billing_mode', 'prepaid');

  // Team members
  const { count: teamMembers } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .not('account_owner_id', 'is', null);

  // New users in last 24h (rolling window so the 8 AM report captures yesterday's signups)
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count: newUsersToday } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('created_at', twentyFourHoursAgo);

  // New users last 7 days
  const { count: newUsers7d } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('created_at', sevenDaysAgo);

  // Active clusters
  const { count: clustersActive } = await supabaseAdmin
    .from('hopsworks_clusters')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  // Total usage this month — use DB-side sum to avoid Supabase's 1000 row default limit
  const { data: usageSum } = await supabaseAdmin
    .rpc('sum_usage_this_month', { month_start: monthStart.split('T')[0] });

  const totalUsageThisMonth = usageSum ?? 0;

  const stats: DailyStats = {
    totalUsers: totalUsers || 0,
    activeUsers: activeUsers || 0,
    paidUsers: paidUsers || 0,
    onboardingUsers: onboardingUsers || 0,
    freeUsers: freeUsers || 0,
    prepaidUsers: prepaidUsers || 0,
    teamMembers: teamMembers || 0,
    newUsersToday: newUsersToday || 0,
    newUsers7d: newUsers7d || 0,
    clustersActive: clustersActive || 0,
    totalUsageThisMonth
  };

  // Always send daily digest
  await sendDailyDigest(stats, issues);

  const summary = {
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    info: issues.filter(i => i.severity === 'info').length,
    issues,
    stats
  };

  console.log('[Data Integrity] Check completed:', JSON.stringify(summary, null, 2));

  return res.status(200).json(summary);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Data Integrity] Handler crashed:', errorMsg);

    // Still try to send what we have to Slack so we're never blind
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:x: *Data Integrity Check CRASHED*\n\`\`\`${errorMsg}\`\`\`\n${issues.length} issues collected before crash.`
        })
      }).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error', message: errorMsg });
  }
}
