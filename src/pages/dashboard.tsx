import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBilling, BillingInfo } from '@/contexts/BillingContext';
import { useApiData } from '@/hooks/useApiData';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CreditCard,
  Trash2,
  Server,
  Database,
  Activity,
  Copy,
  ExternalLink,
  CheckCircle,
  Mail,
  Calendar,
  AlertTriangle,
  TrendingUp,
  Clock,
  FolderOpen,
  RefreshCw,
  Users,
} from 'lucide-react';
import Layout from '@/components/Layout';
import ClusterAccessStatus from '@/components/ClusterAccessStatus';
import TeamMemberProjects from '@/components/team/TeamMemberProjects';
import CardSkeleton from '@/components/CardSkeleton';
import { usePricing } from '@/contexts/PricingContext';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import posthog from 'posthog-js';

interface UsageData {
  cpuHours: number;
  gpuHours: number;
  ramGbHours?: number;
  storageGB: number;
  featureGroups: number;
  modelDeployments: number;
  lastUpdate?: string;
  projectBreakdown?: Record<string, {
    cpuHours: number;
    gpuHours: number;
    ramGBHours: number;
  }>;
}

interface HopsworksInfo {
  hasCluster: boolean;
  clusterName?: string;
  clusterEndpoint?: string;
  hasHopsworksUser?: boolean;
  hopsworksUser?: {
    username: string;
    email: string;
    accountType: string;
    status: number;
    maxNumProjects: number;

    activated: string;
  };
  projects?: Array<{
    id: number;
    name: string;
    owner: string;
    created: string;
  }>;
}

interface InstanceData {
  name: string;
  status: string;
  endpoint: string;
  plan: string;
  created: string | null;
}

interface ProjectMemberRole {
  project_name: string;
  role: string;
  synced_to_hopsworks: boolean;
}

interface TeamData {
  account_owner: {
    id: string;
    email: string;
    name: string;
  };
  team_members: Array<{
    id: string;
    email: string;
    name: string;
    created_at: string;
    last_login_at: string;
    hopsworks_username: string;
    status: string;
    project_member_roles?: ProjectMemberRole[];
  }>;
  is_owner: boolean;
}

interface TeamInvite {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  created_at: string;
}

type StatusBoxTone = 'info' | 'warning' | 'error' | 'success';

const statusBoxStyles: Record<StatusBoxTone, string> = {
  info: 'border-quartz-label-blue/40 bg-quartz-label-blue-shade2 text-quartz-label-blue',
  warning: 'border-quartz-label-orange/40 bg-quartz-label-orange-shade2 text-quartz-label-orange',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-quartz-label-green/40 bg-quartz-label-green-shade2 text-quartz-label-green',
};

function StatusBox({
  tone,
  icon,
  className,
  children,
}: {
  tone: StatusBoxTone;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 flex items-start gap-3',
        statusBoxStyles[tone],
        className,
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { billing: contextBilling, loading: contextBillingLoading, refetch: refetchBilling } = useBilling();
  const { pricing } = usePricing();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState('current');
  const { data: usage, loading: usageLoading, error: usageError } = useApiData<UsageData>('/api/usage');
  const { data: hopsworksInfo, loading: hopsworksLoading, error: hopsworksError, refetch: refetchHopsworksInfo } = useApiData<HopsworksInfo>('/api/user/hopsworks-info');
  const { data: instance, loading: instanceLoading, error: instanceError } = useApiData<InstanceData>('/api/instance');
  const { data: teamData, loading: teamLoading, refetch: refetchTeamData, error: teamError } = useApiData<TeamData>('/api/team/members');

  // Combine API errors for display
  const apiError = usageError || hopsworksError || instanceError || teamError;
  const [historicalBilling, setHistoricalBilling] = useState<BillingInfo | null>(null);
  const [historicalBillingLoading, setHistoricalBillingLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('cluster');
  const [copied, setCopied] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Data scientist');
  const [autoAssignProjects, setAutoAssignProjects] = useState(true);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [reloadProgress, setReloadProgress] = useState(0);
  const [spendingCapInput, setSpendingCapInput] = useState('');
  const [savingSpendingCap, setSavingSpendingCap] = useState(false);
  const [spendingCapEnabled, setSpendingCapEnabled] = useState(false);
  const [upgradingToPostpaid, setUpgradingToPostpaid] = useState(false);
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);

  // Use context billing for current month, local state for historical
  const billing = selectedMonth === 'current' ? contextBilling : historicalBilling;
  const billingLoading = selectedMonth === 'current' ? contextBillingLoading : historicalBillingLoading;

  // Fetch historical billing data when month changes
  useEffect(() => {
    if (!authLoading && user && selectedMonth !== 'current') {
      setHistoricalBillingLoading(true);
      fetch(`/api/billing?month=${selectedMonth}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) setHistoricalBilling(data);
        })
        .catch(err => console.error('Failed to fetch historical billing:', err))
        .finally(() => setHistoricalBillingLoading(false));
    }
  }, [selectedMonth, authLoading, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    } else if (user && billing) {
      // Identify user in PostHog when dashboard loads
      posthog.identify(user.sub, {
        email: user.email,
        name: user.name,
        billingMode: billing.billingMode,
        isTeamMember: billing.isTeamMember,
        hasPaymentMethod: billing.hasPaymentMethod,
      });
    }
  }, [user, authLoading, router, billing]);

  // Refetch billing when team member just joined (to update isTeamMember status)
  useEffect(() => {
    if (router.query.joined === 'true' && !billingLoading) {
      refetchBilling();
      // Clean up the URL param after refetch
      router.replace('/dashboard', undefined, { shallow: true });
    }
  }, [router.query.joined, billingLoading, refetchBilling, router]);

  // Redirect suspended users or users who haven't accepted terms to billing setup
  // Team members don't need billing setup - they inherit from account owner
  useEffect(() => {
    if (!billingLoading && billing) {
      if (billing.isTeamMember) {
        // Team members don't need billing setup
        return;
      }
      if (billing.isSuspended || !billing.termsAcceptedAt || !billing.billingMode) {
        router.push('/billing-setup');
      }
    }
  }, [billing, billingLoading, router]);

  // Show downgrade modal for free users with >1 project and a deadline
  useEffect(() => {
    if (!billingLoading && billing && hopsworksInfo) {
      const projectCount = hopsworksInfo.projects?.length || 0;
      if (billing.billingMode === 'free' && billing.downgradeDeadline && projectCount > 1) {
        setShowDowngradeModal(true);
      } else {
        setShowDowngradeModal(false);
      }
    }
  }, [billing, billingLoading, hopsworksInfo]);

  // Handle tab query parameter
  useEffect(() => {
    if (router.query.tab && typeof router.query.tab === 'string') {
      // Redirect prepaid/free users away from billing tab
      if (router.query.tab === 'billing' && (billing?.billingMode === 'prepaid' || billing?.billingMode === 'free')) {
        setActiveTab('cluster');
      } else {
        if (router.query.tab === 'billing') {
          // Track billing tab viewed
          posthog.capture('billing_tab_viewed', {
            billingMode: billing?.billingMode,
            hasPaymentMethod: billing?.hasPaymentMethod,
          });
        }
        setActiveTab(router.query.tab);
      }
    }
  }, [router, router.query.tab, billing?.billingMode, billing?.hasPaymentMethod]);

  // Fetch team invites when user and team data is available
  useEffect(() => {
    if (user && teamData?.is_owner) {
      fetchInvites();
    }
  }, [user, teamData]);

  // Auto-reload page when waiting for cluster provisioning with progress bar
  useEffect(() => {
    if (!billingLoading && (billing?.billingMode === 'prepaid' || billing?.billingMode === 'free') && !hopsworksInfo?.hasCluster && !hopsworksLoading) {
      const reloadDelay = 15000; // 15 seconds
      const progressInterval = 100; // Update every 100ms
      const steps = reloadDelay / progressInterval;
      let currentStep = 0;

      // Animate progress bar
      const progressTimer = setInterval(() => {
        currentStep++;
        setReloadProgress((currentStep / steps) * 100);

        if (currentStep >= steps) {
          window.location.reload();
        }
      }, progressInterval);

      return () => {
        clearInterval(progressTimer);
        setReloadProgress(0);
      };
    } else {
      setReloadProgress(0);
    }
  }, [billingLoading, billing?.billingMode, hopsworksInfo?.hasCluster, hopsworksLoading]);

  // Initialize spending cap state when billing loads
  useEffect(() => {
    if (billing && !billingLoading) {
      const hasCap = billing.spendingCap !== null && billing.spendingCap !== undefined;
      setSpendingCapEnabled(hasCap);
      setSpendingCapInput(hasCap ? String(billing.spendingCap) : '');
    }
  }, [billing, billingLoading]);

  const handleUpgradeToPostpaid = async () => {
    setUpgradingToPostpaid(true);
    try {
      const response = await fetch('/api/billing/setup-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set up payment');
      }

      if (data.success && data.redirectUrl) {
        // Subscription created directly - refresh and redirect
        window.location.href = data.redirectUrl;
      } else if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    } catch (error) {
      console.error('Error upgrading to postpaid:', error);
      setUpgradingToPostpaid(false);
    }
  };

  const handleSaveSpendingCap = async () => {
    setSavingSpendingCap(true);
    try {
      const capValue = spendingCapEnabled ? parseFloat(spendingCapInput) : null;
      const response = await fetch('/api/spending-cap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cap: capValue })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save spending cap');
      }

      await refetchBilling();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save spending cap');
    } finally {
      setSavingSpendingCap(false);
    }
  };

  const fetchInvites = async () => {
    try {
      const response = await fetch('/api/team/invite');
      if (!response.ok) throw new Error('Failed to fetch invites');
      const data = await response.json();
      setInvites(data.invites || []);
    } catch (error) {
      console.error('Error fetching invites:', error);
    }
  };

  const handleInvite = async () => {
    setInviteError('');
    setInviteLoading(true);

    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          projectRole: inviteRole,
          autoAssignProjects
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invite');
      }

      await fetchInvites();
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('Data scientist');
      setAutoAssignProjects(true);
    } catch (error: any) {
      setInviteError(error.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removingMember, setRemovingMember] = useState(false);

  const handleRemoveMember = async (memberId: string) => {
    setRemovingMemberId(memberId);
    setShowRemoveModal(true);
  };

  const confirmRemoveMember = async () => {
    if (!removingMemberId) return;

    setRemovingMember(true);
    try {
      const response = await fetch(`/api/team/members?memberId=${removingMemberId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to remove member');

      setShowRemoveModal(false);
      setRemovingMemberId(null);
      await refetchTeamData();
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove team member. Please try again.');
    } finally {
      setRemovingMember(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`/api/team/invite?inviteId=${inviteId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to cancel invite');

      await fetchInvites();
    } catch (error) {
      console.error('Error canceling invite:', error);
    }
  };

  const copyInviteLink = (token: string) => {
    const inviteUrl = `${window.location.origin}/team/accept-invite?token=${token}`;
    navigator.clipboard.writeText(inviteUrl);
    toast.success('Invite link copied to clipboard');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <Head>
        <title>Dashboard - Hopsworks</title>
        <meta name="description" content="Manage your Hopsworks instance, monitor usage, and access your ML platform resources." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Layout className="py-10 px-5">
        <div className="max-w-6xl mx-auto">
          {/* Team Member Banner */}
          {billing?.isTeamMember && (
            <StatusBox
              tone="info"
              icon={<Users size={20} className="text-quartz-label-blue mt-0.5" />}
              className="mb-6"
            >
              <p className="text-sm">
                You are part of <strong>{billing.accountOwner?.name || billing.accountOwner?.email}</strong>&apos;s team.
                Your usage is billed to the account owner.
              </p>
            </StatusBox>
          )}

          {/* API Error Banner */}
          {apiError && (
            <StatusBox
              tone="warning"
              icon={<AlertTriangle size={20} className="text-quartz-label-orange mt-0.5" />}
              className="mb-6"
            >
              <p className="text-sm">
                Some data could not be loaded. Please refresh the page. If the problem persists, contact support.
              </p>
            </StatusBox>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="cluster">Cluster</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
              {billingLoading ? (
                <TabsTrigger value="billing" disabled className="opacity-50">
                  Billing
                </TabsTrigger>
              ) : (
                billing?.billingMode !== 'prepaid' && billing?.billingMode !== 'free' && (
                  <TabsTrigger value="billing">Billing</TabsTrigger>
                )
              )}
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="cluster">
              {/* Cluster Access Status */}
              <div className="mb-6">
                <ClusterAccessStatus
                  hasCluster={hopsworksInfo?.hasCluster || false}
                  hasPaymentMethod={billing?.hasPaymentMethod || false}
                  billingMode={billing?.billingMode ?? undefined}
                  clusterName={hopsworksInfo?.clusterName}
                  loading={hopsworksLoading || billingLoading || !billing || !hopsworksInfo}
                  reloadProgress={reloadProgress}
                  isTeamMember={billing?.isTeamMember}
                />
              </div>

              {/* Free tier upsell banner */}
              {billing?.billingMode === 'free' && hopsworksInfo?.hasCluster && (
                <StatusBox
                  tone="info"
                  icon={<TrendingUp size={20} className="text-quartz-label-blue mt-0.5" />}
                  className="mb-6"
                >
                  <p className="text-sm">
                    <strong>Free plan:</strong> 1 project limit.{' '}
                    <button
                      type="button"
                      onClick={handleUpgradeToPostpaid}
                      disabled={upgradingToPostpaid}
                      className="underline hover:opacity-80 disabled:opacity-50"
                    >
                      {upgradingToPostpaid ? 'Upgrading...' : (billing?.hasPaymentMethod ? 'Upgrade to Pay-as-you-go' : 'Add a payment method')}
                    </button>{' '}
                    to unlock 5 projects and remove quotas.
                  </p>
                </StatusBox>
              )}

              {instance && instance.endpoint ? (
                <>
                  {/* Usage Metrics - moved to top */}
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold mb-4">Current Usage</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {billingLoading ? (
                        <CardSkeleton rows={2} showIcon={false} />
                      ) : (
                        <Card className="p-4">
                          <span className="inline-flex items-center gap-2 mb-2">
                            <CreditCard size={16} className="text-primary" />
                            <span className="text-sm text-muted-foreground">This Month</span>
                          </span>
                          <p className="text-xl font-semibold">
                            ${billing?.currentUsage?.currentMonth?.total?.toFixed(2) || '0.00'}
                          </p>
                          {billing?.spendingCap ? (
                            <p className="text-xs text-muted-foreground">of ${billing.spendingCap} cap</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">No spending cap</p>
                          )}
                        </Card>
                      )}
                      {hopsworksLoading ? (
                        <CardSkeleton rows={2} showIcon={false} className="md:col-span-2" />
                      ) : hopsworksInfo?.hasHopsworksUser ? (
                        <Card className="p-4 md:col-span-2">
                          <span className="inline-flex items-center gap-2 mb-2">
                            <Database size={16} className="text-primary" />
                            <span className="text-sm text-muted-foreground">Projects</span>
                          </span>
                          <p className="text-xl font-semibold">
                            {hopsworksInfo?.projects?.length || '0'}
                          </p>
                          <p className="text-xs text-muted-foreground">Active projects</p>
                          <div className="mt-3 pt-3 border-t border-border">
                            {hopsworksInfo?.projects && hopsworksInfo.projects.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {hopsworksInfo.projects.slice(0, 3).map(project => (
                                  <a
                                    key={project.id}
                                    href={`${instance?.endpoint || hopsworksInfo?.clusterEndpoint || ''}/p/${project.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-quartz-primary/10 hover:bg-quartz-primary/20 text-primary rounded-full text-sm font-medium transition-colors"
                                  >
                                    <FolderOpen size={14} />
                                    <span>{project.name}</span>
                                    <ExternalLink size={12} />
                                  </a>
                                ))}
                                {hopsworksInfo.projects.length > 3 && (
                                  <span className="inline-flex items-center px-3 py-1.5 bg-muted text-muted-foreground rounded-full text-sm">
                                    +{hopsworksInfo.projects.length - 3} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No projects yet</p>
                            )}
                          </div>
                        </Card>
                      ) : null}
                    </div>
                  </div>

                  {instanceLoading ? (
                    <CardSkeleton rows={4} className="mb-6" />
                  ) : (
                    <Card className="p-6 mb-6">
                      <div className="flex items-center gap-3 mb-4">
                        <Server size={20} className="text-primary" />
                        <h2 className="text-lg font-semibold">Your Hopsworks Instance</h2>
                        <Badge variant={instance.status === 'active' ? 'success' : 'secondary'}>
                          {instance.status || 'Unknown'}
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Instance Name</span>
                          <span className="text-sm font-medium">{instance.name}</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Plan</span>
                          <span className="text-sm font-medium">{instance.plan}</span>
                        </div>

                        {instance.created && (
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Created</span>
                            <span className="text-sm font-medium">
                              {new Date(instance.created).toLocaleDateString()}
                            </span>
                          </div>
                        )}

                        <div className="pt-3 border-t border-border">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Endpoint</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                                {instance.endpoint}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(instance.endpoint);
                                  setCopied('endpoint');
                                  setTimeout(() => setCopied(''), 2000);
                                }}
                                aria-label="Copy endpoint"
                              >
                                {copied === 'endpoint' ? <CheckCircle size={14} /> : <Copy size={14} />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3 mt-6">
                        <Button
                          variant={instance.endpoint ? 'default' : 'secondary'}
                          className="flex-1"
                          disabled={!instance.endpoint}
                          onClick={() => {
                            if (instance.endpoint) {
                              // Track cluster access
                              posthog.capture('cluster_accessed', {
                                clusterEndpoint: instance.endpoint,
                                instanceName: instance.name,
                                billingMode: billing?.billingMode,
                              });

                              // Redirect to auto-OAuth URL for automatic login with Auth0
                              const autoOAuthUrl = `${instance.endpoint}/autoOAuth?providerName=Auth0`;
                              window.open(autoOAuthUrl, '_blank');

                              // Only trigger sync if user needs it (missing Hopsworks info or payment but no projects)
                              const needsSync = !hopsworksInfo?.hopsworksUser ||
                                              (billing?.hasPaymentMethod && (!hopsworksInfo?.projects || hopsworksInfo.projects.length === 0));

                              if (needsSync) {
                                // Start retrying after 2s with exponential backoff
                                let retryCount = 0;
                                const maxRetries = 5;
                                const baseDelay = 2000; // 2 seconds base

                                const attemptSync = async () => {
                                  try {
                                    const response = await fetch('/api/auth/sync-user', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({})
                                    });

                                    if (response.ok) {
                                      console.log('Successfully synced user after Hopsworks access');
                                      return;
                                    }

                                    // If not OK, maybe retry
                                    if (retryCount < maxRetries) {
                                      retryCount++;
                                      const delay = baseDelay * Math.pow(2, retryCount - 1); // Exponential backoff
                                      console.log(`Sync failed, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
                                      setTimeout(attemptSync, delay);
                                    } else {
                                      console.error('Failed to sync after max retries');
                                    }
                                  } catch (error) {
                                    if (retryCount < maxRetries) {
                                      retryCount++;
                                      const delay = baseDelay * Math.pow(2, retryCount - 1);
                                      console.log(`Sync error, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`, error);
                                      setTimeout(attemptSync, delay);
                                    } else {
                                      console.error('Failed to sync after max retries:', error);
                                    }
                                  }
                                };

                                // Start after 1 second
                                setTimeout(attemptSync, 1000);
                              }
                            }
                          }}
                        >
                          {instance.endpoint ? 'Access Hopsworks' : 'No Cluster Assigned'}
                        </Button>
                      </div>
                    </Card>
                  )}

                  {/* Quick Start Code */}
                  <Card className="p-6 mb-6">
                    <h3 className="text-lg font-semibold mb-4">Quick Start - Connect from VS Code</h3>

                    <p className="text-sm text-muted-foreground mb-4">
                      Connect to your Hopsworks cluster from VS Code, Jupyter notebooks, or any local environment:
                    </p>

                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 z-10 text-gray-300 hover:text-white hover:bg-white/10"
                        onClick={() => {
                          // Extract host and port from endpoint URL if available
                          let host = 'YOUR_CLUSTER_HOST';
                          let port = 443;
                          if (instance?.endpoint) {
                            try {
                              const url = new URL(instance.endpoint);
                              host = url.hostname;
                              port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
                            } catch (e) {
                              // Fallback to defaults
                            }
                          }

                          const code = `# Install Hopsworks Python client
!pip install "hopsworks[python]"

# Connect to Hopsworks
import hopsworks

project = hopsworks.login(
    project='your_project_name',  # Replace with your project name
    host="${host}",
    port=${port},
    api_key_value="your api key"  # Get from Hopsworks UI > Account Settings > API Keys
)

# Access the feature store
fs = project.get_feature_store()

# Example: Read an existing feature group
fg = fs.get_feature_group(
    name="your_feature_group",
    version=1
)

# Read data from the feature group
df = fg.read()
print(f"Connected to {project.name}. Feature group has {len(df)} rows")

# For model serving
ms = project.get_model_serving()

# For model registry
mr = project.get_model_registry()`;
                          navigator.clipboard.writeText(code);

                          // Track quickstart code copied
                          posthog.capture('quickstart_code_copied', {
                            instanceEndpoint: instance?.endpoint,
                          });

                          setCopied('quickstart');
                          setTimeout(() => setCopied(''), 2000);
                        }}
                      >
                        {copied === 'quickstart' ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle size={14} className="text-quartz-primary" />
                            <span className="text-xs">Copied!</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Copy size={14} />
                            <span className="text-xs">Copy</span>
                          </span>
                        )}
                      </Button>
                      <pre className="overflow-x-auto p-4 text-sm bg-gray-900 text-gray-300 rounded">
                        <code>
                          <span className="text-gray-500"># Install Hopsworks Python client</span>
                          {'\n'}
                          <span className="text-yellow-300">!pip install</span> <span className="text-green-300">&quot;hopsworks[python]&quot;</span>
                          {'\n\n'}
                          <span className="text-gray-500"># Connect to Hopsworks</span>
                          {'\n'}
                          <span className="text-purple-400">import</span> <span className="text-green-400">hopsworks</span>
                          {'\n\n'}
                          <span className="text-blue-300">project</span> = <span className="text-green-400">hopsworks</span>.<span className="text-yellow-300">login</span>(
                          {'\n    '}
                          <span className="text-orange-300">project</span>=<span className="text-green-300">&apos;your_project_name&apos;</span>,  <span className="text-gray-500"># Replace with your project name</span>
                          {'\n    '}
                          <span className="text-orange-300">host</span>=<span className="text-green-300">&quot;{(() => {
                            if (instance?.endpoint) {
                              try {
                                const url = new URL(instance.endpoint);
                                return url.hostname;
                              } catch (e) {}
                            }
                            return 'YOUR_CLUSTER_HOST';
                          })()}&quot;</span>,
                          {'\n    '}
                          <span className="text-orange-300">port</span>=<span className="text-purple-300">{(() => {
                            if (instance?.endpoint) {
                              try {
                                const url = new URL(instance.endpoint);
                                return parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
                              } catch (e) {}
                            }
                            return 443;
                          })()}</span>,
                          {'\n    '}
                          <span className="text-orange-300">api_key_value</span>=<span className="text-green-300">&quot;your api key&quot;</span>  <span className="text-gray-500"># Get from Hopsworks UI &gt; Account Settings &gt; API Keys</span>
                          {'\n'}
                          )
                          {'\n\n'}
                          <span className="text-gray-500"># Access the feature store</span>
                          {'\n'}
                          <span className="text-blue-300">fs</span> = <span className="text-blue-300">project</span>.<span className="text-yellow-300">get_feature_store</span>()
                          {'\n\n'}
                          <span className="text-gray-500"># Example: Read an existing feature group</span>
                          {'\n'}
                          <span className="text-blue-300">fg</span> = <span className="text-blue-300">fs</span>.<span className="text-yellow-300">get_feature_group</span>(
                          {'\n    '}
                          <span className="text-orange-300">name</span>=<span className="text-green-300">&quot;your_feature_group&quot;</span>,
                          {'\n    '}
                          <span className="text-orange-300">version</span>=<span className="text-purple-300">1</span>
                          {'\n'}
                          )
                          {'\n\n'}
                          <span className="text-gray-500"># Read data from the feature group</span>
                          {'\n'}
                          <span className="text-blue-300">df</span> = <span className="text-blue-300">fg</span>.<span className="text-yellow-300">read</span>()
                          {'\n'}
                          <span className="text-purple-400">print</span>(<span className="text-purple-400">f</span><span className="text-green-300">&quot;Connected to {'{project.name}'}. Feature group has {'{len(df)}'} rows&quot;</span>)
                          {'\n\n'}
                          <span className="text-gray-500"># For model serving</span>
                          {'\n'}
                          <span className="text-blue-300">ms</span> = <span className="text-blue-300">project</span>.<span className="text-yellow-300">get_model_serving</span>()
                          {'\n\n'}
                          <span className="text-gray-500"># For model registry</span>
                          {'\n'}
                          <span className="text-blue-300">mr</span> = <span className="text-blue-300">project</span>.<span className="text-yellow-300">get_model_registry</span>()
                        </code>
                      </pre>
                    </div>
                  </Card>

                </>
              ) : (
                <div>
                  {/* Empty state - ClusterAccessStatus component above already shows the setup message */}
                </div>
              )}
            </TabsContent>

            <TabsContent value="team">
              <div className="space-y-6">
                {teamLoading ? (
                  <>
                    <CardSkeleton rows={4} />
                    <CardSkeleton rows={3} />
                  </>
                ) : teamData?.is_owner ? (
                  <>
                    {/* Team Members Card */}
                    <Card className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <Users size={20} className="text-primary" />
                        <h2 className="text-lg font-semibold">Team Members</h2>
                        <Badge variant="secondary">{(teamData.team_members?.length || 0) + 1}</Badge>
                      </div>

                      <div className="flex flex-col gap-3">
                        {/* Account Owner */}
                        <Card variant="muted" className="p-4">
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{teamData.account_owner.name || teamData.account_owner.email}</span>
                                <Badge variant="default">Owner</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{teamData.account_owner.email}</p>
                            </div>
                          </div>
                        </Card>

                        {/* Team Members */}
                        {teamData.team_members?.map((member) => (
                          <Card key={member.id} variant="muted" className="p-4">
                            <div>
                              <div className="flex justify-between items-center">
                                <div>
                                  <p className="font-medium">{member.name || member.email}</p>
                                  {member.name && member.name !== member.email && (
                                    <p className="text-sm text-muted-foreground">{member.email}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  {member.last_login_at && (
                                    <span className="text-xs text-muted-foreground">
                                      Last login: {new Date(member.last_login_at).toLocaleDateString()}
                                    </span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => handleRemoveMember(member.id)}
                                    aria-label="Remove member"
                                  >
                                    <Trash2 size={16} className="text-destructive" />
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-4">
                                <TeamMemberProjects
                                  memberId={member.id}
                                  memberEmail={member.email}
                                  memberName={member.name || member.email}
                                  hopsworksUsername={member.hopsworks_username}
                                  projects={member.project_member_roles}
                                />
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>

                      <div className="mt-4">
                        <Button onClick={() => setShowInviteModal(true)}>
                          Invite Member
                        </Button>
                      </div>
                    </Card>

                    {/* Pending Invites */}
                    {invites.length > 0 && (
                      <Card className="p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <Mail size={20} className="text-primary" />
                          <h2 className="text-lg font-semibold">Pending Invites</h2>
                          <Badge variant="secondary">{invites.length}</Badge>
                        </div>

                        <div className="flex flex-col gap-3">
                          {invites.map((invite) => {
                            const expiresAt = new Date(invite.expires_at);
                            const isExpired = expiresAt < new Date();

                            return (
                              <Card key={invite.id} variant="muted" className="p-4">
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="font-medium">{invite.email}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Clock size={12} className="text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground">
                                        {isExpired ? 'Expired' : `Expires ${expiresAt.toLocaleDateString()}`}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => copyInviteLink(invite.token)}
                                      disabled={isExpired}
                                      aria-label="Copy invite link"
                                    >
                                      <Copy size={16} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => handleCancelInvite(invite.id)}
                                      aria-label="Cancel invite"
                                    >
                                      <Trash2 size={16} className="text-destructive" />
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      </Card>
                    )}
                  </>
                ) : (
                  <>
                    {/* Team Member View */}
                    <StatusBox
                      tone="info"
                      icon={<Users size={20} className="text-quartz-label-blue mt-0.5" />}
                    >
                      <p className="text-sm">
                        You are part of <strong>{teamData?.account_owner.email}</strong>&apos;s team.
                        Your usage is billed to the account owner.
                      </p>
                    </StatusBox>

                    {/* Show team member's own projects */}
                    <Card className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <FolderOpen size={20} className="text-primary" />
                        <h2 className="text-lg font-semibold">My Project Access</h2>
                      </div>
                      <TeamMemberProjects
                        memberId={user?.sub || ''}
                        memberEmail={user?.email || ''}
                        memberName={user?.name || user?.email || ''}
                        hopsworksUsername={teamData?.team_members.find(m => m.id === user?.sub)?.hopsworks_username}
                      />
                    </Card>

                    {/* Other Team Members */}
                    {teamData?.team_members && teamData.team_members.length > 0 && (
                      <Card className="p-6">
                        <div className="flex items-center gap-3 mb-4">
                          <Users size={20} className="text-primary" />
                          <h2 className="text-lg font-semibold">Team Members</h2>
                        </div>

                        <div className="flex flex-col gap-3">
                          {/* Owner */}
                          <Card variant="muted" className="p-4">
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{teamData.account_owner.name || teamData.account_owner.email}</span>
                                  <Badge variant="default">Owner</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{teamData.account_owner.email}</p>
                              </div>
                            </div>
                          </Card>

                          {/* Other Members */}
                          {teamData.team_members.map((member) => (
                            <Card key={member.id} variant="muted" className="p-4">
                              <div>
                                <p className="font-medium">{member.name || member.email}</p>
                                <p className="text-sm text-muted-foreground">{member.email}</p>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="billing">
              {billingLoading ? (
                <div className="space-y-6">
                  <CardSkeleton rows={4} className="border-primary border-2" />
                  <CardSkeleton rows={3} />
                  <CardSkeleton rows={5} />
                  <CardSkeleton rows={2} />
                </div>
              ) : billing ? (
                <>
                  {/* Team member billing notice */}
                  {billing.isTeamMember ? (
                    <StatusBox
                      tone="info"
                      icon={<Users size={20} className="text-quartz-label-blue mt-0.5" />}
                    >
                      <p className="text-sm">
                        Your usage is billed to <strong>{billing.accountOwner?.name || billing.accountOwner?.email}</strong>.
                        Contact your account owner for billing information.
                      </p>
                    </StatusBox>
                  ) : (
                    <>
                      {/* Period Total Summary */}
                      {billing.historicalUsage && billing.historicalUsage.length > 0 && (
                        <Card className="p-6 mb-6 border-primary border-2">
                          <div className="flex justify-between items-center">
                            <div>
                              <h2 className="text-2xl font-semibold">Total</h2>
                              <p className="text-sm text-muted-foreground">
                                {selectedMonth === 'current' ? 'Last 30 days' :
                                  new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                              </p>
                            </div>
                            <span className="text-3xl font-bold text-primary">
                              ${billing.historicalUsage.reduce((sum, day) => sum + day.total_cost, 0).toFixed(2)}
                            </span>
                          </div>
                        </Card>
                      )}

                      {/* Low balance warnings */}
                      {!billing.hasPaymentMethod && billing.billingMode === 'postpaid' && (
                        <StatusBox
                          tone="warning"
                          icon={<AlertTriangle size={20} className="text-quartz-label-orange mt-0.5" />}
                          className="mb-6"
                        >
                          <h3 className="text-sm font-semibold">Add Payment Method Required</h3>
                          <p className="text-xs opacity-80 mt-1">
                            Add a credit card to start using Hopsworks resources
                          </p>
                        </StatusBox>
                      )}

                      {billing.billingMode === 'prepaid' && billing.creditBalance && billing.creditBalance.total < 10 && (
                        <StatusBox
                          tone="warning"
                          icon={<AlertTriangle size={20} className="text-quartz-label-orange mt-0.5" />}
                          className="mb-6"
                        >
                          <h3 className="text-sm font-semibold">Low Credit Balance</h3>
                          <p className="text-xs opacity-80 mt-1">
                            Your credit balance is running low. Purchase more credits to avoid service interruption.
                          </p>
                        </StatusBox>
                      )}

                      {/* Current Month Usage */}
                      <Card className="p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                          <Activity size={20} className="text-primary" />
                          <h2 className="text-lg font-semibold">Current Month Usage</h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div>
                            <p className="text-sm text-muted-foreground">Compute</p>
                            <p className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.computeCost.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              CPU: {billing.currentUsage.cpuHours}h
                              {parseFloat(billing.currentUsage.gpuHours) > 0 && ` | GPU: ${billing.currentUsage.gpuHours}h`}
                              {parseFloat(billing.currentUsage.ramGbHours) > 0 && ` | RAM: ${parseFloat(billing.currentUsage.ramGbHours).toFixed(0)}GB·h`}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Storage</p>
                            <p className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.storageCost.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Online: {billing.currentUsage.onlineStorageGB || '0.00GB'} | Offline: {billing.currentUsage.offlineStorageGB || '0.00GB'}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Month Total</p>
                            <p className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.total.toFixed(2)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {billing.billingMode === 'prepaid' ? 'This month' : 'Estimated'}
                            </p>
                          </div>
                        </div>

                        {/* Usage collection info */}
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-xs text-muted-foreground">
                            Last update: {usage?.lastUpdate ? new Date(usage.lastUpdate).toLocaleTimeString() : 'Never'}
                          </p>
                        </div>
                      </Card>

                      {/* Spending Cap */}
                      <Card className="p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                          <AlertTriangle size={20} className="text-primary" />
                          <h2 className="text-lg font-semibold">Spending Cap</h2>
                          <Badge variant={spendingCapEnabled ? 'success' : 'secondary'}>
                            {spendingCapEnabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>

                        <p className="text-sm text-muted-foreground mb-4">
                          Set a monthly spending cap to receive alerts at 80%, 90%, and 100% of your limit.
                          This is a soft cap - your services will continue running.
                        </p>

                        {/* Progress bar when cap is enabled */}
                        {spendingCapEnabled && billing.spendingCap && (
                          <div className="mb-4">
                            <div className="flex justify-between mb-2">
                              <span className="text-sm text-muted-foreground">
                                ${billing.currentUsage.currentMonth.total.toFixed(2)} of ${billing.spendingCap.toFixed(2)}
                              </span>
                              <span className={cn(
                                'text-sm font-medium',
                                (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 1
                                  ? 'text-destructive'
                                  : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.9
                                    ? 'text-quartz-label-orange'
                                    : 'text-primary',
                              )}>
                                {Math.round((billing.currentUsage.currentMonth.total / billing.spendingCap) * 100)}%
                              </span>
                            </div>
                            {/* Progress bar with threshold markers */}
                            <div className="relative">
                              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                                <div
                                  className={cn(
                                    'h-3 rounded-full transition-all',
                                    (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 1
                                      ? 'bg-destructive'
                                      : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.9
                                        ? 'bg-quartz-label-orange'
                                        : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.8
                                          ? 'bg-quartz-label-yellow'
                                          : 'bg-primary',
                                  )}
                                  style={{ width: `${Math.min(100, (billing.currentUsage.currentMonth.total / billing.spendingCap) * 100)}%` }}
                                />
                              </div>
                              {/* Threshold markers at 80% and 90% */}
                              <div className="absolute top-0 left-[80%] w-px h-3 bg-quartz-gray/50" />
                              <div className="absolute top-0 left-[90%] w-px h-3 bg-quartz-gray/50" />
                              {/* Labels */}
                              <span className="absolute -bottom-5 left-0 text-xs text-muted-foreground">$0</span>
                              <span className="absolute -bottom-5 left-[80%] -translate-x-1/2 text-xs text-muted-foreground">80%</span>
                              <span className="absolute -bottom-5 left-[90%] -translate-x-1/2 text-xs text-muted-foreground">90%</span>
                              <span className="absolute -bottom-5 right-0 text-xs text-muted-foreground">${billing.spendingCap.toFixed(0)}</span>
                            </div>
                            {/* Spacer for labels */}
                            <div className="h-5" />
                          </div>
                        )}

                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Checkbox
                                id="spending-cap-enabled"
                                checked={spendingCapEnabled}
                                onCheckedChange={(checked) => {
                                  const next = checked === true;
                                  setSpendingCapEnabled(next);
                                  if (!next) {
                                    setSpendingCapInput('');
                                  }
                                }}
                              />
                              <Label htmlFor="spending-cap-enabled" className="text-sm font-medium">
                                Enable monthly spending cap (USD)
                              </Label>
                            </div>
                            {spendingCapEnabled && (
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-medium text-muted-foreground">$</span>
                                <Input
                                  type="number"
                                  value={spendingCapInput}
                                  onChange={(e) => setSpendingCapInput(e.target.value)}
                                  placeholder="e.g. 100"
                                  min="1"
                                  step="1"
                                />
                              </div>
                            )}
                          </div>
                          <Button
                            onClick={handleSaveSpendingCap}
                            disabled={savingSpendingCap || (spendingCapEnabled && (!spendingCapInput || parseFloat(spendingCapInput) <= 0))}
                            loading={savingSpendingCap}
                          >
                            {savingSpendingCap ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                      </Card>

                      {/* Usage Trend Chart */}
                      {billing.historicalUsage && billing.historicalUsage.length > 0 && (
                        <Card className="p-6 mb-6">
                          <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-3">
                              <TrendingUp size={20} className="text-primary" />
                              <h2 className="text-lg font-semibold">Usage Trend</h2>
                            </div>
                            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Select period" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="current">Last 30 days</SelectItem>
                                {Array.from({ length: 6 }, (_, i) => {
                                  const date = new Date();
                                  date.setMonth(date.getMonth() - i);
                                  const value = date.toISOString().slice(0, 7);
                                  const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                  return <SelectItem key={value} value={value}>{label}</SelectItem>;
                                })}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={billing.historicalUsage.map(day => ({
                                  date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                  cost: day.total_cost,
                                  cpu: day.cpu_hours,
                                  storage: day.storage_gb
                                }))}
                                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                              >
                                <defs>
                                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#1eb182" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#1eb182" stopOpacity={0.1}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis
                                  dataKey="date"
                                  tick={{ fontSize: 12 }}
                                  stroke="#6b7280"
                                />
                                <YAxis
                                  tick={{ fontSize: 12 }}
                                  stroke="#6b7280"
                                  tickFormatter={(value) => `$${value}`}
                                />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    fontSize: '12px'
                                  }}
                                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Daily Cost']}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="cost"
                                  stroke="#1eb182"
                                  fillOpacity={1}
                                  fill="url(#colorCost)"
                                  strokeWidth={2}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="flex gap-4 mt-4">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-primary rounded-full" />
                              <span className="text-xs text-muted-foreground">Daily Cost</span>
                            </div>
                          </div>
                        </Card>
                      )}


                      {/* Removed credit balance UI - prepaid uses invoicing, not credits */}

                      {/* Payment Method */}
                      <Card className="p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                          <CreditCard size={20} className="text-primary" />
                          <h2 className="text-lg font-semibold">Payment Method</h2>
                        </div>

                        {billing.hasPaymentMethod ? (
                          <div className="space-y-3">
                            {billing.paymentMethodDetails?.card && (
                              <Card variant="muted" className="p-4">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                    <CreditCard size={18} className="text-muted-foreground" />
                                    <div>
                                      <p className="text-sm font-medium capitalize">
                                        {billing.paymentMethodDetails.card.brand} •••• {billing.paymentMethodDetails.card.last4}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        Expires {String(billing.paymentMethodDetails.card.expMonth).padStart(2, '0')}/{billing.paymentMethodDetails.card.expYear}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge variant="success">Active</Badge>
                                </div>
                              </Card>
                            )}
                            {!billing.paymentMethodDetails && (
                              <p className="text-sm text-muted-foreground">Payment method on file</p>
                            )}
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  const response = await fetch('/api/billing/setup-payment', {
                                    method: 'POST'
                                  });
                                  const data = await response.json();
                                  if (data.portalUrl) {
                                    window.open(data.portalUrl, '_blank');
                                  }
                                } catch (error) {
                                  console.error('Failed to open billing portal:', error);
                                  toast.error('Failed to open billing portal. Please try again.');
                                }
                              }}
                            >
                              <ExternalLink size={16} />
                              Manage Payment Methods
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">No payment methods added yet.</p>
                            <Button
                              onClick={async () => {
                                try {
                                  const response = await fetch('/api/billing/setup-payment', {
                                    method: 'POST'
                                  });
                                  const data = await response.json();
                                  if (data.checkoutUrl) {
                                    window.location.href = data.checkoutUrl;
                                  } else if (data.portalUrl) {
                                    window.location.href = data.portalUrl;
                                  }
                                } catch (error) {
                                  console.error('Failed to set up payment:', error);
                                  toast.error('Failed to set up payment. Please try again.');
                                }
                              }}
                            >
                              Add Payment Method
                            </Button>
                          </div>
                        )}
                      </Card>

                      {/* Invoices */}
                      {billing.hasPaymentMethod && (
                        <Card className="p-6 mb-6">
                          <div className="flex items-center gap-3 mb-4">
                            <Calendar size={20} className="text-primary" />
                            <h2 className="text-lg font-semibold">Recent Invoices</h2>
                          </div>

                          {billing.invoices && billing.invoices.length > 0 ? (
                            <>
                              <div className="space-y-2">
                                {billing.invoices.slice(0, 5).map(invoice => {
                                  const statusVariant: 'success' | 'notice' | 'secondary' | 'fail' =
                                    invoice.status === 'paid' ? 'success' :
                                    invoice.status === 'open' ? 'notice' :
                                    invoice.status === 'draft' ? 'secondary' :
                                    invoice.status === 'void' ? 'fail' : 'secondary';

                                  return (
                                    <div key={invoice.id} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                                      <div>
                                        {invoice.invoice_url ? (
                                          <a
                                            href={invoice.invoice_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-quartz-label-blue hover:underline"
                                          >
                                            {invoice.invoice_number || 'View Invoice'}
                                          </a>
                                        ) : (
                                          <p className="text-sm font-medium">{invoice.invoice_number || invoice.id}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                          {new Date(invoice.created_at).toLocaleDateString()}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium">
                                          ${(invoice.total ?? invoice.amount ?? 0).toFixed(2)}
                                        </span>
                                        <Badge variant={statusVariant}>
                                          {invoice.status || 'Unknown'}
                                        </Badge>
                                        {invoice.pdf_url && (
                                          <a
                                            href={invoice.pdf_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                            title="Download PDF"
                                          >
                                            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17h6M9 13h6M9 9h4" />
                                            </svg>
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <Button
                                variant="ghost"
                                className="mt-3"
                                onClick={async () => {
                                  try {
                                    const response = await fetch('/api/billing/setup-payment', {
                                      method: 'POST'
                                    });
                                    const data = await response.json();
                                    if (data.portalUrl) {
                                      window.open(data.portalUrl, '_blank');
                                    }
                                  } catch (error) {
                                    console.error('Failed to open billing portal:', error);
                                    toast.error('Failed to open billing portal. Please try again.');
                                  }
                                }}
                              >
                                <ExternalLink size={16} />
                                View All Invoices
                              </Button>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">No invoices yet</p>
                          )}
                        </Card>
                      )}

                      {/* Pricing Info */}
                      <Card className="p-6">
                        <h2 className="text-lg font-semibold mb-3">Pay-As-You-Go Pricing</h2>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Hops Credits</span>
                            <span className="font-medium">${pricing.compute_credits.toFixed(2)} / credit</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Online Storage</span>
                            <span className="font-medium">${pricing.storage_online_gb.toFixed(2)} / GB-month</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Offline Storage</span>
                            <span className="font-medium">${pricing.storage_offline_gb.toFixed(3)} / GB-month</span>
                          </div>
                        </div>
                      </Card>
                    </>
                  )}
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="settings">
              <Card className="p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Account Information</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{user.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">User ID</p>
                    <p className="text-xs font-mono">{user.sub}</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Trash2 size={20} className="text-destructive" />
                  <h2 className="text-lg font-semibold">Danger Zone</h2>
                </div>
                {billing?.isTeamMember ? (
                  <div className="p-4 bg-muted border border-border rounded">
                    <p className="text-sm text-foreground">
                      Team members cannot self-delete. Contact your account owner ({teamData?.account_owner?.email}) to be removed from the team.
                    </p>
                  </div>
                ) : teamData?.team_members && teamData.team_members.length > 0 ? (
                  <div className="p-4 bg-muted border border-border rounded">
                    <p className="text-sm text-foreground">
                      Cannot delete account with active team members. Remove all team members first.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      Delete your account and revoke access to all resources. Billing data will be retained for compliance.
                    </p>
                    <Button
                      variant="destructive"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      Delete Account
                    </Button>
                  </>
                )}
              </Card>

              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  onClick={() => signOut()}
                >
                  Sign Out
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </Layout>

      {/* Invite Modal */}
      <Dialog
        open={showInviteModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowInviteModal(false);
            setInviteEmail('');
            setInviteRole('Data scientist');
            setAutoAssignProjects(true);
            setInviteError('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Invite a new member to join your team. They&apos;ll have access to Hopsworks
              and their usage will be billed to your account.
            </p>

            <div>
              <Label htmlFor="invite-email" className="text-sm font-medium mb-2 block">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                disabled={inviteLoading}
                intent={inviteError ? 'error' : 'default'}
              />
              {inviteError && (
                <p className="text-xs text-destructive mt-1">{inviteError}</p>
              )}
            </div>

            <div>
              <Label htmlFor="invite-role" className="text-sm font-medium mb-2 block">Default Project Role</Label>
              <Select
                value={inviteRole}
                onValueChange={setInviteRole}
                disabled={inviteLoading}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Data scientist">Data scientist</SelectItem>
                  <SelectItem value="Data owner">Data owner</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Role they&apos;ll have when added to your projects
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-assign-projects"
                checked={autoAssignProjects}
                onCheckedChange={(checked) => setAutoAssignProjects(checked === true)}
                disabled={inviteLoading}
              />
              <Label htmlFor="auto-assign-projects" className="text-sm">
                Automatically add to all my existing projects
              </Label>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail('');
                  setInviteRole('Data scientist');
                  setAutoAssignProjects(true);
                  setInviteError('');
                }}
                disabled={inviteLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInvite}
                disabled={!inviteEmail || inviteLoading}
                loading={inviteLoading}
              >
                {inviteLoading ? 'Sending...' : 'Send Invite'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Team Member Modal */}
      <Dialog
        open={showRemoveModal}
        onOpenChange={(open) => {
          if (!open && !removingMember) {
            setShowRemoveModal(false);
            setRemovingMemberId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <StatusBox
              tone="warning"
              icon={<AlertTriangle size={20} className="text-quartz-label-orange flex-shrink-0 mt-0.5" />}
            >
              <p className="text-sm font-medium mb-2">
                Manual action required in Hopsworks
              </p>
              <p className="text-sm">
                This will remove the team member from your SaaS account, but you must manually remove them from your Hopsworks projects.
              </p>
            </StatusBox>

            <div>
              <p className="text-sm text-foreground mb-2">
                After removing this member:
              </p>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 ml-2">
                <li>Go to your Hopsworks cluster</li>
                <li>Open each project they have access to</li>
                <li>Navigate to Settings &rarr; Members</li>
                <li>Remove the user from the project</li>
              </ol>
            </div>

            <p className="text-sm text-muted-foreground">
              The user will be converted to a standalone account and can create their own billing.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRemoveModal(false);
                  setRemovingMemberId(null);
                }}
                disabled={removingMember}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmRemoveMember}
                loading={removingMember}
              >
                Remove Member
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Account Modal */}
      <Dialog
        open={showDeleteModal}
        onOpenChange={(open) => {
          if (!open && !deletingAccount) {
            setShowDeleteModal(false);
            setDeleteReason('');
          }
        }}
      >
        <DialogContent variant="destructive" className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <StatusBox
              tone="error"
              icon={<AlertTriangle size={20} className="text-destructive flex-shrink-0 mt-0.5" />}
            >
              <p className="text-sm font-medium mb-2">
                This will immediately revoke access to all resources
              </p>
              <p className="text-sm">
                You will be logged out and unable to access your cluster or projects.
              </p>
            </StatusBox>

            <div>
              <Label htmlFor="delete-reason" className="text-sm font-medium mb-2 block">
                Why are you deleting your account? (optional)
              </Label>
              <textarea
                id="delete-reason"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Help us improve by sharing your reason..."
                className="w-full p-3 border border-input bg-muted rounded text-sm resize-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none disabled:opacity-50"
                rows={3}
                disabled={deletingAccount}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteReason('');
                }}
                disabled={deletingAccount}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deletingAccount}
                loading={deletingAccount}
                onClick={async () => {
                  setDeletingAccount(true);

                  // Track account deletion
                  posthog.capture('account_deleted', {
                    reason: deleteReason || 'not_provided',
                    billingMode: billing?.billingMode,
                    hadPaymentMethod: billing?.hasPaymentMethod,
                  });

                  try {
                    const response = await fetch('/api/account/delete', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ reason: deleteReason || undefined })
                    });

                    if (response.ok) {
                      await signOut();
                    } else {
                      const data = await response.json();
                      toast.error(data.error || 'Failed to delete account. Please try again.');
                      setDeletingAccount(false);
                    }
                  } catch (error) {
                    toast.error('Failed to delete account. Please try again.');
                    setDeletingAccount(false);
                  }
                }}
              >
                {deletingAccount ? 'Deleting...' : 'Delete Account'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Downgrade Warning Modal - blocking for free users with too many projects */}
      <Dialog
        open={showDowngradeModal}
        onOpenChange={() => {
          // Blocking modal: cannot be dismissed by user. Resolution requires
          // deleting projects or upgrading to a paid plan.
        }}
      >
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Action Required</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <StatusBox
              tone="warning"
              icon={<AlertTriangle size={20} className="text-quartz-label-orange flex-shrink-0 mt-0.5" />}
            >
              <p className="text-sm font-medium mb-2">
                Your account is now on the Free plan
              </p>
              <p className="text-sm">
                Free plan includes <strong>1 project only</strong>. You currently have{' '}
                <strong>{hopsworksInfo?.projects?.length || 0} projects</strong>.
              </p>
            </StatusBox>

            {billing?.downgradeDeadline && (
              <div className="p-3 bg-muted rounded border border-border">
                <p className="text-sm text-foreground">
                  <strong>Deadline:</strong>{' '}
                  {new Date(billing.downgradeDeadline).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Delete {(hopsworksInfo?.projects?.length || 0) - 1} project(s) by this date or your account will be suspended.
                </p>
              </div>
            )}

            <div>
              <p className="text-sm font-medium mb-3">Your projects:</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {hopsworksInfo?.projects?.map((project) => (
                  <div key={project.id} className="flex justify-between items-center p-2 bg-muted rounded border border-border">
                    <span className="text-sm font-mono">{project.name}</span>
                    <a
                      href={`${instance?.endpoint?.replace('/hopsworks-api', '')}/p/${project.id}/settings/general`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-destructive hover:underline"
                    >
                      Delete project
                    </a>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-3"
                onClick={async () => {
                  await refetchHopsworksInfo();
                  await refetchBilling();
                }}
                disabled={hopsworksLoading}
                loading={hopsworksLoading}
              >
                <RefreshCw size={14} />
                I&apos;ve deleted a project - Refresh
              </Button>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground mb-3">
                <strong>Alternatively</strong>, add a payment method to upgrade to Pay-as-you-go (5 projects included):
              </p>
              <Button
                className="w-full"
                onClick={handleUpgradeToPostpaid}
                disabled={upgradingToPostpaid}
                loading={upgradingToPostpaid}
              >
                <CreditCard size={16} />
                Add Payment Method
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
