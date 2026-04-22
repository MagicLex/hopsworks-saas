import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '@/contexts/AuthContext';
import { useBilling, BillingInfo } from '@/contexts/BillingContext';
import { useApiData } from '@/hooks/useApiData';
import { Box, Flex, Title, Text, Button, Card, Badge, Tabs, TabsContent, TabsList, TabsTrigger, Modal, Input, Select, IconLabel, StatusMessage } from 'tailwind-quartz';
import { CreditCard, Trash2, Server, LogOut, Database, Activity, Cpu, Users, Copy, ExternalLink, CheckCircle, UserPlus, Mail, Download, Calendar, AlertTriangle, TrendingUp, Clock, FolderOpen, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import ClusterAccessStatus from '@/components/ClusterAccessStatus';
import TeamMemberProjects from '@/components/team/TeamMemberProjects';
import CardSkeleton from '@/components/CardSkeleton';
import { DEFAULT_RATES } from '@/config/billing-rates';
import { usePricing } from '@/contexts/PricingContext';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
      alert(error.message || 'Failed to save spending cap');
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

  const handleRemoveMember = async (memberId: string) => {
    setRemovingMemberId(memberId);
    setShowRemoveModal(true);
  };

  const confirmRemoveMember = async () => {
    if (!removingMemberId) return;

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
      alert('Failed to remove team member. Please try again.');
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
    alert('Invite link copied to clipboard!');
  };

  if (authLoading) {
    return (
      <Box className="min-h-screen flex items-center justify-center">
        <Text>Loading...</Text>
      </Box>
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
        <Box className="max-w-6xl mx-auto">
          {/* Team Member Banner */}
          {billing?.isTeamMember && (
            <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
              <Flex align="center" gap={12}>
                <Users size={20} className="text-blue-600" />
                <Box className="flex-1">
                  <Text className="text-sm text-blue-800">
                    You are part of <strong>{billing.accountOwner?.name || billing.accountOwner?.email}</strong>&apos;s team.
                    Your usage is billed to the account owner.
                  </Text>
                </Box>
              </Flex>
            </Card>
          )}

          {/* API Error Banner */}
          {apiError && (
            <Card className="p-4 mb-6 border-yellow-200 bg-yellow-50">
              <Flex align="center" gap={12}>
                <AlertTriangle size={20} className="text-yellow-600" />
                <Box className="flex-1">
                  <Text className="text-sm text-yellow-800">
                    Some data could not be loaded. Please refresh the page. If the problem persists, contact support.
                  </Text>
                </Box>
              </Flex>
            </Card>
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
              <Box className="mb-6">
                <ClusterAccessStatus
                  hasCluster={hopsworksInfo?.hasCluster || false}
                  hasPaymentMethod={billing?.hasPaymentMethod || false}
                  billingMode={billing?.billingMode ?? undefined}
                  clusterName={hopsworksInfo?.clusterName}
                  loading={hopsworksLoading || billingLoading || !billing || !hopsworksInfo}
                  reloadProgress={reloadProgress}
                  isTeamMember={billing?.isTeamMember}
                />
              </Box>

              {/* Free tier upsell banner */}
              {billing?.billingMode === 'free' && hopsworksInfo?.hasCluster && (
                <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
                  <Flex align="center" gap={12}>
                    <TrendingUp size={20} className="text-blue-600" />
                    <Box className="flex-1">
                      <Text className="text-sm text-blue-800">
                        <strong>Free plan:</strong> 1 project limit.{' '}
                        <button
                          onClick={handleUpgradeToPostpaid}
                          disabled={upgradingToPostpaid}
                          className="underline hover:text-blue-900 disabled:opacity-50"
                        >
                          {upgradingToPostpaid ? 'Upgrading...' : (billing?.hasPaymentMethod ? 'Upgrade to Pay-as-you-go' : 'Add a payment method')}
                        </button>{' '}
                        to unlock 5 projects and remove quotas.
                      </Text>
                    </Box>
                  </Flex>
                </Card>
              )}

              {instance && instance.endpoint ? (
                <>
                  {/* Usage Metrics - moved to top */}
                  <Box className="mb-6">
                    <Title as="h2" className="text-lg mb-4">Current Usage</Title>
                    <Flex gap={16} className="grid grid-cols-1 md:grid-cols-3">
                      {billingLoading ? (
                        <CardSkeleton rows={2} showIcon={false} />
                      ) : (
                        <Card className="p-4">
                          <IconLabel icon={<CreditCard size={16} className="text-[#1eb182]" />} gap={8} className="mb-2">
                            <Text className="text-sm text-gray-600">This Month</Text>
                          </IconLabel>
                          <Text className="text-xl font-semibold">
                            ${billing?.currentUsage?.currentMonth?.total?.toFixed(2) || '0.00'}
                          </Text>
                          {billing?.spendingCap ? (
                            <Text className="text-xs text-gray-500">of ${billing.spendingCap} cap</Text>
                          ) : (
                            <Text className="text-xs text-gray-500">No spending cap</Text>
                          )}
                        </Card>
                      )}
                      {hopsworksLoading ? (
                        <CardSkeleton rows={2} showIcon={false} className="md:col-span-2" />
                      ) : hopsworksInfo?.hasHopsworksUser ? (
                        <Card className="p-4 md:col-span-2">
                          <IconLabel icon={<Database size={16} className="text-[#1eb182]" />} gap={8} className="mb-2">
                            <Text className="text-sm text-gray-600">Projects</Text>
                          </IconLabel>
                          <Text className="text-xl font-semibold">
                            {hopsworksInfo?.projects?.length || '0'}
                          </Text>
                          <Text className="text-xs text-gray-500">Active projects</Text>
                          {
                            <Box className="mt-3 pt-3 border-t border-gray-100">
                              {hopsworksInfo?.projects && hopsworksInfo.projects.length > 0 ? (
                                <Flex gap={6} className="flex-wrap">
                                  {hopsworksInfo.projects.slice(0, 3).map(project => (
                                    <a
                                      key={project.id}
                                      href={`${instance?.endpoint || hopsworksInfo?.clusterEndpoint || ''}/p/${project.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1eb182]/10 hover:bg-[#1eb182]/20 text-[#1eb182] rounded-full text-sm font-medium transition-colors"
                                    >
                                      <FolderOpen size={14} />
                                      <span>{project.name}</span>
                                      <ExternalLink size={12} />
                                    </a>
                                  ))}
                                  {hopsworksInfo.projects.length > 3 && (
                                    <span className="inline-flex items-center px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full text-sm">
                                      +{hopsworksInfo.projects.length - 3} more
                                    </span>
                                  )}
                                </Flex>
                              ) : (
                                <Text className="text-xs text-gray-500">No projects yet</Text>
                              )}
                            </Box>
                          }
                        </Card>
                      ) : null}
                    </Flex>
                  </Box>

                  {instanceLoading ? (
                    <CardSkeleton rows={4} className="mb-6" />
                  ) : (
                    <Card className="p-6 mb-6">
                      <Flex align="center" gap={12} className="mb-4">
                        <Server size={20} className="text-[#1eb182]" />
                        <Title as="h2" className="text-lg">Your Hopsworks Instance</Title>
                        <Badge variant={instance.status === 'active' ? 'success' : 'default'}>
                          {instance.status || 'Unknown'}
                        </Badge>
                      </Flex>
                    
                    <Box className="space-y-3">
                      <Flex justify="between">
                        <Text className="text-sm text-gray-600">Instance Name</Text>
                        <Text className="text-sm font-medium">{instance.name}</Text>
                      </Flex>
                      
                      <Flex justify="between">
                        <Text className="text-sm text-gray-600">Plan</Text>
                        <Text className="text-sm font-medium">{instance.plan}</Text>
                      </Flex>
                      
                      {instance.created && (
                        <Flex justify="between">
                          <Text className="text-sm text-gray-600">Created</Text>
                          <Text className="text-sm font-medium">
                            {new Date(instance.created).toLocaleDateString()}
                          </Text>
                        </Flex>
                      )}
                      
                      <Box className="pt-3 border-t border-gray-100">
                        <Flex justify="between" align="center">
                          <Text className="text-sm text-gray-600">Endpoint</Text>
                          <Flex gap={8}>
                            <Text className="text-sm font-mono bg-gray-50 px-2 py-1 rounded">
                              {instance.endpoint}
                            </Text>
                            <Button
                              intent="ghost"
                              size="md"
                              className="p-1"
                              onClick={() => {
                                navigator.clipboard.writeText(instance.endpoint);
                                setCopied('endpoint');
                                setTimeout(() => setCopied(''), 2000);
                              }}
                            >
                              {copied === 'endpoint' ? <CheckCircle size={14} /> : <Copy size={14} />}
                            </Button>
                          </Flex>
                        </Flex>
                      </Box>
                    </Box>
                    
                    <Flex gap={12} className="mt-6">
                      <Button
                        intent={instance.endpoint ? "primary" : "secondary"}
                        size="md"
                        className="uppercase flex-1"
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
                    </Flex>
                    </Card>
                  )}
                  
                  {/* Quick Start Code */}
                  <Card className="p-6 mb-6">
                    <Title as="h3" className="text-lg mb-4">Quick Start - Connect from VS Code</Title>
                    
                    <Text className="text-sm text-gray-600 mb-4">
                      Connect to your Hopsworks cluster from VS Code, Jupyter notebooks, or any local environment:
                    </Text>

                    <Box className="relative">
                      <Button
                        intent="ghost"
                        size="sm"
                        className="absolute top-2 right-2 z-10"
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
                          <IconLabel icon={<CheckCircle size={14} className="text-green-500" />} gap={4}>
                            <Text className="text-xs text-white">Copied!</Text>
                          </IconLabel>
                        ) : (
                          <IconLabel icon={<Copy size={14} className="text-gray-300" />} gap={4}>
                            <Text className="text-xs text-white">Copy</Text>
                          </IconLabel>
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
                    </Box>
                  </Card>

                </>
              ) : (
                <Box>
                  {/* Empty state - ClusterAccessStatus component above already shows the setup message */}
                </Box>
              )}
            </TabsContent>

            <TabsContent value="team">
              <Box className="space-y-6">
                {teamLoading ? (
                  <>
                    <CardSkeleton rows={4} />
                    <CardSkeleton rows={3} />
                  </>
                ) : teamData?.is_owner ? (
                  <>
                    {/* Team Members Card */}
                    <Card className="p-6">
                      <Flex align="center" gap={12} className="mb-4">
                        <Users size={20} className="text-[#1eb182]" />
                        <Title as="h2" className="text-lg">Team Members</Title>
                        <Badge variant="default">{(teamData.team_members?.length || 0) + 1}</Badge>
                      </Flex>

                      <Flex direction="column" gap={12}>
                        {/* Account Owner */}
                        <Card variant="readOnly" className="p-4">
                          <Flex justify="between" align="center">
                            <Box>
                              <Flex align="center" gap={8}>
                                <Text className="font-medium">{teamData.account_owner.name || teamData.account_owner.email}</Text>
                                <Badge variant="primary" size="sm">Owner</Badge>
                              </Flex>
                              <Text className="text-sm text-gray-600">{teamData.account_owner.email}</Text>
                            </Box>
                          </Flex>
                        </Card>

                        {/* Team Members */}
                        {teamData.team_members?.map((member) => (
                          <Card key={member.id} variant="readOnly" className="p-4">
                            <Box>
                              <Flex justify="between" align="center">
                                <Box>
                                  <Text className="font-medium">{member.name || member.email}</Text>
                                  {member.name && member.name !== member.email && (
                                    <Text className="text-sm text-gray-600">{member.email}</Text>
                                  )}
                                </Box>
                                <Flex align="center" gap={12}>
                                  {member.last_login_at && (
                                    <Text className="text-xs text-gray-500">
                                      Last login: {new Date(member.last_login_at).toLocaleDateString()}
                                    </Text>
                                  )}
                                  <Button
                                    intent="ghost"
                                    size="md"
                                    onClick={() => handleRemoveMember(member.id)}
                                  >
                                    <Trash2 size={16} className="text-red-500" />
                                  </Button>
                                </Flex>
                              </Flex>
                              <Box className="mt-4">
                                <TeamMemberProjects
                                  memberId={member.id}
                                  memberEmail={member.email}
                                  memberName={member.name || member.email}
                                  hopsworksUsername={member.hopsworks_username}
                                  projects={member.project_member_roles}
                                />
                              </Box>
                            </Box>
                          </Card>
                        ))}
                      </Flex>

                      <Box className="mt-4">
                        <Button
                          intent="primary"
                          size="md"
                          onClick={() => setShowInviteModal(true)}
                        >
                          Invite Member
                        </Button>
                      </Box>
                    </Card>

                    {/* Pending Invites */}
                    {invites.length > 0 && (
                      <Card className="p-6">
                        <Flex align="center" gap={12} className="mb-4">
                          <Mail size={20} className="text-[#1eb182]" />
                          <Title as="h2" className="text-lg">Pending Invites</Title>
                          <Badge variant="default">{invites.length}</Badge>
                        </Flex>

                        <Flex direction="column" gap={12}>
                          {invites.map((invite) => {
                            const expiresAt = new Date(invite.expires_at);
                            const isExpired = expiresAt < new Date();
                            
                            return (
                              <Card key={invite.id} variant="readOnly" className="p-4">
                                <Flex justify="between" align="center">
                                  <Box>
                                    <Text className="font-medium">{invite.email}</Text>
                                    <Flex align="center" gap={8} className="mt-1">
                                      <Clock size={12} className="text-gray-500" />
                                      <Text className="text-xs text-gray-500">
                                        {isExpired ? 'Expired' : `Expires ${expiresAt.toLocaleDateString()}`}
                                      </Text>
                                    </Flex>
                                  </Box>
                                  <Flex align="center" gap={8}>
                                    <Button
                                      intent="ghost"
                                      size="md"
                                      onClick={() => copyInviteLink(invite.token)}
                                      disabled={isExpired}
                                    >
                                      <Copy size={16} />
                                    </Button>
                                    <Button
                                      intent="ghost"
                                      size="md"
                                      onClick={() => handleCancelInvite(invite.id)}
                                    >
                                      <Trash2 size={16} className="text-red-500" />
                                    </Button>
                                  </Flex>
                                </Flex>
                              </Card>
                            );
                          })}
                        </Flex>
                      </Card>
                    )}
                  </>
                ) : (
                  <>
                    {/* Team Member View */}
                    <Card className="p-6 border-blue-200 bg-blue-50">
                      <Text className="text-sm">
                        You are part of <strong>{teamData?.account_owner.email}</strong>&apos;s team. 
                        Your usage is billed to the account owner.
                      </Text>
                    </Card>
                    
                    {/* Show team member's own projects */}
                    <Card className="p-6">
                      <Flex align="center" gap={12} className="mb-4">
                        <FolderOpen size={20} className="text-[#1eb182]" />
                        <Title as="h2" className="text-lg">My Project Access</Title>
                      </Flex>
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
                        <Flex align="center" gap={12} className="mb-4">
                          <Users size={20} className="text-[#1eb182]" />
                          <Title as="h2" className="text-lg">Team Members</Title>
                        </Flex>
                        
                        <Flex direction="column" gap={12}>
                          {/* Owner */}
                          <Card variant="readOnly" className="p-4">
                            <Flex justify="between" align="center">
                              <Box>
                                <Flex align="center" gap={8}>
                                  <Text className="font-medium">{teamData.account_owner.name || teamData.account_owner.email}</Text>
                                  <Badge variant="primary" size="sm">Owner</Badge>
                                </Flex>
                                <Text className="text-sm text-gray-600">{teamData.account_owner.email}</Text>
                              </Box>
                            </Flex>
                          </Card>

                          {/* Other Members */}
                          {teamData.team_members.map((member) => (
                            <Card key={member.id} variant="readOnly" className="p-4">
                              <Box>
                                <Text className="font-medium">{member.name || member.email}</Text>
                                <Text className="text-sm text-gray-600">{member.email}</Text>
                              </Box>
                            </Card>
                          ))}
                        </Flex>
                      </Card>
                    )}
                  </>
                )}
              </Box>
            </TabsContent>

            <TabsContent value="billing">
              {billingLoading ? (
                <Box className="space-y-6">
                  <CardSkeleton rows={4} className="border-[#1eb182] border-2" />
                  <CardSkeleton rows={3} />
                  <CardSkeleton rows={5} />
                  <CardSkeleton rows={2} />
                </Box>
              ) : billing ? (
                <>
                  {/* Team member billing notice */}
                  {billing.isTeamMember ? (
                    <Card className="p-6 border-blue-200 bg-blue-50">
                      <Flex align="center" gap={12}>
                        <Users size={20} className="text-blue-600" />
                        <Box className="flex-1">
                          <Text className="text-sm text-blue-800">
                            Your usage is billed to <strong>{billing.accountOwner?.name || billing.accountOwner?.email}</strong>. 
                            Contact your account owner for billing information.
                          </Text>
                        </Box>
                      </Flex>
                    </Card>
                  ) : (
                    <>
                      {/* Period Total Summary */}
                      {billing.historicalUsage && billing.historicalUsage.length > 0 && (
                        <Card className="p-6 mb-6 border-[#1eb182] border-2">
                          <Flex justify="between" align="center">
                            <Box>
                              <Title as="h2" className="text-2xl">Total</Title>
                              <Text className="text-sm text-gray-600">
                                {selectedMonth === 'current' ? 'Last 30 days' : 
                                  new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                              </Text>
                            </Box>
                            <Text className="text-3xl font-bold text-[#1eb182]">
                              ${billing.historicalUsage.reduce((sum, day) => sum + day.total_cost, 0).toFixed(2)}
                            </Text>
                          </Flex>
                        </Card>
                      )}

                      {/* Low balance warnings */}
                      {!billing.hasPaymentMethod && billing.billingMode === 'postpaid' && (
                        <Card className="p-6 mb-6 border-yellow-500 bg-yellow-50">
                          <Flex align="center" gap={12}>
                            <AlertTriangle size={20} className="text-yellow-600" />
                            <Box>
                              <Title as="h3" className="text-sm">Add Payment Method Required</Title>
                              <Text className="text-xs text-gray-600">
                                Add a credit card to start using Hopsworks resources
                              </Text>
                            </Box>
                          </Flex>
                        </Card>
                      )}
                      
                      {billing.billingMode === 'prepaid' && billing.creditBalance && billing.creditBalance.total < 10 && (
                        <Card className="p-6 mb-6 border-yellow-500 bg-yellow-50">
                          <Flex align="center" gap={12}>
                            <AlertTriangle size={20} className="text-yellow-600" />
                            <Box>
                              <Title as="h3" className="text-sm">Low Credit Balance</Title>
                              <Text className="text-xs text-gray-600">
                                Your credit balance is running low. Purchase more credits to avoid service interruption.
                              </Text>
                            </Box>
                          </Flex>
                        </Card>
                      )}

                      {/* Current Month Usage */}
                      <Card className="p-6 mb-6">
                        <Flex align="center" gap={12} className="mb-4">
                          <Activity size={20} className="text-[#1eb182]" />
                          <Title as="h2" className="text-lg">Current Month Usage</Title>
                        </Flex>
                        
                        <Flex gap={16} className="grid grid-cols-1 md:grid-cols-3 mb-4">
                          <Box>
                            <Text className="text-sm text-gray-600">Compute</Text>
                            <Text className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.computeCost.toFixed(2)}
                            </Text>
                            <Text className="text-xs text-gray-500">
                              CPU: {billing.currentUsage.cpuHours}h
                              {parseFloat(billing.currentUsage.gpuHours) > 0 && ` | GPU: ${billing.currentUsage.gpuHours}h`}
                              {parseFloat(billing.currentUsage.ramGbHours) > 0 && ` | RAM: ${parseFloat(billing.currentUsage.ramGbHours).toFixed(0)}GB·h`}
                            </Text>
                          </Box>
                          <Box>
                            <Text className="text-sm text-gray-600">Storage</Text>
                            <Text className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.storageCost.toFixed(2)}
                            </Text>
                            <Text className="text-xs text-gray-500">
                              Online: {billing.currentUsage.onlineStorageGB || '0.00GB'} | Offline: {billing.currentUsage.offlineStorageGB || '0.00GB'}
                            </Text>
                          </Box>
                          <Box>
                            <Text className="text-sm text-gray-600">Month Total</Text>
                            <Text className="text-xl font-semibold">
                              ${billing.currentUsage.currentMonth.total.toFixed(2)}
                            </Text>
                            <Text className="text-sm text-gray-500">
                              {billing.billingMode === 'prepaid' ? 'This month' : 'Estimated'}
                            </Text>
                          </Box>
                        </Flex>
                        
                        {/* Usage collection info */}
                        <Box className="mt-3 pt-3 border-t border-gray-100">
                          <Text className="text-xs text-gray-500">
                            Last update: {usage?.lastUpdate ? new Date(usage.lastUpdate).toLocaleTimeString() : 'Never'}
                          </Text>
                        </Box>
                      </Card>

                      {/* Spending Cap */}
                      <Card className="p-6 mb-6">
                        <Flex align="center" gap={12} className="mb-4">
                          <AlertTriangle size={20} className="text-[#1eb182]" />
                          <Title as="h2" className="text-lg">Spending Cap</Title>
                          <Badge variant={spendingCapEnabled ? 'success' : 'default'} size="sm">
                            {spendingCapEnabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </Flex>

                        <Text className="text-sm text-gray-600 mb-4">
                          Set a monthly spending cap to receive alerts at 80%, 90%, and 100% of your limit.
                          This is a soft cap - your services will continue running.
                        </Text>

                        {/* Progress bar when cap is enabled */}
                        {spendingCapEnabled && billing.spendingCap && (
                          <Box className="mb-4">
                            <Flex justify="between" className="mb-2">
                              <Text className="text-sm text-gray-600">
                                ${billing.currentUsage.currentMonth.total.toFixed(2)} of ${billing.spendingCap.toFixed(2)}
                              </Text>
                              <Text className={`text-sm font-medium ${
                                (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 1
                                  ? 'text-red-600'
                                  : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.9
                                    ? 'text-orange-500'
                                    : 'text-[#1eb182]'
                              }`}>
                                {Math.round((billing.currentUsage.currentMonth.total / billing.spendingCap) * 100)}%
                              </Text>
                            </Flex>
                            {/* Progress bar with threshold markers */}
                            <Box className="relative">
                              <Box className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                <Box
                                  className={`h-3 rounded-full transition-all ${
                                    (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 1
                                      ? 'bg-red-500'
                                      : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.9
                                        ? 'bg-orange-500'
                                        : (billing.currentUsage.currentMonth.total / billing.spendingCap) >= 0.8
                                          ? 'bg-yellow-500'
                                          : 'bg-[#1eb182]'
                                  }`}
                                  style={{ width: `${Math.min(100, (billing.currentUsage.currentMonth.total / billing.spendingCap) * 100)}%` }}
                                />
                              </Box>
                              {/* Threshold markers at 80% and 90% */}
                              <Box className="absolute top-0 left-[80%] w-px h-3 bg-gray-400/50" />
                              <Box className="absolute top-0 left-[90%] w-px h-3 bg-gray-400/50" />
                              {/* Labels */}
                              <Text className="absolute -bottom-5 left-0 text-xs text-gray-400">$0</Text>
                              <Text className="absolute -bottom-5 left-[80%] -translate-x-1/2 text-xs text-gray-400">80%</Text>
                              <Text className="absolute -bottom-5 left-[90%] -translate-x-1/2 text-xs text-gray-400">90%</Text>
                              <Text className="absolute -bottom-5 right-0 text-xs text-gray-400">${billing.spendingCap.toFixed(0)}</Text>
                            </Box>
                            {/* Spacer for labels */}
                            <Box className="h-5" />
                          </Box>
                        )}

                        <Flex gap={12} align="end">
                          <Box className="flex-1">
                            <label className="flex items-center mb-2">
                              <input
                                type="checkbox"
                                checked={spendingCapEnabled}
                                onChange={(e) => {
                                  setSpendingCapEnabled(e.target.checked);
                                  if (!e.target.checked) {
                                    setSpendingCapInput('');
                                  }
                                }}
                                className="mr-2"
                              />
                              <Text className="text-sm font-medium">Enable monthly spending cap (USD)</Text>
                            </label>
                            {spendingCapEnabled && (
                              <Flex align="center" gap={8}>
                                <Text className="text-lg font-medium text-gray-500">$</Text>
                                <Input
                                  type="number"
                                  value={spendingCapInput}
                                  onChange={(e) => setSpendingCapInput(e.target.value)}
                                  placeholder="e.g. 100"
                                  min="1"
                                  step="1"
                                />
                              </Flex>
                            )}
                          </Box>
                          <Button
                            intent="primary"
                            size="md"
                            onClick={handleSaveSpendingCap}
                            disabled={savingSpendingCap || (spendingCapEnabled && (!spendingCapInput || parseFloat(spendingCapInput) <= 0))}
                          >
                            {savingSpendingCap ? 'Saving...' : 'Save'}
                          </Button>
                        </Flex>
                      </Card>

                      {/* Usage Trend Chart */}
                      {billing.historicalUsage && billing.historicalUsage.length > 0 && (
                        <Card className="p-6 mb-6">
                          <Flex justify="between" align="center" className="mb-4">
                            <Flex align="center" gap={12}>
                              <TrendingUp size={20} className="text-[#1eb182]" />
                              <Title as="h2" className="text-lg">Usage Trend</Title>
                            </Flex>
                            <Select
                              value={selectedMonth}
                              onChange={(e) => setSelectedMonth(e.target.value)}
                              className="w-48"
                            >
                              <option value="current">Last 30 days</option>
                              {Array.from({ length: 6 }, (_, i) => {
                                const date = new Date();
                                date.setMonth(date.getMonth() - i);
                                const value = date.toISOString().slice(0, 7);
                                const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                return <option key={value} value={value}>{label}</option>;
                              })}
                            </Select>
                          </Flex>
                          
                          <Box className="h-64">
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
                          </Box>
                          
                          <Flex gap={16} className="mt-4">
                            <Flex align="center" gap={8}>
                              <Box className="w-3 h-3 bg-[#1eb182] rounded-full" />
                              <Text className="text-xs text-gray-600">Daily Cost</Text>
                            </Flex>
                          </Flex>
                        </Card>
                      )}


                      {/* Removed credit balance UI - prepaid uses invoicing, not credits */}

                      {/* Payment Method */}
                      <Card className="p-6 mb-6">
                        <Flex align="center" gap={12} className="mb-4">
                          <CreditCard size={20} className="text-[#1eb182]" />
                          <Title as="h2" className="text-lg">Payment Method</Title>
                        </Flex>
                        
                        {billing.hasPaymentMethod ? (
                          <Box className="space-y-3">
                            {billing.paymentMethodDetails?.card && (
                              <Card variant="readOnly" className="p-4">
                                <Flex justify="between" align="center">
                                  <Flex align="center" gap={12}>
                                    <CreditCard size={18} className="text-gray-500" />
                                    <Box>
                                      <Text className="text-sm font-medium capitalize">
                                        {billing.paymentMethodDetails.card.brand} •••• {billing.paymentMethodDetails.card.last4}
                                      </Text>
                                      <Text className="text-xs text-gray-500">
                                        Expires {String(billing.paymentMethodDetails.card.expMonth).padStart(2, '0')}/{billing.paymentMethodDetails.card.expYear}
                                      </Text>
                                    </Box>
                                  </Flex>
                                  <Badge variant="success" size="sm">Active</Badge>
                                </Flex>
                              </Card>
                            )}
                            {!billing.paymentMethodDetails && (
                              <Text className="text-sm text-gray-600">Payment method on file</Text>
                            )}
                            <Button
                              intent="ghost"
                              size="md"
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
                                  alert('Failed to open billing portal. Please try again.');
                                }
                              }}
                            >
                              <IconLabel icon={<ExternalLink size={16} />} gap={8}>
                                Manage Payment Methods
                              </IconLabel>
                            </Button>
                          </Box>
                        ) : (
                          <Box className="space-y-3">
                            <Text className="text-sm text-gray-600">No payment methods added yet.</Text>
                            <Button
                              intent="primary"
                              size="md"
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
                                  alert('Failed to set up payment. Please try again.');
                                }
                              }}
                            >
                              Add Payment Method
                            </Button>
                          </Box>
                        )}
                      </Card>

                      {/* Invoices */}
                      {billing.hasPaymentMethod && (
                        <Card className="p-6 mb-6">
                          <Flex align="center" gap={12} className="mb-4">
                            <Calendar size={20} className="text-[#1eb182]" />
                            <Title as="h2" className="text-lg">Recent Invoices</Title>
                          </Flex>
                          
                          {billing.invoices && billing.invoices.length > 0 ? (
                            <>
                              <Box className="space-y-2">
                                {billing.invoices.slice(0, 5).map(invoice => {
                                  const statusVariant =
                                    invoice.status === 'paid' ? 'success' :
                                    invoice.status === 'open' ? 'warning' :
                                    invoice.status === 'draft' ? 'secondary' :
                                    invoice.status === 'void' ? 'error' : 'secondary';

                                  // Check what we actually have
                                  console.log('Invoice data:', {
                                    id: invoice.id,
                                    invoice_number: invoice.invoice_number,
                                    status: invoice.status,
                                    invoice_url: invoice.invoice_url,
                                    pdf_url: invoice.pdf_url,
                                    amount: invoice.amount,
                                    total: invoice.total
                                  });

                                  return (
                                    <Flex key={invoice.id} justify="between" align="center" className="py-2 border-b border-gray-100 last:border-0">
                                      <Box>
                                        {invoice.invoice_url ? (
                                          <a
                                            href={invoice.invoice_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                          >
                                            {invoice.invoice_number || 'View Invoice'}
                                          </a>
                                        ) : (
                                          <Text className="text-sm font-medium">{invoice.invoice_number || invoice.id}</Text>
                                        )}
                                        <Text className="text-xs text-gray-500">
                                          {new Date(invoice.created_at).toLocaleDateString()}
                                        </Text>
                                      </Box>
                                      <Flex align="center" gap={12}>
                                        <Text className="text-sm font-medium">
                                          ${(invoice.total ?? invoice.amount ?? 0).toFixed(2)}
                                        </Text>
                                        <Badge variant={statusVariant as any} size="sm">
                                          {invoice.status || 'Unknown'}
                                        </Badge>
                                        {invoice.pdf_url && (
                                          <a
                                            href={invoice.pdf_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                            title="Download PDF"
                                          >
                                            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17h6M9 13h6M9 9h4" />
                                            </svg>
                                          </a>
                                        )}
                                      </Flex>
                                    </Flex>
                                  );
                                })}
                              </Box>
                              <Button
                                intent="ghost"
                                size="md"
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
                                    alert('Failed to open billing portal. Please try again.');
                                  }
                                }}
                              >
                                <IconLabel icon={<ExternalLink size={16} />} gap={8}>
                                  View All Invoices
                                </IconLabel>
                              </Button>
                            </>
                          ) : (
                            <Text className="text-sm text-gray-500">No invoices yet</Text>
                          )}
                        </Card>
                      )}

                      {/* Pricing Info */}
                      <Card className="p-6">
                        <Title as="h2" className="text-lg mb-3">Pay-As-You-Go Pricing</Title>
                        <Box className="space-y-2 text-sm">
                          <Flex justify="between">
                            <Text className="text-gray-600">Hops Credits</Text>
                            <Text className="font-medium">${pricing.compute_credits.toFixed(2)} / credit</Text>
                          </Flex>
                          <Flex justify="between">
                            <Text className="text-gray-600">Online Storage</Text>
                            <Text className="font-medium">${pricing.storage_online_gb.toFixed(2)} / GB-month</Text>
                          </Flex>
                          <Flex justify="between">
                            <Text className="text-gray-600">Offline Storage</Text>
                            <Text className="font-medium">${pricing.storage_offline_gb.toFixed(3)} / GB-month</Text>
                          </Flex>
                        </Box>
                      </Card>
                    </>
                  )}
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="settings">
              <Card className="p-6 mb-6">
                <Title as="h2" className="text-lg mb-4">Account Information</Title>
                <Flex direction="column" gap={12}>
                  <Box>
                    <Text className="text-sm text-gray-600">Email</Text>
                    <Text className="font-medium">{user.email}</Text>
                  </Box>
                  <Box>
                    <Text className="text-sm text-gray-600">User ID</Text>
                    <Text className="text-xs font-mono">{user.sub}</Text>
                  </Box>
                </Flex>
              </Card>
              
              <Card className="p-6 mb-6">
                <Flex align="center" gap={12} className="mb-4">
                  <Trash2 size={20} className="text-red-500" />
                  <Title as="h2" className="text-lg">Danger Zone</Title>
                </Flex>
                {billing?.isTeamMember ? (
                  <Box className="p-4 bg-gray-50 border border-gray-200 rounded">
                    <Text className="text-sm text-gray-700">
                      Team members cannot self-delete. Contact your account owner ({teamData?.account_owner?.email}) to be removed from the team.
                    </Text>
                  </Box>
                ) : teamData?.team_members && teamData.team_members.length > 0 ? (
                  <Box className="p-4 bg-gray-50 border border-gray-200 rounded">
                    <Text className="text-sm text-gray-700">
                      Cannot delete account with active team members. Remove all team members first.
                    </Text>
                  </Box>
                ) : (
                  <>
                    <Text className="text-sm text-gray-600 mb-4">
                      Delete your account and revoke access to all resources. Billing data will be retained for compliance.
                    </Text>
                    <Button
                      intent="secondary"
                      size="md"
                      className="border-red-500 text-red-600 hover:bg-red-50 focus:ring-red-500"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      Delete Account
                    </Button>
                  </>
                )}
              </Card>

              <Flex justify="center">
                <Button 
                  intent="ghost" 
                  size="md"
                  onClick={() => signOut()}
                >
                  Sign Out
                </Button>
              </Flex>
            </TabsContent>
          </Tabs>
        </Box>
      </Layout>
      
      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteEmail('');
          setInviteRole('Data scientist');
          setAutoAssignProjects(true);
          setInviteError('');
        }}
        size="sm"
        title="Invite Team Member"
      >
        <Flex direction="column" gap={16}>
          <Text className="text-sm text-gray-600">
            Invite a new member to join your team. They&apos;ll have access to Hopsworks 
            and their usage will be billed to your account.
          </Text>
          
          <Box>
            <Text className="text-sm font-medium mb-2">Email Address</Text>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              disabled={inviteLoading}
            />
            {inviteError && (
              <Text className="text-xs text-red-500 mt-1">{inviteError}</Text>
            )}
          </Box>

          <Box>
            <Text className="text-sm font-medium mb-2">Default Project Role</Text>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              disabled={inviteLoading}
            >
              <option value="Data scientist">Data scientist</option>
              <option value="Data owner">Data owner</option>
            </Select>
            <Text className="text-xs text-gray-500 mt-1">
              Role they&apos;ll have when added to your projects
            </Text>
          </Box>

          <Box>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={autoAssignProjects}
                onChange={(e) => setAutoAssignProjects(e.target.checked)}
                disabled={inviteLoading}
                className="mr-2"
              />
              <Text className="text-sm">
                Automatically add to all my existing projects
              </Text>
            </label>
          </Box>

          <Flex gap={12} justify="end">
            <Button 
              onClick={() => {
                setShowInviteModal(false);
                setInviteEmail('');
                setInviteRole('Data scientist');
                setAutoAssignProjects(true);
                setInviteError('');
              }}
              intent="secondary"
              size="md"
              disabled={inviteLoading}
            >
              Cancel
            </Button>
            <Button 
              intent="primary"
              size="md"
              onClick={handleInvite}
              disabled={!inviteEmail || inviteLoading}
            >
              {inviteLoading ? 'Sending...' : 'Send Invite'}
            </Button>
          </Flex>
        </Flex>
      </Modal>

      {/* Remove Team Member Modal */}
      <Modal
        isOpen={showRemoveModal}
        onClose={() => {
          setShowRemoveModal(false);
          setRemovingMemberId(null);
        }}
        title="Remove Team Member"
      >
        <Flex direction="column" gap={16}>
          <Box className="p-4 bg-yellow-50 border border-yellow-200 rounded">
            <Flex align="start" gap={8}>
              <AlertTriangle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <Box>
                <Text className="text-sm font-medium text-yellow-800 mb-2">
                  Manual action required in Hopsworks
                </Text>
                <Text className="text-sm text-yellow-700">
                  This will remove the team member from your SaaS account, but you must manually remove them from your Hopsworks projects.
                </Text>
              </Box>
            </Flex>
          </Box>

          <Box>
            <Text className="text-sm text-gray-700 mb-2">
              After removing this member:
            </Text>
            <Box as="ol" className="list-decimal list-inside text-sm text-gray-600 space-y-1 ml-2">
              <li>Go to your Hopsworks cluster</li>
              <li>Open each project they have access to</li>
              <li>Navigate to Settings → Members</li>
              <li>Remove the user from the project</li>
            </Box>
          </Box>

          <Text className="text-sm text-gray-600">
            The user will be converted to a standalone account and can create their own billing.
          </Text>

          <Flex justify="end" gap={8}>
            <Button
              intent="secondary"
              size="md"
              onClick={() => {
                setShowRemoveModal(false);
                setRemovingMemberId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              intent="primary"
              size="md"
              onClick={confirmRemoveMember}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              Remove Member
            </Button>
          </Flex>
        </Flex>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteReason('');
        }}
        title="Delete Account"
        size="sm"
      >
        <Flex direction="column" gap={16}>
          <Box className="p-4 bg-red-50 border border-red-200 rounded">
            <Flex align="start" gap={8}>
              <AlertTriangle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <Box>
                <Text className="text-sm font-medium text-red-800 mb-2">
                  This will immediately revoke access to all resources
                </Text>
                <Text className="text-sm text-red-700">
                  You will be logged out and unable to access your cluster or projects.
                </Text>
              </Box>
            </Flex>
          </Box>

          <Box>
            <Text className="text-sm font-medium mb-2">Why are you deleting your account? (optional)</Text>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Help us improve by sharing your reason..."
              className="w-full p-3 border border-gray-300 rounded text-sm resize-none"
              rows={3}
              disabled={deletingAccount}
            />
          </Box>

          <Flex justify="end" gap={8}>
            <Button
              intent="secondary"
              size="md"
              onClick={() => {
                setShowDeleteModal(false);
                setDeleteReason('');
              }}
              disabled={deletingAccount}
            >
              Cancel
            </Button>
            <Button
              intent="primary"
              size="md"
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
              disabled={deletingAccount}
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
                    alert(data.error || 'Failed to delete account. Please try again.');
                    setDeletingAccount(false);
                  }
                } catch (error) {
                  alert('Failed to delete account. Please try again.');
                  setDeletingAccount(false);
                }
              }}
            >
              {deletingAccount ? 'Deleting...' : 'Delete Account'}
            </Button>
          </Flex>
        </Flex>
      </Modal>

      {/* Downgrade Warning Modal - blocking for free users with too many projects */}
      <Modal
        isOpen={showDowngradeModal}
        onClose={() => {}}
        title="Action Required"
        size="md"
        showCloseButton={false}
        closeOnOverlayClick={false}
        blur={4}
      >
        <Flex direction="column" gap={16}>
          <Box className="p-4 bg-amber-50 border border-amber-200 rounded">
            <Flex align="start" gap={8}>
              <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <Box>
                <Text className="text-sm font-medium text-amber-800 mb-2">
                  Your account is now on the Free plan
                </Text>
                <Text className="text-sm text-amber-700">
                  Free plan includes <strong>1 project only</strong>. You currently have{' '}
                  <strong>{hopsworksInfo?.projects?.length || 0} projects</strong>.
                </Text>
              </Box>
            </Flex>
          </Box>

          {billing?.downgradeDeadline && (
            <Box className="p-3 bg-gray-50 rounded border">
              <Text className="text-sm text-gray-700">
                <strong>Deadline:</strong>{' '}
                {new Date(billing.downgradeDeadline).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Text>
              <Text className="text-xs text-gray-500 mt-1">
                Delete {(hopsworksInfo?.projects?.length || 0) - 1} project(s) by this date or your account will be suspended.
              </Text>
            </Box>
          )}

          <Box>
            <Text className="text-sm font-medium mb-3">Your projects:</Text>
            <Box className="space-y-2 max-h-48 overflow-y-auto">
              {hopsworksInfo?.projects?.map((project) => (
                <Flex key={project.id} justify="between" align="center" className="p-2 bg-gray-50 rounded border">
                  <Text className="text-sm font-mono">{project.name}</Text>
                  <a
                    href={`${instance?.endpoint?.replace('/hopsworks-api', '')}/p/${project.id}/settings/general`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-red-600 hover:text-red-800 underline"
                  >
                    Delete project
                  </a>
                </Flex>
              ))}
            </Box>
            <Button
              intent="secondary"
              size="sm"
              className="w-full mt-3"
              onClick={async () => {
                await refetchHopsworksInfo();
                await refetchBilling();
              }}
              disabled={hopsworksLoading}
              isLoading={hopsworksLoading}
            >
              <RefreshCw size={14} />
              I&apos;ve deleted a project - Refresh
            </Button>
          </Box>

          <Box className="border-t pt-4">
            <Text className="text-sm text-gray-600 mb-3">
              <strong>Alternatively</strong>, add a payment method to upgrade to Pay-as-you-go (5 projects included):
            </Text>
            <Button
              intent="primary"
              size="md"
              className="w-full"
              onClick={handleUpgradeToPostpaid}
              disabled={upgradingToPostpaid}
              isLoading={upgradingToPostpaid}
            >
              <CreditCard size={16} />
              Add Payment Method
            </Button>
          </Box>
        </Flex>
      </Modal>
    </>
  );
}