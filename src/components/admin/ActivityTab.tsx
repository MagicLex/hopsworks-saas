import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ActivityEvent {
  event: string;
  email?: string | null;
  project_name?: string | null;
  created_at: string;
}

interface DailyRow {
  date: string;
  events: Record<string, number>;
  cost: number;
  cpuHours: number;
  namespaces: string[];
}

interface ActivityResponse {
  user: {
    id: string;
    email: string;
    billingMode: string | null;
    status: string;
    lastLoginAt: string | null;
    loginCount: number;
    createdAt: string;
  } | null;
  daily: DailyRow[] | null;
  events: ActivityEvent[];
}

const EVENT_TONE: Record<string, string> = {
  'user.created': 'success',
  'project.created': 'success',
  'user.deleted': 'destructive',
  'project.deleted': 'destructive',
  'project.member.removed': 'destructive',
};

function EventBadge({ event }: { event: string }) {
  return <Badge variant={(EVENT_TONE[event] as any) ?? 'secondary'}>{event}</Badge>;
}

export default function ActivityTab() {
  const [emailInput, setEmailInput] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(14);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = async (targetEmail: string, targetDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(targetDays) });
      if (targetEmail) params.set('email', targetEmail);
      const res = await fetch(`/api/admin/activity?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err: any) {
      setError(err.message || 'Failed to load activity');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity(email, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, days]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Input
            className="w-72"
            placeholder="user email (empty = global feed)"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setEmail(emailInput.trim())}
          />
          <Button size="sm" onClick={() => setEmail(emailInput.trim())}>
            <Search size={14} /> View
          </Button>
          {email && (
            <Button size="sm" variant="ghost" onClick={() => { setEmail(''); setEmailInput(''); }}>
              Clear
            </Button>
          )}
        </div>
        <select
          className="text-sm border rounded px-2 py-1.5 bg-background"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Cluster events are recorded since the activity log shipped; older history is compute-only.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8">Loading activity...</p>
      ) : error ? (
        <p className="text-sm text-destructive py-8">{error}</p>
      ) : !data ? null : (
        <>
          {/* Per-user header + daily rollup */}
          {data.user && (
            <>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{data.user.email}</span>
                  <Badge variant="secondary">{data.user.billingMode ?? 'no plan'}</Badge>
                  <Badge variant={data.user.status === 'active' ? 'success' : 'destructive'}>
                    {data.user.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {data.user.loginCount} logins · last{' '}
                    {data.user.lastLoginAt ? new Date(data.user.lastLoginAt).toLocaleDateString() : 'never'} ·
                    signed up {new Date(data.user.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Daily activity</h3>
                {data.daily && data.daily.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-2 pr-4">Day</th>
                          <th className="py-2 pr-4">Cluster events</th>
                          <th className="py-2 pr-4">Projects computing</th>
                          <th className="py-2 pr-4 text-right">CPU h</th>
                          <th className="py-2 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map(d => (
                          <tr key={d.date} className="border-b last:border-0 align-top">
                            <td className="py-2 pr-4 whitespace-nowrap">{d.date}</td>
                            <td className="py-2 pr-4">
                              {Object.keys(d.events).length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries(d.events).map(([ev, n]) => (
                                    <Badge key={ev} variant="secondary">
                                      {ev}{n > 1 ? ` ×${n}` : ''}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-4">
                              {d.namespaces.length ? d.namespaces.join(', ') : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 pr-4 text-right">{d.cpuHours || '—'}</td>
                            <td className="py-2 text-right">{d.cost ? `$${d.cost.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity in the window.</p>
                )}
              </Card>
            </>
          )}

          {/* Event feed */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {data.user ? 'Event log' : 'Recent cluster events (all users)'}
            </h3>
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded in the window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4">When</th>
                      <th className="py-2 pr-4">Event</th>
                      {!data.user && <th className="py-2 pr-4">User</th>}
                      <th className="py-2">Project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                        <td className="py-2 pr-4"><EventBadge event={e.event} /></td>
                        {!data.user && <td className="py-2 pr-4">{e.email ?? '—'}</td>}
                        <td className="py-2">{e.project_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
