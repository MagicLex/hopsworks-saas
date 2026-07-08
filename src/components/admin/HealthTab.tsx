import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ClusterHealth {
  id: string;
  name: string;
  status: string;
  users: number;
  maxUsers: number;
  lastMeteredHour: string | null;
  meteringHoursBehind: number | null;
  lastCollectionAt: string | null;
}

interface Health {
  clusters: ClusterHealth[];
  unresolvedFailures: {
    total: number;
    byType: Record<string, number>;
    latest: Array<{ check_type: string; email: string; error_message: string; created_at: string }>;
  };
  generatedAt: string;
}

// Metering lag: the in-progress hour is never metered, so 0-1 is nominal.
function meteringBadge(hoursBehind: number | null) {
  if (hoursBehind === null) return <Badge variant="secondary">no watermark</Badge>;
  if (hoursBehind <= 1) return <Badge variant="success">up to date</Badge>;
  if (hoursBehind <= 3) return <Badge variant="secondary">{hoursBehind}h behind</Badge>;
  return <Badge variant="destructive">{hoursBehind}h behind</Badge>;
}

export default function HealthTab() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch health:', err);
      setError('Failed to load health data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const collectNow = async () => {
    if (!confirm('Trigger an OpenCost collection run now?')) return;
    setCollecting(true);
    try {
      const res = await fetch('/api/admin/usage/collect', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'collection failed');
      toast.success('OpenCost collection triggered');
      fetchHealth();
    } catch (err: any) {
      toast.error(`Collection failed: ${err.message}`);
    } finally {
      setCollecting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8">Loading health data...</p>;
  }
  if (error || !data) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive mb-3">{error || 'No data'}</p>
        <Button variant="secondary" onClick={fetchHealth}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Metering pipeline health. Snapshot at {new Date(data.generatedAt).toLocaleTimeString()}.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={fetchHealth}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button size="sm" onClick={collectNow} disabled={collecting} loading={collecting}>
            {collecting ? 'Collecting...' : 'Collect OpenCost now'}
          </Button>
        </div>
      </div>

      {/* Cluster metering status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.clusters.map(c => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Activity size={18} className="text-primary" />
              <h4 className="font-semibold">{c.name}</h4>
              <Badge variant={c.status === 'active' ? 'success' : 'secondary'}>{c.status}</Badge>
              {meteringBadge(c.meteringHoursBehind)}
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Users</span>
                <span>{c.users} / {c.maxUsers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last metered hour</span>
                <span>{c.lastMeteredHour ? new Date(c.lastMeteredHour).toLocaleString() : 'never'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last usage write</span>
                <span>{c.lastCollectionAt ? new Date(c.lastCollectionAt).toLocaleString() : 'never'}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Unresolved failures */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={18} className={data.unresolvedFailures.total > 0 ? 'text-quartz-label-orange' : 'text-primary'} />
          <h3 className="text-lg font-semibold">Unresolved health-check failures</h3>
          <Badge variant={data.unresolvedFailures.total > 0 ? 'destructive' : 'success'}>
            {data.unresolvedFailures.total}
          </Badge>
        </div>

        {data.unresolvedFailures.total === 0 ? (
          <p className="text-sm text-muted-foreground">All clear.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(data.unresolvedFailures.byType).map(([type, count]) => (
                <Badge key={type} variant="secondary">{type}: {count}</Badge>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unresolvedFailures.latest.map((f, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-4">{f.check_type}</td>
                      <td className="py-2 pr-4">{f.email}</td>
                      <td className="py-2 text-muted-foreground truncate max-w-md">{f.error_message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
