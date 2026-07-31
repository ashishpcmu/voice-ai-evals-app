import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, CheckCircle, XCircle, ChevronRight, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import TranscriptViewer from '../../components/shared/TranscriptViewer';
import {
  getEvalRun,
  startHumanReview,
  getReviewQueue,
  submitRating,
  generateDisagreementReport,
  getDisagreementReport,
  getTrialResult
} from '../../api/client';
import type { TrialResult, FullTrialResult } from '../../types';

interface ReviewSession {
  queue: TrialResult[];
  total: number;
  rater_name: string;
}

interface DisagreementReport {
  disagreement_rate: number;
  kappa_score: number;
  kappa_label: string;
  agreement_rate: number;
  total_rated: number;
  false_positives: Array<{ scenario_name: string; kpi_score: number; human_comment: string }>;
  false_negatives: Array<{ scenario_name: string; kpi_score: number; human_comment: string }>;
  summary: string;
}

export default function HumanReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<'configure' | 'review' | 'results'>('configure');
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [comment, setComment] = useState('');
  const [raterName, setRaterName] = useState('');
  const [n, setN] = useState(20);
  const [sampling, setSampling] = useState('random');
  const [report, setReport] = useState<DisagreementReport | null>(null);

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['eval-run', id],
    queryFn: () => getEvalRun(id!),
    enabled: !!id
  });

  const currentTrialId = session?.queue[currentIndex]?.id;
  const { data: currentTrial } = useQuery({
    queryKey: ['trial', currentTrialId],
    queryFn: () => getTrialResult(currentTrialId!),
    enabled: !!currentTrialId
  });

  const startMutation = useMutation({
    mutationFn: () => startHumanReview(id!, { n, sampling_strategy: sampling, rater_name: raterName }),
    onSuccess: (data) => {
      setSession(data);
      setCurrentIndex(0);
      setPhase('review');
    }
  });

  const rateMutation = useMutation({
    mutationFn: (rating: 'pass' | 'fail') => submitRating(id!, {
      trial_result_id: session!.queue[currentIndex].id,
      rating,
      comment,
      rater_name: raterName
    }),
    onSuccess: () => {
      setComment('');
      if (currentIndex < (session?.queue.length || 0) - 1) {
        setCurrentIndex(i => i + 1);
      } else {
        toast.success('Review complete! Generate disagreement report.');
      }
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => generateDisagreementReport(id!),
    onSuccess: (data) => {
      setReport(data);
      setPhase('results');
    }
  });

  const t = currentTrial as FullTrialResult | null;
  const currentTrialResult = session?.queue[currentIndex];
  const kpiPct = currentTrialResult?.kpi_score !== undefined ? Math.round(currentTrialResult.kpi_score * 100) : null;

  if (runLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/eval-runs/${id}`)} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={16} className="text-gray-text" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-dark-text">Human Review</h1>
          <div className="text-sm text-gray-text">{run?.name}</div>
        </div>
      </div>

      {/* Configure phase */}
      {phase === 'configure' && (
        <Card className="max-w-md">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-primary-blue" />
            <h3 className="text-sm font-semibold text-dark-text">Configure Review Session</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">Your Name</label>
              <input
                type="text"
                value={raterName}
                onChange={e => setRaterName(e.target.value)}
                className="input"
                placeholder="e.g. Sarah Johnson"
              />
            </div>
            <div>
              <label className="label">Number to Review (N)</label>
              <input type="number" min={1} max={100} value={n} onChange={e => setN(parseInt(e.target.value) || 20)} className="input" />
            </div>
            <div>
              <label className="label">Sampling Strategy</label>
              <select value={sampling} onChange={e => setSampling(e.target.value)} className="select">
                <option value="random">Random</option>
                <option value="lowest-confidence">Lowest Confidence (most ambiguous)</option>
              </select>
            </div>
            <Button
              className="w-full"
              onClick={() => startMutation.mutate()}
              loading={startMutation.isPending}
              disabled={!raterName}
            >
              Start Review Session
            </Button>
          </div>
        </Card>
      )}

      {/* Review phase */}
      {phase === 'review' && session && (
        <div className="space-y-4">
          {/* Progress */}
          <Card className="py-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-dark-text">
                Reviewing {currentIndex + 1} of {session.queue.length}
              </span>
              <span className="text-xs text-gray-text">Rater: {raterName}</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-blue rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex) / session.queue.length) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-gray-text">{currentIndex} rated</span>
              <span className="text-xs text-gray-text">{session.queue.length - currentIndex} remaining</span>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-6">
            {/* Transcript */}
            <div className="col-span-2">
              {t ? (
                <TranscriptViewer
                  turns={t.turns || []}
                  toolCalls={t.tool_calls || []}
                  kbCalls={t.kb_calls || []}
                />
              ) : (
                <Skeleton className="h-[400px] rounded-xl" />
              )}
            </div>

            {/* Rating panel */}
            <div className="space-y-4">
              <Card className="py-4 px-5">
                <h3 className="text-sm font-semibold text-dark-text mb-3">LLM Judge Score</h3>
                {kpiPct !== null && (
                  <div className="mb-3">
                    <Badge variant={kpiPct >= 70 ? 'green' : kpiPct >= 30 ? 'amber' : 'red'} className="text-base px-3 py-1">
                      {kpiPct}%
                    </Badge>
                  </div>
                )}
                {currentTrialResult?.kpi_rationale && (
                  <p className="text-xs text-gray-600 leading-relaxed">{currentTrialResult.kpi_rationale as string}</p>
                )}
              </Card>

              <Card className="py-4 px-5">
                <h3 className="text-sm font-semibold text-dark-text mb-3">Your Rating</h3>
                <p className="text-xs text-gray-text mb-4">
                  Does this conversation meet the expected outcome? Use keyboard shortcuts: P=Pass, F=Fail
                </p>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Optional comment..."
                  className="textarea h-20 text-xs mb-3"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    className="w-full bg-success-green hover:bg-green-700"
                    onClick={() => rateMutation.mutate('pass')}
                    loading={rateMutation.isPending}
                  >
                    <CheckCircle size={14} />
                    Pass (P)
                  </Button>
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={() => rateMutation.mutate('fail')}
                    loading={rateMutation.isPending}
                  >
                    <XCircle size={14} />
                    Fail (F)
                  </Button>
                </div>
                <button
                  className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-gray-text hover:text-dark-text"
                  onClick={() => setCurrentIndex(i => Math.min(i + 1, session.queue.length - 1))}
                >
                  <ChevronRight size={12} /> Skip (N)
                </button>
              </Card>

              {currentIndex >= session.queue.length - 1 && (
                <Button
                  className="w-full"
                  onClick={() => generateMutation.mutate()}
                  loading={generateMutation.isPending}
                >
                  Calculate Disagreement
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results phase */}
      {phase === 'results' && report && (
        <div className="space-y-6">
          <div className="bg-primary-blue/5 border border-primary-blue/20 rounded-xl p-6">
            <h2 className="text-xl font-bold text-dark-text mb-1">{report.summary}</h2>
            <p className="text-sm text-gray-text">Based on {report.total_rated} human ratings</p>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Donut chart */}
            <Card className="flex flex-col items-center py-6">
              <h3 className="text-sm font-semibold text-dark-text mb-4">Agreement Rate</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Agreement', value: Math.round(report.agreement_rate * 100) },
                      { name: 'Disagreement', value: Math.round(report.disagreement_rate * 100) }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill="#059669" />
                    <Cell fill="#DC2626" />
                  </Pie>
                  <Tooltip formatter={v => [`${v}%`, '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center">
                <div className="text-2xl font-bold text-dark-text">{Math.round(report.agreement_rate * 100)}%</div>
                <div className="text-xs text-gray-text">κ = {report.kappa_score.toFixed(2)} ({report.kappa_label})</div>
              </div>
            </Card>

            {/* False Positives */}
            <Card padding={false}>
              <div className="px-4 py-3 border-b border-brand-border">
                <h3 className="text-sm font-semibold text-dark-text">
                  False Positives ({report.false_positives.length})
                </h3>
                <p className="text-xs text-gray-text">Judge said PASS, Human said FAIL</p>
              </div>
              <div className="divide-y divide-gray-100 max-h-[200px] overflow-y-auto">
                {report.false_positives.length === 0 ? (
                  <div className="p-4 text-xs text-gray-text text-center">None</div>
                ) : report.false_positives.map((fp, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="text-xs font-medium text-dark-text">{fp.scenario_name}</div>
                    <div className="text-xs text-gray-text mt-0.5">
                      LLM Score: {Math.round(fp.kpi_score * 100)}%
                      {fp.human_comment && ` · "${fp.human_comment}"`}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* False Negatives */}
            <Card padding={false}>
              <div className="px-4 py-3 border-b border-brand-border">
                <h3 className="text-sm font-semibold text-dark-text">
                  False Negatives ({report.false_negatives.length})
                </h3>
                <p className="text-xs text-gray-text">Judge said FAIL, Human said PASS</p>
              </div>
              <div className="divide-y divide-gray-100 max-h-[200px] overflow-y-auto">
                {report.false_negatives.length === 0 ? (
                  <div className="p-4 text-xs text-gray-text text-center">None</div>
                ) : report.false_negatives.map((fn, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="text-xs font-medium text-dark-text">{fn.scenario_name}</div>
                    <div className="text-xs text-gray-text mt-0.5">
                      LLM Score: {Math.round(fn.kpi_score * 100)}%
                      {fn.human_comment && ` · "${fn.human_comment}"`}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* AI suggestion */}
          <Card className="bg-light-blue border-primary-blue/20">
            <h3 className="text-sm font-semibold text-dark-text mb-2">AI Suggestion</h3>
            <p className="text-sm text-gray-600">
              {report.kappa_score < 0.4
                ? 'Low agreement detected. Consider refining the judge prompt to be more specific about what constitutes a passing conversation. Focus on clarifying edge cases and providing example pass/fail transcripts.'
                : report.kappa_score < 0.6
                ? 'Moderate agreement. The judge is generally aligned but has some systematic differences with human raters. Review false positive patterns to tighten the scoring criteria.'
                : 'Good agreement with human raters. The LLM judge is well-calibrated. Continue monitoring as you add new scenario types.'
              }
            </p>
          </Card>

          {/* Print button */}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => window.print()}>Print Calibration Report</Button>
          </div>
        </div>
      )}
    </div>
  );
}
