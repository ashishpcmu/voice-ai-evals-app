import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Archive, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { getMetrics, updateMetric } from '../../api/client';
import type { Metric } from '../../types';

export default function MetricsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const { data: metrics, isLoading } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => updateMetric(id, { status: 'archived', name: '', type: 'conversation' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      toast.success('Metric archived');
      setArchiveId(null);
    }
  });

  if (isLoading) return <SkeletonTable rows={3} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Metrics Library</h1>
          <p className="page-subtitle">{metrics?.length || 0} active metrics</p>
        </div>
        <Button onClick={() => navigate('/metrics/new')}>
          <Plus size={16} />
          New Metric
        </Button>
      </div>

      <Card padding={false}>
        {!metrics?.length ? (
          <EmptyState
            icon={BarChart3}
            title="No metrics defined"
            description="Create custom metrics to evaluate your AI agent conversations."
            action={{ label: 'Create Metric', onClick: () => navigate('/metrics/new') }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric: Metric, i: number) => (
                  <tr key={metric.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-light-blue transition-colors`}>
                    <td className="px-6 py-3 text-sm font-medium text-dark-text">{metric.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-text max-w-md truncate">{metric.description || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={metric.type === 'conversation' ? 'blue' : 'teal'}>
                        {metric.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={metric.status === 'active' ? 'green' : 'gray'}>{metric.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => navigate(`/metrics/${metric.id}/edit`)}
                          className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-blue-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => setArchiveId(metric.id)}
                          className="p-1.5 text-gray-text hover:text-warning-amber hover:bg-amber-50 rounded transition-colors"
                          title="Archive"
                        >
                          <Archive size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!archiveId}
        onClose={() => setArchiveId(null)}
        onConfirm={() => archiveId && archiveMutation.mutate(archiveId)}
        title="Archive Metric"
        message="Are you sure you want to archive this metric? It will no longer appear in new runs."
        confirmLabel="Archive"
        variant="primary"
        loading={archiveMutation.isPending}
      />
    </div>
  );
}
