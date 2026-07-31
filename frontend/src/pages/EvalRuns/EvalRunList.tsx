import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, PlayCircle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { SkeletonTable } from '../../components/ui/Skeleton';
import NewRunModal from './NewRunModal';
import { getEvalRuns, deleteEvalRun } from '../../api/client';
import type { EvalRun } from '../../types';

function statusBadge(status: string) {
  switch (status) {
    case 'complete': return <Badge variant="green">Complete</Badge>;
    case 'running': return <Badge variant="blue">Running</Badge>;
    case 'failed': return <Badge variant="red">Failed</Badge>;
    case 'pending': return <Badge variant="gray">Pending</Badge>;
    default: return <Badge variant="gray">{status}</Badge>;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EvalRunList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNewRun, setShowNewRun] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: runs, isLoading } = useQuery({ queryKey: ['eval-runs'], queryFn: () => getEvalRuns() });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEvalRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-runs'] });
      toast.success('Eval run deleted');
      setDeleteId(null);
    }
  });

  if (isLoading) return <SkeletonTable rows={5} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Eval Runs</h1>
          <p className="page-subtitle">{runs?.length || 0} runs</p>
        </div>
        <Button onClick={() => setShowNewRun(true)}>
          <Plus size={16} />
          New Eval Run
        </Button>
      </div>

      <Card padding={false}>
        {!runs?.length ? (
          <EmptyState
            icon={PlayCircle}
            title="No eval runs yet"
            description="Create your first eval run to test your AI agent scenarios."
            action={{ label: 'New Eval Run', onClick: () => setShowNewRun(true) }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium">Run Name</th>
                  <th className="px-4 py-3 text-left font-medium">Mode</th>
                  <th className="px-4 py-3 text-left font-medium">Scenarios</th>
                  <th className="px-4 py-3 text-left font-medium">Trials</th>
                  <th className="px-4 py-3 text-left font-medium">KPI Score</th>
                  <th className="px-4 py-3 text-left font-medium">Pass Rate</th>
                  <th className="px-4 py-3 text-left font-medium">TTFT</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run: EvalRun, i: number) => (
                  <tr
                    key={run.id}
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-light-blue cursor-pointer transition-colors`}
                    onClick={() => navigate(`/eval-runs/${run.id}`)}
                  >
                    <td className="px-6 py-3 text-sm font-medium text-dark-text">{run.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={run.mode === 'agent' ? (run.agent_type === 'vapi' ? 'teal' : run.agent_type === 'voice' ? 'purple' : 'blue') : run.mode === 'upload' ? 'teal' : 'gray'}>
                        {run.mode === 'agent'
                          ? run.agent_type === 'vapi'
                            ? 'Vapi Voice Agent'
                            : run.agent_type === 'voice'
                            ? 'Voice Agent'
                            : `Agent${run.agent_type && run.agent_type !== 'custom' ? ` · ${run.agent_type === 'claude' ? 'Claude' : 'OpenAI'}` : ''}`
                          : run.mode}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-text">{run.scenario_ids?.length || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-text">{run.n_trials}</td>
                    <td className="px-4 py-3 text-sm text-dark-text font-medium">
                      {run.summary_metrics?.avg_kpi !== undefined
                        ? `${Math.round(run.summary_metrics.avg_kpi * 100)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-dark-text">
                      {run.summary_metrics?.pass_rate !== undefined
                        ? `${Math.round(run.summary_metrics.pass_rate * 100)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-text">
                      {run.summary_metrics?.avg_ttft ? `${Math.round(run.summary_metrics.avg_ttft)}ms` : '—'}
                    </td>
                    <td className="px-4 py-3">{statusBadge(run.status)}</td>
                    <td className="px-4 py-3 text-xs text-gray-text">{formatDate(run.created_at)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setDeleteId(run.id)}
                        className="p-1.5 text-gray-text hover:text-error-red hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewRunModal
        isOpen={showNewRun}
        onClose={() => setShowNewRun(false)}
      />

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Eval Run"
        message="Are you sure you want to delete this eval run? All results and trial data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
