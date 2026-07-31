import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X, Eye, ArrowLeft, Users, Trash2, Phone, Radio, PhoneOff } from 'lucide-react';
import toast from 'react-hot-toast';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Skeleton } from '../../components/ui/Skeleton';
import { RecordingRow } from '../../components/shared/RecordingRow';
import { getEvalRun, getEvalRunResults, deleteEvalRun, getVoiceProgress, cancelLiveKitEvalRun } from '../../api/client';
import type { EvalRun, ScenarioResult, TrialResult } from '../../types';

interface LiveTurn { role: 'user' | 'agent'; content: string; timestamp_ms: number; }

const VOICE_STEPS = [
  { key: 'calling',     label: 'Initiating outbound call' },
  { key: 'in-progress', label: 'Conversation in progress' },
  { key: 'scoring',     label: 'Scoring conversation' },
  { key: 'completed',   label: 'Trial complete' },
];

function LiveKitTranscript({ turns }: { turns: LiveTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="text-xs text-gray-text italic text-center py-4">
        Waiting for first turn… transcript appears here as the conversation progresses.
      </div>
    );
  }
  return (
    <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
      {turns.map((t, i) => (
        <div
          key={i}
          className={`rounded-lg px-3 py-2 text-sm ${
            t.role === 'agent'
              ? 'bg-light-blue border border-primary-blue/20'
              : 'bg-gray-50 border border-brand-border'
          }`}
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-xs font-semibold uppercase tracking-wide ${
              t.role === 'agent' ? 'text-primary-blue' : 'text-gray-text'
            }`}>
              {t.role === 'agent' ? 'Agent (under test)' : 'Customer (simulator)'}
            </span>
            {typeof t.timestamp_ms === 'number' && t.timestamp_ms > 0 && (
              <span className="text-xs text-gray-text">T+{(t.timestamp_ms / 1000).toFixed(1)}s</span>
            )}
          </div>
          <div className="text-sm text-dark-text leading-snug">{t.content}</div>
        </div>
      ))}
    </div>
  );
}

function VoiceProgressCard({ runId, scenarioCount, isLiveKit }: { runId: string; scenarioCount: number; isLiveKit: boolean }) {
  const [ending, setEnding] = useState(false);
  const { data: progress } = useQuery({
    queryKey: ['voice-progress', runId],
    queryFn: () => getVoiceProgress(runId),
    refetchInterval: 3000,
  });

  const callStatus: string = progress?.callStatus ?? 'calling';
  const turnCount: number = progress?.turnCount ?? 0;
  const scenarioIndex: number = progress?.scenarioIndex ?? 0;
  const totalScenarios: number = progress?.totalScenarios ?? scenarioCount;
  const trialIndex: number = progress?.trialIndex ?? 0;
  const totalTrials: number = progress?.totalTrials ?? 1;
  const scenarioName: string = progress?.scenarioName ?? '';
  const liveTurns: LiveTurn[] = Array.isArray(progress?.turns) ? progress.turns : [];

  const currentStepIdx = VOICE_STEPS.findIndex(s => s.key === callStatus);
  const stepLabel = currentStepIdx >= 0 ? VOICE_STEPS[currentStepIdx].label : 'Initiating outbound call';

  // End-call only applies to LiveKit (in-process call we can cancel) and only
  // while a call is actually in flight (not while scoring / between trials).
  const canEndCall = isLiveKit && !!progress?.active && callStatus !== 'scoring' && callStatus !== 'completed';

  const handleEndCall = async () => {
    if (!confirm('End the current call now? This trial will be scored on whatever happened so far, and the run continues to the next trial.')) return;
    setEnding(true);
    try {
      await cancelLiveKitEvalRun(runId);
      toast.success('Ending call…');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to end call');
    } finally {
      setEnding(false);
    }
  };

  return (
    <Card className="flex flex-col items-center justify-center py-12">
      {/* Spinner with provider icon */}
      <div className="relative mb-6">
        <div className={`w-16 h-16 border-4 rounded-full animate-spin ${isLiveKit ? 'border-blue-200 border-t-primary-blue' : 'border-purple-200 border-t-purple-600'}`} />
        <div className="absolute inset-0 flex items-center justify-center">
          {isLiveKit ? <Radio size={22} className="text-primary-blue" /> : <Phone size={22} className="text-purple-600" />}
        </div>
      </div>

      <h3 className="text-base font-semibold text-dark-text mb-1">
        {isLiveKit ? 'LiveKit Voice Evaluation in Progress' : 'Voice Evaluation in Progress'}
      </h3>

      {/* Step label */}
      <p className={`text-sm font-medium mb-1 ${isLiveKit ? 'text-primary-blue' : 'text-purple-600'}`}>{stepLabel}</p>

      {/* Scenario + trial counter */}
      <p className="text-xs text-gray-text mb-3">
        Scenario {scenarioIndex} of {totalScenarios}
        {totalTrials > 1 ? ` · Trial ${trialIndex} of ${totalTrials}` : ''}
        {scenarioName ? ` — ${scenarioName}` : ''}
      </p>

      {/* Turn count */}
      {turnCount > 0 && (
        <p className="text-sm text-dark-text mb-4">
          <span className="font-semibold">{turnCount}</span> turn{turnCount !== 1 ? 's' : ''} captured so far…
        </p>
      )}

      {/* Progress dots */}
      <div className="flex items-center gap-2 mt-1">
        {VOICE_STEPS.map((step, i) => {
          const done = i < currentStepIdx;
          const active = i === currentStepIdx;
          const activeColor = isLiveKit ? 'bg-primary-blue ring-2 ring-blue-200' : 'bg-purple-600 ring-2 ring-purple-200';
          const doneColor = isLiveKit ? 'bg-primary-blue' : 'bg-purple-500';
          const lineColor = isLiveKit ? 'bg-primary-blue/60' : 'bg-purple-400';
          return (
            <div key={step.key} className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
                done ? doneColor : active ? activeColor : 'bg-gray-200'
              }`} />
              {i < VOICE_STEPS.length - 1 && (
                <div className={`w-6 h-0.5 ${done ? lineColor : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* LiveKit-only: live transcription + end-call button */}
      {isLiveKit && (
        <div className="w-full max-w-xl mt-8 border-t border-brand-border pt-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-dark-text">Live transcript</h4>
            <span className="text-xs text-gray-text">{liveTurns.length} turns</span>
          </div>
          <LiveKitTranscript turns={liveTurns} />
          {canEndCall && (
            <div className="flex justify-center mt-5">
              <button
                type="button"
                onClick={handleEndCall}
                disabled={ending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-error-red hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <PhoneOff size={14} />
                {ending ? 'Ending call…' : 'End call now'}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function KpiScoreBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return <span className="text-gray-text text-sm">—</span>;
  const pct = Math.round(score * 100);
  const variant = pct >= 70 ? 'green' : pct >= 30 ? 'amber' : 'red';
  return <Badge variant={variant}>{pct}%</Badge>;
}

function TalkRatioBar({ ratio }: { ratio?: number }) {
  if (!ratio) return <span className="text-gray-text text-sm">—</span>;
  const color = ratio >= 0.8 && ratio <= 2.0 ? 'bg-success-green' : ratio <= 3.5 ? 'bg-warning-amber' : 'bg-error-red';
  const width = Math.min(100, (ratio / 4) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-dark-text font-medium w-8">{ratio.toFixed(1)}</span>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function PassAtKTooltip({ value, label }: { value: number; label: string }) {
  return (
    <div className="group relative inline-flex items-center gap-1">
      <span className="text-sm font-medium text-dark-text">{Math.round(value * 100)}%</span>
      <div className="hidden group-hover:block absolute bottom-full left-0 mb-1 w-52 bg-dark-text text-white text-xs rounded-lg p-2 z-10">
        {label}
      </div>
    </div>
  );
}

export default function EvalRunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [passFail, setPassFail] = useState('');
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvalRun(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-runs'] });
      toast.success('Eval run deleted');
      navigate('/eval-runs');
    }
  });

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['eval-run', id],
    queryFn: () => getEvalRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as EvalRun | undefined;
      if (!data) return false;
      return data.status === 'running' || data.status === 'pending' ? 3000 : false;
    }
  });

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ['eval-run-results', id],
    queryFn: () => getEvalRunResults(id!),
    enabled: !!id && run?.status === 'complete',
    refetchInterval: run?.status === 'running' ? 5000 : false
  });

  const isLoading = runLoading || resultsLoading;

  const filteredResults = (results || []).filter((r: ScenarioResult) => {
    if (search && !r.scenario_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (passFail === 'pass' && r.pass_count < r.trials_run) return false;
    if (passFail === 'fail' && r.pass_count >= r.trials_run) return false;
    return true;
  });

  if (runLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!run) return <div className="text-gray-text">Run not found</div>;

  const summary = run.summary_metrics || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/eval-runs')} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={16} className="text-gray-text" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-dark-text">{run.name}</h1>
              {run.status === 'running' && <Badge variant="blue">Running...</Badge>}
              {run.status === 'complete' && <Badge variant="green">Complete</Badge>}
              {run.status === 'failed' && <Badge variant="red">Failed</Badge>}
              {run.status === 'pending' && <Badge variant="gray">Pending</Badge>}
            </div>
            <div className="text-sm text-gray-text mt-0.5">
              {run.scenario_ids?.length || 0} scenarios · {run.n_trials} trial{run.n_trials > 1 ? 's' : ''} each · pass@{run.k_threshold} · {
                run.mode === 'agent'
                  ? run.agent_type === 'voice'
                    ? run.voice_provider === 'livekit' ? 'Voice Agent mode (LiveKit)' : 'Voice Agent mode (Twilio)'
                    : run.agent_type === 'vapi'
                    ? 'Vapi Agent mode'
                    : `Agent mode (${run.agent_type === 'claude' ? 'Claude Sonnet' : run.agent_type === 'openai' ? 'OpenAI GPT-3.5' : 'Custom/Mock'})`
                  : run.mode + ' mode'
              }
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run.status === 'complete' && (
            <Button
              variant="secondary"
              onClick={() => navigate(`/eval-runs/${id}/human-review`)}
            >
              <Users size={16} />
              Human Review
            </Button>
          )}
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-error-red border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Eval Run"
        message="Are you sure you want to delete this eval run? All results and trial data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />

      {/* Summary cards */}
      {run.status === 'complete' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {[
            { label: 'Avg KPI Score', value: summary.avg_kpi ? `${Math.round(summary.avg_kpi * 100)}%` : '—' },
            { label: 'Pass Rate', value: summary.pass_rate ? `${Math.round(summary.pass_rate * 100)}%` : '—' },
            { label: 'Avg TTFT', value: summary.avg_ttft ? `${Math.round(summary.avg_ttft)}ms` : '—' },
            { label: 'Avg Latency', value: summary.avg_latency ? `${Math.round(summary.avg_latency)}ms` : '—' },
            { label: 'Total Call Duration', value: summary.total_duration_ms ? `${(summary.total_duration_ms / 1000).toFixed(1)}s` : '—' },
            { label: 'Total Turns', value: summary.total_turns != null ? `${summary.total_turns}` : '—' },
            { label: 'Total Cost', value: summary.total_cost ? `$${summary.total_cost.toFixed(4)}` : '—' },
          ].map(stat => (
            <Card key={stat.label} className="py-4 px-5">
              <div className="text-xs text-gray-text mb-1">{stat.label}</div>
              <div className="text-xl font-bold text-dark-text">{stat.value}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Running state */}
      {(run.status === 'running' || run.status === 'pending') && (
        (run.agent_type === 'voice' || run.agent_type === 'vapi')
          ? <VoiceProgressCard runId={id!} scenarioCount={run.scenario_ids?.length || 0} isLiveKit={run.agent_type === 'voice' && run.voice_provider === 'livekit'} />
          : (
            <Card className="flex flex-col items-center justify-center py-16">
              <div className="w-12 h-12 border-4 border-primary-blue border-t-transparent rounded-full animate-spin mb-4" />
              <h3 className="text-base font-semibold text-dark-text mb-2">Evaluation in Progress</h3>
              <p className="text-sm text-gray-text">Running simulations across {run.scenario_ids?.length || 0} scenarios...</p>
            </Card>
          )
      )}

      {/* Results table */}
      {run.status === 'complete' && (
        <Card padding={false}>
          {/* Filters */}
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
            <select value={passFail} onChange={e => setPassFail(e.target.value)} className="select w-32">
              <option value="">All</option>
              <option value="pass">Pass only</option>
              <option value="fail">Fail only</option>
            </select>
            {(search || passFail) && (
              <button onClick={() => { setSearch(''); setPassFail(''); }} className="text-xs text-primary-blue hover:underline flex items-center gap-1">
                <X size={12} /> Clear
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-gray-text text-sm">Loading results...</div>
          ) : filteredResults.length === 0 ? (
            <div className="p-8 text-center text-gray-text text-sm">No results available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-text border-b border-brand-border bg-gray-50">
                    <th className="px-6 py-3 text-left font-medium">Scenario</th>
                    <th className="px-4 py-3 text-left font-medium">Trials</th>
                    <th className="px-4 py-3 text-left font-medium">Pass</th>
                    <th className="px-4 py-3 text-left font-medium">pass@k</th>
                    <th className="px-4 py-3 text-left font-medium">KPI Score</th>
                    <th className="px-4 py-3 text-left font-medium">TTFT</th>
                    <th className="px-4 py-3 text-left font-medium">Latency</th>
                    <th className="px-4 py-3 text-left font-medium">Cost</th>
                    <th className="px-4 py-3 text-left font-medium">Talk Ratio</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                    <th className="px-4 py-3 text-left font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((result: ScenarioResult, i: number) => (
                    <>
                      <tr
                        key={result.scenario_id}
                        className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-light-blue transition-colors cursor-pointer`}
                        onClick={() => setExpandedScenario(expandedScenario === result.scenario_id ? null : result.scenario_id)}
                      >
                        <td className="px-6 py-3 text-sm font-medium text-dark-text">{result.scenario_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-text">{result.trials_run}/{result.trials_total}</td>
                        <td className="px-4 py-3 text-sm text-dark-text font-medium">{result.pass_count}</td>
                        <td className="px-4 py-3">
                          <PassAtKTooltip
                            value={result.pass_at_k}
                            label={`pass@${run.k_threshold}: P(at least ${run.k_threshold} of ${result.trials_run} trials pass)`}
                          />
                        </td>
                        <td className="px-4 py-3"><KpiScoreBadge score={result.avg_kpi} /></td>
                        <td className="px-4 py-3 text-sm text-gray-text">{result.avg_ttft ? `${result.avg_ttft}ms` : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-text">{result.avg_latency ? `${result.avg_latency}ms` : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-text">{result.total_cost ? `$${result.total_cost.toFixed(4)}` : '—'}</td>
                        <td className="px-4 py-3"><TalkRatioBar ratio={result.avg_talk_ratio} /></td>
                        <td className="px-4 py-3">
                          {result.trials?.[0] && (
                            <button
                              onClick={e => { e.stopPropagation(); navigate(`/trial/${result.trials[0].id}`); }}
                              className="p-1.5 text-gray-text hover:text-primary-blue hover:bg-blue-50 rounded transition-colors"
                              title="View trace"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(result.tags || []).map((tag: string) => (
                              <span
                                key={tag}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded trials */}
                      {expandedScenario === result.scenario_id && result.trials && (
                        <tr key={`${result.scenario_id}-expanded`}>
                          <td colSpan={11} className="px-6 py-3 bg-light-blue border-b border-brand-border">
                            <div className="text-xs font-semibold text-gray-text mb-2">Individual Trials</div>
                            <div className="space-y-1">
                              {result.trials.map((trial: TrialResult, ti: number) => (
                                <div
                                  key={trial.id}
                                  className="flex items-center gap-4 bg-white rounded-lg px-4 py-2 border border-brand-border hover:border-primary-blue cursor-pointer transition-colors"
                                  onClick={() => navigate(`/trial/${trial.id}`)}
                                >
                                  <span className="text-xs text-gray-text w-16">Trial {ti + 1}</span>
                                  <KpiScoreBadge score={trial.kpi_score} />
                                  <Badge variant={trial.pass_fail ? 'green' : 'red'}>
                                    {trial.pass_fail ? 'Pass' : 'Fail'}
                                  </Badge>
                                  {trial.nfr_metrics && (
                                    <>
                                      <span className="text-xs text-gray-text">TTFT: {trial.nfr_metrics.ttft}ms</span>
                                      <span className="text-xs text-gray-text">Latency: {trial.nfr_metrics.avg_latency}ms</span>
                                    </>
                                  )}
                                  <div className="ml-auto flex items-center gap-3">
                                    {trial.recording_session_id && (
                                      <RecordingRow
                                        sessionId={trial.recording_session_id}
                                        basePath={trial.recording_provider === 'livekit' ? '/livekit' : '/voice'}
                                        compact
                                      />
                                    )}
                                    <button
                                      onClick={e => { e.stopPropagation(); navigate(`/trial/${trial.id}`); }}
                                      className="flex items-center gap-1 text-xs text-primary-blue hover:underline"
                                    >
                                      <Eye size={11} /> View Trace
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
