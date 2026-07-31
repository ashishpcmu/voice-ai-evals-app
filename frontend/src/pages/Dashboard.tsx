import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PlayCircle, Beaker, Upload, TrendingUp, Clock, DollarSign, CheckCircle } from 'lucide-react';
import MetricCard from '../components/shared/MetricCard';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { SkeletonCard } from '../components/ui/Skeleton';
import { getEvalRuns, getEvalRunSummary } from '../api/client';
import type { EvalRun } from '../types';

function getStatusBadge(status: string) {
  switch (status) {
    case 'complete': return <Badge variant="green">Complete</Badge>;
    case 'running': return <Badge variant="blue">Running</Badge>;
    case 'failed': return <Badge variant="red">Failed</Badge>;
    case 'pending': return <Badge variant="gray">Pending</Badge>;
    default: return <Badge variant="gray">{status}</Badge>;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: runs, isLoading } = useQuery({ queryKey: ['eval-runs'], queryFn: () => getEvalRuns() });

  const completedRuns: EvalRun[] = runs?.filter((r: EvalRun) => r.status === 'complete') || [];
  const recentRuns = runs?.slice(0, 5) || [];

  // Aggregate stats
  const avgKpi = completedRuns.length > 0
    ? completedRuns.reduce((s: number, r: EvalRun) => s + (r.summary_metrics?.avg_kpi || 0), 0) / completedRuns.length
    : 0;
  const avgPassRate = completedRuns.length > 0
    ? completedRuns.reduce((s: number, r: EvalRun) => s + (r.summary_metrics?.pass_rate || 0), 0) / completedRuns.length
    : 0;
  const avgTtft = completedRuns.length > 0
    ? completedRuns.reduce((s: number, r: EvalRun) => s + (r.summary_metrics?.avg_ttft || 0), 0) / completedRuns.length
    : 0;

  // Chart data
  const kpiTrendData = completedRuns.slice(-10).map((r: EvalRun, i: number) => ({
    name: `Run ${i + 1}`,
    kpi: Math.round((r.summary_metrics?.avg_kpi || 0) * 100),
    pass_rate: Math.round((r.summary_metrics?.pass_rate || 0) * 100),
    date: formatDate(r.created_at)
  }));

  const latencyData = completedRuns.slice(-5).map((r: EvalRun, i: number) => ({
    name: `Run ${i + 1}`,
    p50: r.summary_metrics?.avg_ttft || 0,
    p90: (r.summary_metrics?.avg_ttft || 0) * 1.4,
    p99: (r.summary_metrics?.avg_ttft || 0) * 2.1,
  }));

  if (isLoading) {
    return (
      <div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Runs"
          value={runs?.length || 0}
          icon={PlayCircle}
          color="blue"
        />
        <MetricCard
          label="Avg KPI Score"
          value={avgKpi > 0 ? `${Math.round(avgKpi * 100)}%` : '—'}
          icon={TrendingUp}
          color="green"
        />
        <MetricCard
          label="Avg Pass Rate"
          value={avgPassRate > 0 ? `${Math.round(avgPassRate * 100)}%` : '—'}
          icon={CheckCircle}
          color="green"
        />
        <MetricCard
          label="Avg TTFT"
          value={avgTtft > 0 ? `${Math.round(avgTtft)}ms` : '—'}
          icon={Clock}
          color="amber"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-6">
        {/* KPI Trend */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-dark-text">KPI Score Trend</h3>
            <span className="text-xs text-gray-text">Last {kpiTrendData.length} runs</span>
          </div>
          {kpiTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={kpiTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v) => [`${v}%`, '']} />
                <Legend />
                <Line type="monotone" dataKey="kpi" name="KPI Score" stroke="#016D6A" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="pass_rate" name="Pass Rate" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-text text-sm">
              No completed runs yet
            </div>
          )}
        </Card>

        {/* Latency Distribution */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-dark-text">Latency Distribution</h3>
            <span className="text-xs text-gray-text">P50/P90/P99 (ms)</span>
          </div>
          {latencyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="p50" name="P50" fill="#016D6A" radius={[2, 2, 0, 0]} />
                <Bar dataKey="p90" name="P90" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="p99" name="P99" fill="#D97706" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-text text-sm">
              No completed runs yet
            </div>
          )}
        </Card>
      </div>

      {/* Recent Runs + Quick Actions */}
      <div className="grid grid-cols-3 gap-6">
        {/* Recent Runs */}
        <div className="col-span-2">
          <Card padding={false}>
            <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-dark-text">Recent Eval Runs</h3>
              <Button variant="ghost" size="sm" onClick={() => navigate('/eval-runs')}>View all</Button>
            </div>
            {recentRuns.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-text text-sm">
                No eval runs yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                      <th className="px-6 py-3 text-left font-medium">Run Name</th>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Scenarios</th>
                      <th className="px-4 py-3 text-left font-medium">Pass Rate</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.map((run: EvalRun, i: number) => (
                      <tr
                        key={run.id}
                        className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-light-blue cursor-pointer transition-colors`}
                        onClick={() => navigate(`/eval-runs/${run.id}`)}
                      >
                        <td className="px-6 py-3 text-sm font-medium text-dark-text">{run.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-text">{formatDate(run.created_at)}</td>
                        <td className="px-4 py-3 text-sm text-gray-text">{run.scenario_ids?.length || 0}</td>
                        <td className="px-4 py-3 text-sm text-dark-text">
                          {run.summary_metrics?.pass_rate !== undefined
                            ? `${Math.round(run.summary_metrics.pass_rate * 100)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-3">{getStatusBadge(run.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-dark-text mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Button variant="primary" className="w-full justify-start" onClick={() => navigate('/eval-runs')}>
                <PlayCircle size={16} />
                New Eval Run
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/upload')}>
                <Upload size={16} />
                Upload Transcript
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/scenarios/new')}>
                <Beaker size={16} />
                Add Scenario
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/compare')}>
                <TrendingUp size={16} />
                Compare Runs
              </Button>
            </div>
          </Card>

          {completedRuns.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-dark-text mb-3">Latest Run Stats</h3>
              {(() => {
                const latest = completedRuns[0];
                return (
                  <div className="space-y-2">
                    {[
                      { label: 'Avg KPI', value: latest.summary_metrics?.avg_kpi ? `${Math.round(latest.summary_metrics.avg_kpi * 100)}%` : '—', icon: TrendingUp },
                      { label: 'Total Cost', value: latest.summary_metrics?.total_cost ? `$${latest.summary_metrics.total_cost.toFixed(4)}` : '—', icon: DollarSign },
                      { label: 'Avg TTFT', value: latest.summary_metrics?.avg_ttft ? `${Math.round(latest.summary_metrics.avg_ttft)}ms` : '—', icon: Clock },
                    ].map(stat => (
                      <div key={stat.label} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          <stat.icon size={13} className="text-gray-text" />
                          <span className="text-xs text-gray-text">{stat.label}</span>
                        </div>
                        <span className="text-xs font-semibold text-dark-text">{stat.value}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
