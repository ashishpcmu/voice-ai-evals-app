import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Sparkles, Upload, Download, Edit, Trash2, Beaker } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { SkeletonTable } from '../../components/ui/Skeleton';
import AIGeneratePanel from './AIGeneratePanel';
import BulkImport from './BulkImport';
import { getScenarios, deleteScenario, getAgents } from '../../api/client';
import type { Scenario, Agent } from '../../types';

function statusBadge(status: string) {
  switch (status) {
    case 'active': return <Badge variant="green">Active</Badge>;
    case 'draft': return <Badge variant="gray">Draft</Badge>;
    case 'archived': return <Badge variant="amber">Archived</Badge>;
    default: return <Badge variant="gray">{status}</Badge>;
  }
}

function outcomeBadge(type: string) {
  switch (type) {
    case 'natural_language': return <Badge variant="blue">Natural Language</Badge>;
    case 'tool_call': return <Badge variant="teal">Tool Call</Badge>;
    case 'kpi_threshold': return <Badge variant="amber">KPI Threshold</Badge>;
    default: return <Badge variant="gray">{type}</Badge>;
  }
}

export default function ScenarioList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: getAgents });
  const agentId = agents?.[0]?.id;

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['scenarios', statusFilter],
    queryFn: () => getScenarios({ ...(statusFilter ? { status: statusFilter } : {}) }),
    enabled: true
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScenario(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast.success('Scenario deleted');
      setDeleteId(null);
    }
  });

  const filtered = (scenarios || []).filter((s: Scenario) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.seed_utterance?.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <SkeletonTable rows={5} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Scenarios</h1>
          <p className="page-subtitle">{scenarios?.length || 0} scenarios configured</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => window.open('/api/scenarios/export/template', '_blank')}>
            <Download size={14} />
            Template
          </Button>
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} />
            Import CSV
          </Button>
          <Button variant="secondary" onClick={() => setShowGenerate(true)}>
            <Sparkles size={16} />
            AI Generate
          </Button>
          <Button onClick={() => navigate('/scenarios/new')}>
            <Plus size={16} />
            New Scenario
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card padding={false}>
        <div className="px-4 py-3 border-b border-brand-border flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-text" />
            <input
              type="text"
              placeholder="Search scenarios..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-8"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="select w-36"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          {(search || statusFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter(''); }}>
              Clear filters
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Beaker}
            title="No scenarios found"
            description="Create your first scenario or use AI to generate scenarios automatically."
            action={{ label: 'Create Scenario', onClick: () => navigate('/scenarios/new') }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium">Scenario Name</th>
                  <th className="px-4 py-3 text-left font-medium">Seed Utterance</th>
                  <th className="px-4 py-3 text-left font-medium">Outcome Type</th>
                  <th className="px-4 py-3 text-left font-medium">Tags</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((scenario: Scenario, i: number) => (
                  <tr
                    key={scenario.id}
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-light-blue transition-colors`}
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-dark-text">{scenario.name}</div>
                      {scenario.description && (
                        <div className="text-xs text-gray-text mt-0.5 truncate max-w-[200px]">{scenario.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-text truncate max-w-[200px]">{scenario.seed_utterance}</div>
                    </td>
                    <td className="px-4 py-3">{outcomeBadge(scenario.expected_outcome_type)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {scenario.tags?.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="gray">{tag}</Badge>
                        ))}
                        {(scenario.tags?.length || 0) > 3 && (
                          <Badge variant="gray">+{(scenario.tags?.length || 0) - 3}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(scenario.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => navigate(`/scenarios/${scenario.id}/edit`)}
                          className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-blue-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteId(scenario.id)}
                          className="p-1.5 text-gray-text hover:text-error-red hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
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

      {showGenerate && (
        <AIGeneratePanel
          agentId={agentId}
          onClose={() => setShowGenerate(false)}
        />
      )}

      {showImport && (
        <BulkImport
          agentId={agentId}
          onClose={() => setShowImport(false)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Scenario"
        message="Are you sure you want to delete this scenario? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
