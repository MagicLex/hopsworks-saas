import { useUser } from '@auth0/nextjs-auth0/client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Edit2, Server } from 'lucide-react';
import { toast } from 'sonner';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_login_at: string;
  login_count: number;
  status: string;
  deleted_at?: string;
  deletion_reason?: string;
  is_admin: boolean;
  account_owner_id?: string;
  hopsworks_username?: string;
  billing_mode?: string;
  promo_code?: string;
  spending_cap?: number | null;
  metadata?: {
    corporate_ref?: string;
    [key: string]: any;
  };
  projects?: {
    namespace: string;
    name: string;
    id: number;
    is_owner: boolean;
    total_cost: number;
    cpu_hours: number;
    gpu_hours: number;
    ram_gb_hours: number;
  }[];
  user_hopsworks_assignments?: {
    hopsworks_cluster_id: string;
    hopsworks_clusters: {
      id: string;
      name: string;
      api_url: string;
    };
  }[];
}

interface Cluster {
  id: string;
  name: string;
  api_url: string;
  status: string;
  current_users: number;
  max_users: number;
  region?: string;
  created_at: string;
}

export default function AdminPage() {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 20;
  const [actionLoading, setActionLoading] = useState<{ [userId: string]: boolean }>({});
  const [editMetadataUser, setEditMetadataUser] = useState<User | null>(null);
  const [metadataForm, setMetadataForm] = useState({
    promoCode: '',
    corporateRef: '',
    clusterId: '',
    spendingCap: ''
  });
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  const [editCluster, setEditCluster] = useState<Cluster | null>(null);
  const [clusterForm, setClusterForm] = useState({
    name: '',
    region: '',
    status: '',
    max_users: 100
  });

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    fetchUsers();
    fetchClusters();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchClusters = async () => {
    try {
      const response = await fetch('/api/admin/clusters');
      if (response.ok) {
        const data = await response.json();
        setClusters(data.clusters || []);
      } else {
        setError('Failed to fetch clusters');
      }
    } catch (err) {
      console.error('Failed to fetch clusters:', err);
      setError('Failed to fetch clusters');
    } finally {
      setLoadingClusters(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) {
        if (response.status === 403) {
          router.push('/');
          return;
        }
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const getUserTodayCost = (user: User) => {
    if (!user.projects || user.projects.length === 0) return 0;
    return user.projects.reduce((sum, project) => sum + project.total_cost, 0);
  };

  const suspendUser = async (userId: string, email: string) => {
    const reason = prompt(`Suspend user ${email}?\n\nOptional reason:`);
    if (reason === null) return; // User cancelled

    setActionLoading(prev => ({ ...prev, [userId]: true }));
    setError(null);
    try {
      const response = await fetch('/api/admin/suspend-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason: reason || 'admin_action' })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(
          `User ${email} suspended (Supabase ${data.supabaseUpdated ? '✓' : '✗'} · Hopsworks ${data.hopsworksUpdated ? '✓' : '✗'})`,
        );
        fetchUsers();
      } else {
        setError(`Failed to suspend user: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to suspend user:', error);
      setError('Failed to suspend user');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const reactivateUser = async (userId: string, email: string) => {
    if (!confirm(`Reactivate user ${email}?`)) return;

    setActionLoading(prev => ({ ...prev, [userId]: true }));
    setError(null);
    try {
      const response = await fetch('/api/admin/reactivate-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason: 'admin_action' })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(
          `User ${email} reactivated (Supabase ${data.supabaseUpdated ? '✓' : '✗'} · Hopsworks ${data.hopsworksUpdated ? '✓' : '✗'})`,
        );
        fetchUsers();
      } else {
        setError(`Failed to reactivate user: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to reactivate user:', error);
      setError('Failed to reactivate user');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const openMetadataModal = (user: User) => {
    const currentClusterId = user.user_hopsworks_assignments?.[0]?.hopsworks_cluster_id || '';

    setEditMetadataUser(user);
    setMetadataForm({
      promoCode: user.promo_code || '',
      corporateRef: user.metadata?.corporate_ref || '',
      clusterId: currentClusterId,
      spendingCap: user.spending_cap !== null && user.spending_cap !== undefined ? String(user.spending_cap) : ''
    });
  };

  const closeMetadataModal = () => {
    setEditMetadataUser(null);
    setMetadataForm({ promoCode: '', corporateRef: '', clusterId: '', spendingCap: '' });
  };

  const openClusterModal = (cluster: Cluster) => {
    setEditCluster(cluster);
    setClusterForm({
      name: cluster.name,
      region: cluster.region || '',
      status: cluster.status,
      max_users: cluster.max_users
    });
  };

  const closeClusterModal = () => {
    setEditCluster(null);
    setClusterForm({ name: '', region: '', status: '', max_users: 100 });
  };

  const saveCluster = async () => {
    if (!editCluster) return;

    setActionLoading(prev => ({ ...prev, [editCluster.id]: true }));
    setError(null);
    try {
      const response = await fetch('/api/admin/clusters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editCluster.id,
          name: clusterForm.name,
          region: clusterForm.region || null,
          status: clusterForm.status,
          max_users: clusterForm.max_users
        })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(`Cluster ${clusterForm.name} updated`);
        closeClusterModal();
        fetchClusters();
      } else {
        setError(`Failed to update cluster: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to update cluster:', error);
      setError('Failed to update cluster');
    } finally {
      setActionLoading(prev => ({ ...prev, [editCluster.id]: false }));
    }
  };

  const saveMetadata = async () => {
    if (!editMetadataUser) return;

    setActionLoading(prev => ({ ...prev, [editMetadataUser.id]: true }));
    setError(null);
    try {
      // Update metadata
      const metadataResponse = await fetch('/api/admin/update-user-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editMetadataUser.id,
          promoCode: metadataForm.promoCode,
          corporateRef: metadataForm.corporateRef
        })
      });

      if (!metadataResponse.ok) {
        const data = await metadataResponse.json();
        setError(`Failed to update metadata: ${data.error}`);
        setActionLoading(prev => ({ ...prev, [editMetadataUser.id]: false }));
        return;
      }

      // Update spending cap if changed
      const currentCap = editMetadataUser.spending_cap !== null && editMetadataUser.spending_cap !== undefined
        ? String(editMetadataUser.spending_cap)
        : '';
      if (metadataForm.spendingCap !== currentCap) {
        const capResponse = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: editMetadataUser.id,
            spendingCap: metadataForm.spendingCap === '' ? null : metadataForm.spendingCap
          })
        });

        if (!capResponse.ok) {
          const data = await capResponse.json();
          toast.error(`Metadata updated but spending cap failed: ${data.error}`);
        }
      }

      // Update cluster assignment if changed
      const currentClusterId = editMetadataUser.user_hopsworks_assignments?.[0]?.hopsworks_cluster_id;
      if (metadataForm.clusterId && metadataForm.clusterId !== currentClusterId) {
        // First remove old assignment if exists
        if (currentClusterId) {
          await fetch('/api/admin/users', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: editMetadataUser.id,
              clusterId: currentClusterId
            })
          });
        }

        // Then assign new cluster
        const assignResponse = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: editMetadataUser.id })
        });

        if (!assignResponse.ok) {
          const data = await assignResponse.json();
          toast.error(`Metadata updated but cluster assignment failed: ${data.error}`);
        }
      }

      toast.success(`Updated ${editMetadataUser.email}`);
      closeMetadataModal();
      fetchUsers();
    } catch (error) {
      console.error('Failed to update:', error);
      setError('Failed to update user');
    } finally {
      setActionLoading(prev => ({ ...prev, [editMetadataUser.id]: false }));
    }
  };

  const changeBillingMode = async (userId: string, email: string, currentMode: string) => {
    const newMode = currentMode === 'prepaid' ? 'postpaid' : 'prepaid';
    if (!confirm(`Change billing mode for ${email} from ${currentMode} to ${newMode}?`)) return;

    setActionLoading(prev => ({ ...prev, [userId]: true }));
    setError(null);
    try {
      const response = await fetch('/api/admin/change-billing-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, billingMode: newMode })
      });

      const data = await response.json();

      if (response.ok) {
        // If switching to prepaid, automatically assign cluster after 5 seconds
        if (newMode === 'prepaid') {
          toast.info(`Billing mode set to prepaid. Cluster will be assigned in 5s.`);

          setTimeout(async () => {
            try {
              const assignResponse = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
              });

              if (assignResponse.ok) {
                console.log(`Cluster assigned successfully for ${email}`);
              } else {
                const assignData = await assignResponse.json();
                console.error(`Failed to assign cluster: ${assignData.error}`);
              }

              fetchUsers(); // Refresh after assignment
            } catch (error) {
              console.error('Failed to assign cluster:', error);
            }
          }, 5000);
        } else {
          toast.success(`Billing mode: ${email} ${currentMode} → ${newMode}`);
        }

        fetchUsers(); // Immediate refresh
      } else {
        setError(`Failed to change billing mode: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to change billing mode:', error);
      setError('Failed to change billing mode');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  if (isLoading || loadingUsers) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span>Loading...</span>
      </div>
    );
  }

  // Pagination
  const totalPages = Math.ceil(users.length / usersPerPage);
  const startIndex = (currentPage - 1) * usersPerPage;
  const endIndex = startIndex + usersPerPage;
  const paginatedUsers = users.slice(startIndex, endIndex);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-muted p-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-semibold mb-8">Admin</h1>

          {error && (
            <Card className="mb-4 p-4 border-destructive bg-destructive/10">
              <span className="text-destructive">{error}</span>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="clusters">Clusters</TabsTrigger>
            </TabsList>

            <TabsContent value="users">
              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-6">Users Overview</h2>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
                        <th className="text-left py-4 px-4">User</th>
                        <th className="text-left py-4 px-4">Status</th>
                        <th className="text-left py-4 px-4">Billing</th>
                        <th className="text-left py-4 px-4">Cluster</th>
                        <th className="text-right py-4 px-4">Today&apos;s Cost</th>
                        <th className="text-right py-4 px-4">Projects</th>
                        <th className="text-right py-4 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedUsers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted-foreground">
                            No users found in the system.
                          </td>
                        </tr>
                      ) : (
                        paginatedUsers.map(user => {
                          const todayCost = getUserTodayCost(user);
                          const isDeleted = !!user.deleted_at;

                          return (
                            <tr key={user.id} className={`border-b border-border hover:bg-muted/30 ${isDeleted ? 'opacity-60' : ''}`}>
                              <td className="py-4 px-4">
                                <div>
                                  <p className="font-medium">{user.name || 'Unknown User'}</p>
                                  <p className="text-xs text-muted-foreground">{user.email}</p>
                                  {user.hopsworks_username && (
                                    <p className="text-xs font-mono text-muted-foreground mt-1">
                                      HW: {user.hopsworks_username}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td className="py-4 px-4">
                                {isDeleted ? (
                                  <div>
                                    <Badge variant="destructive">Deleted</Badge>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {new Date(user.deleted_at!).toLocaleDateString()}
                                    </p>
                                    {user.deletion_reason && (
                                      <p className="text-xs text-muted-foreground">
                                        {user.deletion_reason.replace('_', ' ')}
                                      </p>
                                    )}
                                  </div>
                                ) : user.status === 'suspended' ? (
                                  <div>
                                    <Badge variant="notice">Suspended</Badge>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Requires review
                                    </p>
                                  </div>
                                ) : user.account_owner_id ? (
                                  <Badge variant="outline">Team Member</Badge>
                                ) : (
                                  <Badge variant="success">Active</Badge>
                                )}
                              </td>
                              <td className="py-4 px-4">
                                {user.account_owner_id ? (
                                  <span className="text-xs text-muted-foreground">-</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={user.billing_mode === 'prepaid' ? 'outline' : 'default'}
                                    >
                                      {user.billing_mode || 'postpaid'}
                                    </Badge>
                                    {!isDeleted && user.status === 'active' && (
                                      <Button
                                        onClick={() => changeBillingMode(user.id, user.email, user.billing_mode || 'postpaid')}
                                        disabled={actionLoading[user.id]}
                                        loading={actionLoading[user.id]}
                                        variant="secondary"
                                        size="xs"
                                      >
                                        Switch
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-4 px-4">
                                {user.user_hopsworks_assignments?.[0] ? (
                                  <Badge variant="outline">
                                    {user.user_hopsworks_assignments[0].hopsworks_clusters.name}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">No cluster</span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-right">
                                {todayCost > 0 ? (
                                  <div>
                                    <p className="font-mono">
                                      ${todayCost.toFixed(4)}
                                    </p>
                                    {user.spending_cap && (
                                      <p className="text-xs text-muted-foreground">
                                        Cap: ${user.spending_cap}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <span className="text-xs text-muted-foreground">-</span>
                                    {user.spending_cap && (
                                      <p className="text-xs text-muted-foreground">
                                        Cap: ${user.spending_cap}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-4 px-4 text-right">
                                {user.projects && user.projects.length > 0 ? (
                                  <Badge variant="outline">
                                    {user.projects.length}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">0</span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-right">
                                {isDeleted ? (
                                  <span className="text-xs text-muted-foreground">-</span>
                                ) : user.status === 'suspended' ? (
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      onClick={() => reactivateUser(user.id, user.email)}
                                      disabled={actionLoading[user.id]}
                                      loading={actionLoading[user.id]}
                                      size="sm"
                                    >
                                      {actionLoading[user.id] ? 'Loading...' : 'Unsuspend'}
                                    </Button>
                                    {!user.account_owner_id && (
                                      <Button
                                        onClick={() => openMetadataModal(user)}
                                        disabled={actionLoading[user.id]}
                                        variant="secondary"
                                        size="icon-sm"
                                      >
                                        <Edit2 size={14} />
                                      </Button>
                                    )}
                                  </div>
                                ) : user.status === 'active' ? (
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      onClick={() => suspendUser(user.id, user.email)}
                                      disabled={actionLoading[user.id]}
                                      loading={actionLoading[user.id]}
                                      variant="secondary"
                                      size="sm"
                                    >
                                      {actionLoading[user.id] ? 'Loading...' : 'Suspend'}
                                    </Button>
                                    {!user.account_owner_id && (
                                      <Button
                                        onClick={() => openMetadataModal(user)}
                                        disabled={actionLoading[user.id]}
                                        variant="secondary"
                                        size="icon-sm"
                                      >
                                        <Edit2 size={14} />
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center mt-4 gap-2">
                    <Button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      size="sm"
                      variant="secondary"
                    >
                      Previous
                    </Button>
                    <span className="text-sm px-4">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      size="sm"
                      variant="secondary"
                    >
                      Next
                    </Button>
                  </div>
                )}

                {/* Summary */}
                {users.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        Total Users: {users.length} | With Activity: {users.filter(u => (u.projects && u.projects.length > 0)).length}
                        {totalPages > 1 && ` | Showing ${startIndex + 1}-${Math.min(endIndex, users.length)}`}
                      </span>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Total Today&apos;s Cost (All Users)</p>
                        <p className="font-mono font-semibold text-lg">
                          ${users.reduce((sum, u) => sum + getUserTodayCost(u), 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="clusters">
              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-6">Clusters Overview</h2>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
                        <th className="text-left py-4 px-4">Cluster</th>
                        <th className="text-left py-4 px-4">Region</th>
                        <th className="text-left py-4 px-4">Status</th>
                        <th className="text-right py-4 px-4">Users</th>
                        <th className="text-right py-4 px-4">Capacity</th>
                        <th className="text-left py-4 px-4">API URL</th>
                        <th className="text-right py-4 px-4">Created</th>
                        <th className="text-right py-4 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingClusters ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-muted-foreground">
                            Loading clusters...
                          </td>
                        </tr>
                      ) : clusters.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-muted-foreground">
                            No clusters found.
                          </td>
                        </tr>
                      ) : (
                        clusters.map(cluster => (
                          <tr key={cluster.id} className="border-b border-border hover:bg-muted/30">
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-2">
                                <Server size={16} className="text-muted-foreground" />
                                <p className="font-medium">{cluster.name}</p>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              {cluster.region ? (
                                <Badge variant="outline">{cluster.region}</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-4 px-4">
                              <Badge
                                variant={cluster.status === 'active' ? 'success' : 'outline'}
                              >
                                {cluster.status}
                              </Badge>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <span className="font-mono">{cluster.current_users}</span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <span className="font-mono">{cluster.max_users}</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="block text-xs text-muted-foreground font-mono truncate max-w-xs">
                                {cluster.api_url}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <span className="text-xs text-muted-foreground">
                                {new Date(cluster.created_at).toLocaleDateString()}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <Button
                                onClick={() => openClusterModal(cluster)}
                                disabled={actionLoading[cluster.id]}
                                variant="secondary"
                                size="icon-sm"
                              >
                                <Edit2 size={14} />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Summary */}
                {clusters.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        Total Clusters: {clusters.length} | Active: {clusters.filter(c => c.status === 'active').length}
                      </span>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Total Capacity</p>
                        <p className="font-mono font-semibold text-lg">
                          {clusters.reduce((sum, c) => sum + c.current_users, 0)} / {clusters.reduce((sum, c) => sum + c.max_users, 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Metadata Edit Modal */}
        <Dialog
          open={!!editMetadataUser}
          onOpenChange={(o) => !o && closeMetadataModal()}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Edit Metadata: {editMetadataUser?.email}
              </DialogTitle>
            </DialogHeader>

            {editMetadataUser && (
              <div className="space-y-4">
                <Input
                  label="Promo Code"
                  type="text"
                  value={metadataForm.promoCode}
                  onChange={(e) => setMetadataForm(prev => ({ ...prev, promoCode: e.target.value }))}
                  placeholder="e.g., STARTUP2024"
                  info="Leave empty to clear"
                />

                <Input
                  label="Corporate Reference"
                  type="text"
                  value={metadataForm.corporateRef}
                  onChange={(e) => setMetadataForm(prev => ({ ...prev, corporateRef: e.target.value }))}
                  placeholder="e.g., DEAL-12345"
                  info="HubSpot deal ID or corporate reference"
                />

                <Input
                  label="Spending Cap"
                  type="number"
                  value={metadataForm.spendingCap}
                  onChange={(e) => setMetadataForm(prev => ({ ...prev, spendingCap: e.target.value }))}
                  placeholder="e.g., 100 (leave empty to disable)"
                  min="0"
                  step="1"
                  info="Monthly spending cap in USD. Leave empty to disable."
                />

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cluster-select">Cluster Assignment</Label>
                  <Select
                    value={metadataForm.clusterId || 'none'}
                    onValueChange={(v) =>
                      setMetadataForm(prev => ({ ...prev, clusterId: v === 'none' ? '' : v }))
                    }
                  >
                    <SelectTrigger id="cluster-select" className="w-full">
                      <SelectValue placeholder="No cluster assigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No cluster assigned</SelectItem>
                      {clusters.map(cluster => (
                        <SelectItem key={cluster.id} value={cluster.id}>
                          {cluster.name} ({cluster.current_users}/{cluster.max_users})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    Assign or change user cluster (Current: {metadataForm.clusterId || 'none'})
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={closeMetadataModal}
                variant="secondary"
                size="sm"
                disabled={!!editMetadataUser && actionLoading[editMetadataUser.id]}
              >
                Cancel
              </Button>
              <Button
                onClick={saveMetadata}
                disabled={!editMetadataUser || actionLoading[editMetadataUser.id]}
                loading={!!editMetadataUser && actionLoading[editMetadataUser.id]}
                size="sm"
              >
                {editMetadataUser && actionLoading[editMetadataUser.id] ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cluster Edit Modal */}
        <Dialog
          open={!!editCluster}
          onOpenChange={(o) => !o && closeClusterModal()}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Edit Cluster: {editCluster?.name}
              </DialogTitle>
            </DialogHeader>

            {editCluster && (
              <div className="space-y-4">
                <Input
                  label="Cluster Name"
                  type="text"
                  value={clusterForm.name}
                  onChange={(e) => setClusterForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., dev-cloud"
                />

                <Input
                  label="Region"
                  type="text"
                  value={clusterForm.region}
                  onChange={(e) => setClusterForm(prev => ({ ...prev, region: e.target.value }))}
                  placeholder="e.g., eu-west-1, us-east-1"
                  info="AWS region or datacenter location"
                />

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cluster-status">Status</Label>
                  <Select
                    value={clusterForm.status}
                    onValueChange={(v) => setClusterForm(prev => ({ ...prev, status: v }))}
                  >
                    <SelectTrigger id="cluster-status" className="w-full">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Input
                  label="Max Users (Capacity)"
                  type="number"
                  value={clusterForm.max_users}
                  onChange={(e) => setClusterForm(prev => ({ ...prev, max_users: parseInt(e.target.value) || 100 }))}
                  min="1"
                  info={`Current: ${editCluster.current_users} / ${editCluster.max_users}`}
                />
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={closeClusterModal}
                variant="secondary"
                size="sm"
                disabled={!!editCluster && actionLoading[editCluster.id]}
              >
                Cancel
              </Button>
              <Button
                onClick={saveCluster}
                disabled={!editCluster || actionLoading[editCluster.id]}
                loading={!!editCluster && actionLoading[editCluster.id]}
                size="sm"
              >
                {editCluster && actionLoading[editCluster.id] ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
