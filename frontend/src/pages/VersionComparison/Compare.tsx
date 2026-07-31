import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, Minus, AlertTriangle, GitCompare } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { getEvalRuns, compareRuns } from '../../api/client';
import type { EvalRun } from '../../types';

interface CompareResult {
  baseline_run: EvalRun;
  new_run: EvalRun;
  summary_comparison: Record<string, { baseline: number; new: number; diff: number; pct: number }>;
  scenario_comparisons: Array<{
    scenario_id: string;
    scenario_name: string;
    baseline_kpi: number;
    new_kpi: number;
    kpi_delta: number;
    direction: 'up' | 'down' | 'neutral';
    baseline_latency: number;
    new_latency: number;
    latency_delta: number;
  }>;
  regressions: Array<{ scenario_name: string; reason: string }>;
}

function DeltaCell({ diff, pct, lowerIsBetter = false }: { diff: number; pct: number; lowerIsBetter?: boolean }) {
  const isImprovement = lowerIsBetter ? diff < 0 : diff > 0;
  const isNeutral = Math.abs(pct) < 0.5;
  const color = isNeutral ? 'text-gray-text' : isImprovement ? 'text-success-green' : 'text-error-red';
  const Icon = isNeutral ? Minus : isImprovement ? ArrowUp : ArrowDown;

  return (
    <div className={`flex items-center gap-1 ${color}`}>
      <Icon size={12} />
      <span className="text-xs font-medium">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function Compare() {
  const [baselineId, setBaselineId] = useState('');
  const [newRunId, setNewRunId] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);

  const { data: runs } = useQuery({
    queryKey: ['eval-runs'],
    queryFn: () => getEvalRuns()
  });

  const completedRuns = (runs || []).filter((r: EvalRun) => r.status === 'complete');

  const compareMutation = useMutation({
    mutationFn: () => compareRuns({ baseline_run_id: baselineId, new_run_id: newRunId }),
    onSuccess: (data) => setResult(data)
  });

  const summaryLabels: Record<string, { label: string; unit: string; lowerIsBetter?: boolean }> = {
    kpi_score: { label: 'KPI Score', unit: '' },
    pass_rate: { label: 'Pass Rate', unit: '' },
    avg_ttft: { label: 'Avg TTFT', unit: 'ms', lowerIsBetter: true },
    avg_latency: { label: 'Avg Latency', unit: 'ms', lowerIsBetter: true },
    total_cost: { label: 'Total Cost', unit: '$', lowerIsBetter: true },
  };

  const formatSummaryValue = (key: string, val: number) => {
    if (key === 'kpi_score' || key === 'pass_rate') return `${Math.round(val * 100)}%`;
    if (key === 'total_cost') return `$${val.toFixed(4)}`;
    if (key.includes('ttft') || key.includes('latency')) return `${Math.round(val)}ms`;
    return val.toFixed(2);
  };

  const chartData = result?.scenario_comparisons.map(s => ({
    name: s.scenario_name.slice(0, 20) + (s.scenario_name.length > 20 ? '...' : ''),
    baseline: Math.round(s.baseline_kpi * 100),
    new: Math.round(s.new_kpi * 100),
  })) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Version Comparison</h1>
        <p className="page-subtitle">Compare two eval runs to identify regressions and improvements</p>
      </div>

      {/* Selector */}
      <Card>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="label">Baseline Run</label>
            <select value={baselineId} onChange={e => setBaselineId(e.target.value)} className="select">
              <option value="">Select baseline run...</option>
              {completedRuns.map((r: EvalRun) => (
                <option key={r.id} value={r.id}>{r.name} ({new Date(r.created_at).toLocaleDateString()})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">New Run</label>
            <select value={newRunId} onChange={e => setNewRunId(e.target.value)} className="select">
              <option value="">Select new run...</option>
              {completedRuns.map((r: EvalRun) => (
                <option key={r.id} value={r.id}>{r.name} ({new Date(r.created_at).toLocaleDateString()})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => compareMutation.mutate()}
            loading={compareMutation.isPending}
            disabled={!baselineId || !newRunId || baselineId === newRunId}
          >
            <GitCompare size={16} />
            Compare Runs
          </Button>
        </div>
      </Card>

      {!result && !compareMutation.isPending && (
        <EmptyState
          icon={GitCompare}
          title="Select two runs to compare"
          description="Choose a baseline run and a new run to see a detailed comparison of metrics, scenario performance, and regressions."
        />
      )}

      {result && (
        <div className="space-y-6">
          {/* Regressions callout */}
          {result.regressions.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-error-red" />
                <h3 className="text-sm font-semibold text-error-red">Regressions Detected ({result.regressions.length})</h3>
              </div>
              <div className="space-y-1">
                {result.regressions.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-medium text-dark-text">{r.scenario_name}</span>
                    <span className="text-error-red">{r.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-5 gap-4">
            {Object.entries(result.summary_comparison).map(([key, vals]) => {
              const meta = summaryLabels[key];
              if (!meta) return null;
              return (
                <Card key={key} className="py-4 px-4">
                  <div className="text-xs text-gray-text mb-2">{meta.label}</div>
                  <div className="text-lg font-bold text-dark-text mb-1">
                    {formatSummaryValue(key, vals.new)}
                  </div>
                  <div className="text-xs text-gray-text mb-1">
                    Baseline: {formatSummaryValue(key, vals.baseline)}
                  </div>
                  <DeltaCell diff={vals.diff} pct={vals.pct} lowerIsBetter={meta.lowerIsBetter} />
                </Card>
              );
            })}
          </div>

          {/* Chart */}
          <Card>
            <h3 className="text-sm font-semibold text-dark-text mb-4">KPI Score by Scenario</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={v => [`${v}%`, '']} />
                <Legend />
                <Bar dataKey="baseline" name="Baseline" fill="#6B7280" radius={[2, 2, 0, 0]} />
                <Bar dataKey="new" name="New Run" fill="#016D6A" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Per-scenario table */}
          <Card padding={false}>
            <div className="px-6 py-4 border-b border-brand-border">
              <h3 className="text-sm font-semibold text-dark-text">Per-Scenario Comparison</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                    <th className="px-6 py-3 text-left font-medium">Scenario</th>
                    <th className="px-4 py-3 text-left font-medium">Baseline KPI</th>
                    <th className="px-4 py-3 text-left font-medium">New KPI</th>
                    <th className="px-4 py-3 text-left font-medium">KPI Delta</th>
                    <th className="px-4 py-3 text-left font-medium">Baseline Latency</th>
                    <th className="px-4 py-3 text-left font-medium">New Latency</th>
                    <th className="px-4 py-3 text-left font-medium">Latency Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenario_comparisons.map((s, i) => (
                    <tr key={s.scenario_id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-6 py-3 text-sm font-medium text-dark-text">{s.scenario_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-text">{Math.round(s.baseline_kpi * 100)}%</td>
                      <td className="px-4 py-3 text-sm text-dark-text font-medium">{Math.round(s.new_kpi * 100)}%</td>
                      <td className="px-4 py-3">
                        <div className={`flex items-center gap-1 text-sm ${s.direction === 'up' ? 'text-success-green' : s.direction === 'down' ? 'text-error-red' : 'text-gray-text'}`}>
                          {s.direction === 'up' ? <ArrowUp size={12} /> : s.direction === 'down' ? <ArrowDown size={12} /> : <Minus size={12} />}
                          {s.kpi_delta > 0 ? '+' : ''}{Math.round(s.kpi_delta * 100)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-text">{s.baseline_latency}ms</td>
                      <td className="px-4 py-3 text-sm text-dark-text">{s.new_latency}ms</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={s.latency_delta > 0 ? 'text-error-red' : 'text-success-green'}>
                          {s.latency_delta > 0 ? '+' : ''}{s.latency_delta}ms
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
