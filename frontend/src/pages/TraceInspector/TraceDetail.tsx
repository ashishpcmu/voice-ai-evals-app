import { useState, useEffect } from 'react';
import { cartesiaVoiceName } from '../../constants/voices';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserCheck, Pin, Send, X, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import TagInput from '../../components/ui/TagInput';
import TranscriptViewer from '../../components/shared/TranscriptViewer';
import { getTrialResult, createAnnotation, assignTrial, updateTrialStatus, updateTrialTags, getSettings, getScenario, getEvalRun, getAgent, getMetrics } from '../../api/client';
import type { FullTrialResult, Annotation, Metric, MetricScore, KpiComponent, VapiTrace } from '../../types';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono text-gray-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function VapiTracePanelInline({ trace }: { trace: VapiTrace }) {
  const durationMs = trace.startedAt && trace.endedAt
    ? new Date(trace.endedAt).getTime() - new Date(trace.startedAt).getTime()
    : null;

  return (
    <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-dark-text">Vapi Agent Trace</h3>
        <div className="flex items-center gap-2">
          {trace.callId && <span className="text-xs text-gray-text font-mono">{trace.callId.slice(0, 8)}…</span>}
          {trace.endedReason && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200">{trace.endedReason}</span>
          )}
          {durationMs && <span className="text-xs text-gray-text">{(durationMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      {/* Cost breakdown */}
      {trace.costBreakdown && Object.keys(trace.costBreakdown).length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">Cost Breakdown</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(trace.costBreakdown).map(([k, v]) => (
              <div key={k} className="text-xs">
                <span className="text-gray-text">{k}: </span>
                <span className="font-semibold text-dark-text">${typeof v === 'number' ? v.toFixed(4) : v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool calls */}
      {trace.toolCalls && (
        <div>
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">
            Tool Calls ({trace.toolCalls.length})
          </p>
          {trace.toolCalls.length === 0 ? (
            <p className="text-xs text-gray-text italic">No tool calls recorded.</p>
          ) : (
            <div className="space-y-2">
              {trace.toolCalls.map((tc, i) => (
                <div key={i} className="border border-brand-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-brand-border">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tc.status === 'success' ? 'bg-green-500' : tc.status === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <code className="text-xs font-mono font-semibold text-dark-text">{tc.name}</code>
                    {tc.timestamp_ms > 0 && (
                      <span className="ml-auto text-xs text-gray-text">T+{(tc.timestamp_ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div>
                      <p className="text-xs font-medium text-gray-text mb-1">Input</p>
                      <JsonBlock value={tc.arguments} />
                    </div>
                    {tc.result != null && (
                      <div>
                        <p className="text-xs font-medium text-gray-text mb-1">Output</p>
                        <JsonBlock value={tc.result} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transcript */}
      {trace.vapiTranscript && trace.vapiTranscript.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">
            Vapi Transcript ({trace.vapiTranscript.length} turns)
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {trace.vapiTranscript.map((turn, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${turn.role === 'user' ? 'bg-gray-200 text-gray-600' : 'bg-primary-blue text-white'}`}>
                  {turn.role === 'user' ? 'C' : 'A'}
                </span>
                <div className="flex-1">
                  <span className="text-xs text-gray-400 mr-1">T+{(turn.timestamp_ms / 1000).toFixed(1)}s</span>
                  <span className="text-xs text-dark-text">{turn.content}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : trace.transcript ? (
        <div>
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">Vapi Transcript</p>
          <pre className="text-xs text-dark-text bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
            {trace.transcript}
          </pre>
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">Vapi Transcript</p>
          <p className="text-xs text-gray-text italic">No transcript available.</p>
        </div>
      )}

      {/* Analysis */}
      {trace.analysis && (trace.analysis.summary || trace.analysis.successEvaluation) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Vapi Analysis</p>
          {trace.analysis.summary && <p className="text-xs text-blue-700">{trace.analysis.summary}</p>}
          {trace.analysis.successEvaluation && (
            <p className="text-xs text-blue-600">Success: {trace.analysis.successEvaluation}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TraceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [noteText, setNoteText] = useState('');
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [pinnedTurnId, setPinnedTurnId] = useState<string | undefined>();
  const [showAssign, setShowAssign] = useState(false);
  const [assigneeName, setAssigneeName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [trialTags, setTrialTags] = useState<string[]>([]);
  const [tagsInitialized, setTagsInitialized] = useState(false);

  const { data: trial, isLoading } = useQuery({
    queryKey: ['trial', id],
    queryFn: () => getTrialResult(id!),
    enabled: !!id,
  });

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const teamMembers = settings?.team_members || [];

  const t_partial = trial as FullTrialResult | undefined;

  const { data: scenario } = useQuery({
    queryKey: ['scenario', t_partial?.scenario_id],
    queryFn: () => getScenario(t_partial!.scenario_id),
    enabled: !!t_partial?.scenario_id,
  });

  const { data: evalRun } = useQuery({
    queryKey: ['eval-run', t_partial?.run_id],
    queryFn: () => getEvalRun(t_partial!.run_id),
    enabled: !!t_partial?.run_id,
  });

  const { data: agent } = useQuery({
    queryKey: ['agent', evalRun?.test_agent_id],
    queryFn: () => getAgent(evalRun!.test_agent_id),
    enabled: !!evalRun?.test_agent_id,
  });

  const { data: allMetrics } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    enabled: !!scenario?.metric_ids?.length,
  });
  const scenarioMetrics: Metric[] = (allMetrics || []).filter((m: Metric) =>
    (scenario?.metric_ids || []).includes(m.id)
  );

  // Sync tags from loaded trial (only once)
  useEffect(() => {
    if (trial && !tagsInitialized) {
      setTrialTags((trial as FullTrialResult).tags || []);
      setTagsInitialized(true);
    }
  }, [trial, tagsInitialized]);

  const tagsMutation = useMutation({
    mutationFn: (tags: string[]) => updateTrialTags(id!, tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trial', id] });
      queryClient.invalidateQueries({ queryKey: ['eval-run-results'] });
      toast.success('Tags saved');
    }
  });

  const annotationMutation = useMutation({
    mutationFn: () => createAnnotation(id!, {
      note_text: noteText,
      tags: noteTags,
      turn_id: pinnedTurnId || null,
      author_name: 'Current User'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trial', id] });
      setNoteText('');
      setNoteTags([]);
      setPinnedTurnId(undefined);
      toast.success('Note added');
    }
  });

  const assignMutation = useMutation({
    mutationFn: () => assignTrial(id!, { assignee_name: assigneeName, due_date: dueDate || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trial', id] });
      setShowAssign(false);
      toast.success('Assigned successfully');
    }
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateTrialStatus(id!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trial', id] });
      toast.success('Status updated');
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2"><Skeleton className="h-[500px] rounded-xl" /></div>
          <Skeleton className="h-[500px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!trial) return <div className="text-gray-text">Trial not found</div>;

  const t = trial as FullTrialResult;
  const kpiPct = t.kpi_score !== undefined ? Math.round(t.kpi_score * 100) : null;
  const kpiVariant = kpiPct !== null ? (kpiPct >= 70 ? 'green' : kpiPct >= 30 ? 'amber' : 'red') as 'green' | 'amber' | 'red' : 'gray' as 'gray';
  const talkRatioWarning = settings?.settings?.talk_ratio_warning ? parseFloat(settings.settings.talk_ratio_warning) : 2.0;
  const talkRatioDanger = settings?.settings?.talk_ratio_danger ? parseFloat(settings.settings.talk_ratio_danger) : 3.5;
  const talkRatioColor = !t.talk_ratio ? 'text-gray-text' :
    t.talk_ratio > talkRatioDanger ? 'text-error-red' :
    t.talk_ratio > talkRatioWarning ? 'text-warning-amber' : 'text-success-green';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={16} className="text-gray-text" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-dark-text">Trace Inspector</h1>
          <div className="text-sm text-gray-text">Trial {t.trial_index + 1}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {kpiPct !== null && <Badge variant={kpiVariant}>KPI: {kpiPct}%</Badge>}
          <Badge variant={t.pass_fail ? 'green' : 'red'}>{t.pass_fail ? 'Pass' : 'Fail'}</Badge>
        </div>
      </div>

      {/* Eval score cards — uniform grid */}
      {(t.kpi_rationale || (t.metric_scores && t.metric_scores.length > 0)) && (
        <div className="flex flex-wrap gap-3">
          {/* Expected Outcome Score */}
          {t.kpi_rationale && (
            <div className="flex-1 min-w-[260px] rounded-xl bg-[#DBEAFE] border border-[#BFDBFE] shadow-sm py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-dark-navy">Expected Outcome Score</span>
                {kpiPct !== null && <Badge variant={kpiVariant}>{kpiPct}%</Badge>}
              </div>
              {t.kpi_components && t.kpi_components.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {t.kpi_components.map((c: KpiComponent, i: number) => {
                    const cpct = Math.round(c.score * 100);
                    const cv = cpct >= 70 ? 'green' : cpct >= 30 ? 'amber' : 'red';
                    return (
                      <div key={i} className="flex items-start justify-between gap-2 bg-white/50 rounded px-2 py-1.5">
                        <span className="text-xs text-[#6B7280] leading-relaxed flex-1">{c.component}</span>
                        <Badge variant={cv}>{cpct}%</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-[#6B7280] leading-relaxed border-t border-[#BFDBFE] pt-2">{t.kpi_rationale}</p>
            </div>
          )}

          {/* One card per metric */}
          {(t.metric_scores || []).map((m: MetricScore) => {
            const pct = Math.round(m.score * 100);
            const variant = pct >= 70 ? 'green' : pct >= 30 ? 'amber' : 'red';
            return (
              <div key={m.id} className="flex-1 min-w-[220px] rounded-xl bg-[#F0FAFB] border border-[#E5E7EB] shadow-sm py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-dark-navy">{m.name}</span>
                  <Badge variant={variant}>{pct}%</Badge>
                </div>
                <p className="text-xs text-[#6B7280] leading-relaxed">{m.rationale}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Transcript */}
        <div className="col-span-2 space-y-4">
          <TranscriptViewer
            turns={t.turns || []}
            toolCalls={t.tool_calls || []}
            kbCalls={t.kb_calls || []}
            onTurnClick={setPinnedTurnId}
            highlightedTurnId={pinnedTurnId}
          />

          {t.vapi_trace && <VapiTracePanelInline trace={t.vapi_trace} />}

          {pinnedTurnId && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 flex items-center gap-2 text-sm">
              <Pin size={13} className="text-yellow-600" />
              <span className="text-yellow-800">Turn pinned for annotation</span>
              <button onClick={() => setPinnedTurnId(undefined)} className="ml-auto text-yellow-600 hover:text-yellow-800">
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* NFR Metrics */}
          <Card className="py-4 px-5">
            <h3 className="text-sm font-semibold text-dark-text mb-3">Performance Metrics</h3>
            <div className="space-y-2">
              {[
                { label: 'TTFT', value: t.nfr_metrics?.ttft ? `${t.nfr_metrics.ttft}ms` : '—' },
                { label: 'Avg Latency', value: t.nfr_metrics?.avg_latency ? `${t.nfr_metrics.avg_latency}ms` : '—' },
                { label: 'E2E Latency', value: t.nfr_metrics?.e2e_latency ? `${(t.nfr_metrics.e2e_latency / 1000).toFixed(1)}s` : '—' },
                { label: 'Cost', value: t.nfr_metrics?.cost ? `$${t.nfr_metrics.cost.toFixed(4)}` : '—' },
                { label: 'Input Tokens', value: t.nfr_metrics?.input_tokens?.toLocaleString() || '—' },
                { label: 'Output Tokens', value: t.nfr_metrics?.output_tokens?.toLocaleString() || '—' },
                { label: 'Model Calls', value: t.nfr_metrics?.model_calls?.toString() || '—' },
                { label: 'Talk Ratio', value: t.talk_ratio?.toFixed(2) || '—', extraClass: talkRatioColor },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-text">{m.label}</span>
                  <span className={`text-xs font-semibold text-dark-text ${m.extraClass || ''}`}>{m.value}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Voice pipeline (LiveKit runs) */}
          {(() => {
            const vc = (evalRun as { voice_config?: { stt?: string; llm?: string; ttsProvider?: string; ttsVoice?: string | null; ttsSpeed?: number | null } } | undefined)?.voice_config;
            if (!vc) return null;
            const ttsValue = [
              vc.ttsProvider,
              vc.ttsProvider === 'cartesia' && vc.ttsVoice ? cartesiaVoiceName(vc.ttsVoice) : null,
              `${vc.ttsSpeed ?? 1}×`,
            ].filter(Boolean).join(' · ');
            return (
              <Card className="py-4 px-5">
                <h3 className="text-sm font-semibold text-dark-text mb-3">Voice Pipeline</h3>
                <div className="space-y-2">
                  {[
                    { label: 'STT', value: vc.stt || '—' },
                    { label: 'LLM (simulator)', value: vc.llm || '—' },
                    { label: 'TTS', value: ttsValue || '—' },
                  ].map(m => (
                    <div key={m.label} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                      <span className="text-xs text-gray-text">{m.label}</span>
                      <span className="text-xs font-semibold text-dark-text text-right ml-2">{m.value}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {/* Tags */}
          <Card className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-dark-text flex items-center gap-2">
                <Tag size={14} className="text-primary-blue" />
                Tags
              </h3>
              {tagsMutation.isPending && (
                <span className="text-xs text-gray-text">Saving...</span>
              )}
            </div>
            <TagInput
              value={trialTags}
              onChange={tags => {
                setTrialTags(tags);
              }}
              placeholder="Type and press Enter to add tags"
            />
            {trialTags.length !== (t.tags?.length ?? 0) ||
              trialTags.some(tag => !(t.tags || []).includes(tag)) ||
              (t.tags || []).some(tag => !trialTags.includes(tag)) ? (
              <button
                onClick={() => tagsMutation.mutate(trialTags)}
                disabled={tagsMutation.isPending}
                className="mt-2 w-full py-1.5 text-xs font-medium text-primary-blue border border-primary-blue/30 rounded-lg hover:bg-light-blue disabled:opacity-50 transition-colors"
              >
                Save Tags
              </button>
            ) : null}
          </Card>

          {/* Assignment */}
          <Card className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-dark-text">Assignment</h3>
              <button
                onClick={() => setShowAssign(!showAssign)}
                className="text-xs text-primary-blue hover:underline"
              >
                {t.assignment ? 'Reassign' : 'Assign'}
              </button>
            </div>

            {t.assignment ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-primary-blue rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-semibold">
                      {t.assignment.assignee_name?.charAt(0) || '?'}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-dark-text">{t.assignment.assignee_name}</div>
                    {t.assignment.due_date && (
                      <div className="text-xs text-gray-text">Due: {new Date(t.assignment.due_date).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>
                <select
                  value={t.assignment.status}
                  onChange={e => statusMutation.mutate(e.target.value)}
                  className="select text-xs"
                >
                  <option value="unassigned">Unassigned</option>
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
            ) : (
              <div className="text-xs text-gray-text">Not assigned</div>
            )}

            {showAssign && (
              <div className="mt-3 space-y-2 pt-3 border-t border-brand-border">
                <select
                  value={assigneeName}
                  onChange={e => setAssigneeName(e.target.value)}
                  className="select text-xs"
                >
                  <option value="">Select team member...</option>
                  {teamMembers.map((m: { id: string; name: string }) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="input text-xs"
                  placeholder="Due date (optional)"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => assignMutation.mutate()} loading={assignMutation.isPending} disabled={!assigneeName}>
                    <UserCheck size={12} />
                    Assign
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowAssign(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>

          {/* Annotations */}
          <Card className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-dark-text">Notes & Annotations</h3>
              <span className="text-xs text-gray-text">{t.annotations?.length || 0} notes</span>
            </div>

            {/* Existing annotations */}
            <div className="space-y-3 mb-4 max-h-[200px] overflow-y-auto">
              {(t.annotations || []).map((annotation: Annotation) => (
                <div key={annotation.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 bg-primary-blue/20 rounded-full flex items-center justify-center">
                      <span className="text-primary-blue text-xs font-semibold">
                        {(annotation.author_name || 'A').charAt(0)}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-dark-text">{annotation.author_name || 'Anonymous'}</span>
                    <span className="text-xs text-gray-text ml-auto">
                      {new Date(annotation.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{annotation.note_text}</p>
                  {annotation.tags && annotation.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {annotation.tags.map(tag => (
                        <Badge key={tag} variant="gray">{tag}</Badge>
                      ))}
                    </div>
                  )}
                  {annotation.turn_id && (
                    <div className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <Pin size={9} /> Pinned to turn
                    </div>
                  )}
                </div>
              ))}
              {(t.annotations?.length || 0) === 0 && (
                <div className="text-xs text-gray-text text-center py-2">No notes yet</div>
              )}
            </div>

            {/* Add note */}
            <div className="space-y-2 pt-3 border-t border-brand-border">
              {pinnedTurnId && (
                <div className="text-xs text-amber-600 flex items-center gap-1">
                  <Pin size={9} /> Note will be pinned to selected turn
                </div>
              )}
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                className="textarea h-20 text-xs"
                placeholder="Add a note..."
              />
              <TagInput value={noteTags} onChange={setNoteTags} placeholder="Add tags..." />
              <Button
                size="sm"
                className="w-full"
                onClick={() => annotationMutation.mutate()}
                loading={annotationMutation.isPending}
                disabled={!noteText.trim()}
              >
                <Send size={12} />
                Add Note
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom info: Scenario + Agent */}
      <div className="grid grid-cols-2 gap-4">
        {/* Scenario Details */}
        <Card className="py-4 px-5">
          <h3 className="text-sm font-semibold text-dark-text mb-3">Scenario Details</h3>
          {scenario ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-gray-text w-28 shrink-0">Name</span>
                <span className="text-xs font-medium text-dark-text text-right">{scenario.name}</span>
              </div>
              {scenario.description && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-text w-28 shrink-0">Description</span>
                  <span className="text-xs text-dark-text text-right">{scenario.description}</span>
                </div>
              )}
              {scenario.seed_utterance && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-text w-28 shrink-0">Seed Utterance</span>
                  <span className="text-xs text-dark-text text-right italic">"{scenario.seed_utterance}"</span>
                </div>
              )}
              {scenario.expected_outcome_type && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-text w-28 shrink-0">Outcome Type</span>
                  <span className="text-xs text-dark-text text-right capitalize">{scenario.expected_outcome_type.replace(/_/g, ' ')}</span>
                </div>
              )}
              {scenario.expected_outcome_value && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-text w-28 shrink-0">Expected Outcome</span>
                  <span className="text-xs text-dark-text text-right">{scenario.expected_outcome_value}</span>
                </div>
              )}
              {scenario.tags && scenario.tags.length > 0 && (
                <div className="flex items-start gap-4 pt-1">
                  <span className="text-xs text-gray-text w-28 shrink-0">Tags</span>
                  <div className="flex flex-wrap gap-1">
                    {scenario.tags.map((tag: string) => (
                      <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {scenarioMetrics.length > 0 && (
                <div className="flex items-start gap-4 pt-1">
                  <span className="text-xs text-gray-text w-28 shrink-0">Metrics</span>
                  <div className="flex flex-wrap gap-1">
                    {scenarioMetrics.map((m: Metric) => (
                      <span
                        key={m.id}
                        title={m.description || ''}
                        className="px-2 py-0.5 bg-blue-50 text-primary-blue text-xs rounded-full border border-blue-100"
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-text">Loading scenario...</div>
          )}
        </Card>

        {/* Agent Details */}
        <Card className="py-4 px-5">
          <h3 className="text-sm font-semibold text-dark-text mb-3">Agent Being Evaluated</h3>
          {agent ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-gray-text w-28 shrink-0">Name</span>
                <span className="text-xs font-medium text-dark-text text-right">{agent.name}</span>
              </div>
              {agent.description && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-gray-text w-28 shrink-0">Description</span>
                  <span className="text-xs text-dark-text text-right">{agent.description}</span>
                </div>
              )}
              {agent.agent_type === 'voice' ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs text-gray-text w-28 shrink-0">Type</span>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Voice Agent</span>
                  </div>
                  {agent.phone_number && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-gray-text w-28 shrink-0">Phone Number</span>
                      <span className="text-xs font-mono text-dark-text">{agent.phone_number}</span>
                    </div>
                  )}
                </>
              ) : agent.agent_type === 'vapi' ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-xs text-gray-text w-28 shrink-0">Type</span>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">Vapi Agent</span>
                  </div>
                  {agent.phone_number && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-gray-text w-28 shrink-0">Phone Number</span>
                      <span className="text-xs font-mono text-dark-text">{agent.phone_number}</span>
                    </div>
                  )}
                  {agent.vapi_assistant_id && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-gray-text w-28 shrink-0">Assistant ID</span>
                      <span className="text-xs font-mono text-dark-text">{agent.vapi_assistant_id.slice(0, 12)}…</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {agent.llm_type && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-gray-text w-28 shrink-0">LLM</span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${agent.llm_type === 'openai' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {agent.llm_type === 'openai' ? 'OpenAI GPT-3.5' : 'Claude Sonnet'}
                      </span>
                    </div>
                  )}
                  {agent.prompt && (
                    <div className="flex items-start gap-4 pt-1">
                      <span className="text-xs text-gray-text w-28 shrink-0">System Prompt</span>
                      <span className="text-xs text-gray-500 font-mono leading-relaxed line-clamp-4">{agent.prompt}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-text">
              {evalRun && !evalRun.test_agent_id ? 'No agent linked to this run.' : 'Loading agent...'}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
