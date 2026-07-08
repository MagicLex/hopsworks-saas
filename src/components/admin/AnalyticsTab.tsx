import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Fixed segment order and hues — validated palette (CVD-safe, chroma/contrast
// pass on the light surface). Color follows the segment, never its rank.
const SEGMENTS = [
  { key: 'postpaid', label: 'Pay-as-you-go', color: '#1c9e74' },
  { key: 'prepaid', label: 'Corporate/promo', color: '#2f80ed' },
  { key: 'free', label: 'Free', color: '#d97a2e' },
  { key: 'limbo', label: 'No plan yet', color: '#9b51e0' },
] as const;

interface Consumer {
  id: string;
  email: string;
  segment: string;
  status: string;
  monthCost: number;
  monthCpuHours: number;
  lifetimeCost: number;
}

interface Analytics {
  currentMonth: string;
  monthly: Array<Record<string, number | string>>;
  segments: Array<{
    segment: string;
    users: number;
    active30d: number;
    consumingThisMonth: number;
    monthCost: number;
    avgMonthCostPerConsumer: number;
    avgLifetimeValue: number;
    medianLifetimeValue: number;
  }>;
  topBySegment: Record<string, Consumer[]>;
  cohorts: Array<{ month: string; size: number; activeNow: number; consumingNow: number }>;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export default function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/analytics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const suspend = async (consumer: Consumer) => {
    const reason = prompt(`Suspend ${consumer.email}?\n\nOptional reason:`);
    if (reason === null) return;
    setSuspending(consumer.id);
    try {
      const res = await fetch('/api/admin/suspend-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: consumer.id, reason: reason || 'admin_action' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'suspend failed');
      toast.success(`${consumer.email} suspended`);
      fetchAnalytics();
    } catch (err: any) {
      toast.error(`Failed to suspend: ${err.message}`);
    } finally {
      setSuspending(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8">Computing analytics...</p>;
  }
  if (error || !data) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive mb-3">{error || 'No data'}</p>
        <Button variant="secondary" onClick={fetchAnalytics}>Retry</Button>
      </div>
    );
  }

  const totals = data.segments.reduce(
    (acc, s) => ({
      monthCost: acc.monthCost + s.monthCost,
      consuming: acc.consuming + s.consumingThisMonth,
      users: acc.users + s.users,
    }),
    { monthCost: 0, consuming: 0, users: 0 }
  );
  const limbo = data.segments.find(s => s.segment === 'limbo');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Metered consumption value across all clusters, {data.currentMonth}. Stripe remains the
          invoice source of truth.
        </p>
        <Button variant="ghost" size="sm" onClick={fetchAnalytics}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Consumption this month"
          value={`$${totals.monthCost.toFixed(2)}`}
          hint="metered value, all segments"
        />
        <StatTile
          label="Consuming accounts"
          value={String(totals.consuming)}
          hint={`of ${totals.users} account owners`}
        />
        <StatTile
          label="Avg $/consuming account"
          value={`$${totals.consuming ? (totals.monthCost / totals.consuming).toFixed(2) : '0.00'}`}
        />
        <StatTile
          label="Accounts without a plan"
          value={String(limbo?.users ?? 0)}
          hint="billing_mode NULL (limbo)"
        />
      </div>

      {/* Monthly trend by segment */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Monthly consumption by segment</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#6b7280" />
              <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" tickFormatter={v => `$${v}`} />
              <Tooltip
                formatter={(value: number, name: string) => [`$${Number(value).toFixed(2)}`, name]}
                contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SEGMENTS.map(s => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="cost"
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Segment economics */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Segment economics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-4">Segment</th>
                <th className="py-2 pr-4 text-right">Accounts</th>
                <th className="py-2 pr-4 text-right">Active 30d</th>
                <th className="py-2 pr-4 text-right">Consuming</th>
                <th className="py-2 pr-4 text-right">This month</th>
                <th className="py-2 pr-4 text-right">Avg $/consumer</th>
                <th className="py-2 pr-4 text-right">Avg lifetime value</th>
                <th className="py-2 text-right">Median LTV</th>
              </tr>
            </thead>
            <tbody>
              {data.segments.map(s => {
                const seg = SEGMENTS.find(x => x.key === s.segment);
                return (
                  <tr key={s.segment} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: seg?.color }} />
                        {seg?.label ?? s.segment}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right">{s.users}</td>
                    <td className="py-2 pr-4 text-right">{s.active30d}</td>
                    <td className="py-2 pr-4 text-right">{s.consumingThisMonth}</td>
                    <td className="py-2 pr-4 text-right">${s.monthCost.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">${s.avgMonthCostPerConsumer.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">${s.avgLifetimeValue.toFixed(2)}</td>
                    <td className="py-2 text-right">${s.medianLifetimeValue.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Lifetime value = cumulative metered consumption per ever-consuming account (usage history window).
        </p>
      </Card>

      {/* Top consumers per segment */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(['postpaid', 'prepaid', 'free'] as const).map(key => {
          const seg = SEGMENTS.find(s => s.key === key)!;
          const rows = data.topBySegment[key] ?? [];
          return (
            <Card key={key} className="p-4">
              <h4 className="font-semibold mb-3 inline-flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: seg.color }} />
                Top {seg.label}
              </h4>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No consumption this month.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {rows.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{c.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.monthCpuHours}h CPU · lifetime ${c.lifetimeCost.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-medium">${c.monthCost.toFixed(2)}</span>
                        {c.status === 'suspended' ? (
                          <Badge variant="secondary">suspended</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Suspend ${c.email}`}
                            disabled={suspending === c.id}
                            onClick={() => suspend(c)}
                          >
                            <Ban size={14} className="text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Signup cohorts */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Signup cohorts (retention)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-4">Cohort</th>
                <th className="py-2 pr-4 text-right">Signups</th>
                <th className="py-2 pr-4 text-right">Active now (30d login)</th>
                <th className="py-2 text-right">Consuming this month</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map(c => (
                <tr key={c.month} className="border-b last:border-0">
                  <td className="py-2 pr-4">{c.month}</td>
                  <td className="py-2 pr-4 text-right">{c.size}</td>
                  <td className="py-2 pr-4 text-right">
                    {c.activeNow} ({c.size ? Math.round((c.activeNow / c.size) * 100) : 0}%)
                  </td>
                  <td className="py-2 text-right">
                    {c.consumingNow} ({c.size ? Math.round((c.consumingNow / c.size) * 100) : 0}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
