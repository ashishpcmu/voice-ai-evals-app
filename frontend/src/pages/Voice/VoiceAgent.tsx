// ─── Vapi Agent Evaluation (Beta) ───────────────────────────────────────────
// Completely isolated from existing eval flows. Results are not persisted.

import { useState, useRef, useEffect } from 'react';
import { CARTESIA_VOICES } from '../../constants/voices';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Eye, EyeOff, Zap, CheckCircle, ChevronDown, ChevronUp,
  Clock, MessageSquare, PhoneCall, AlertTriangle, Settings, Radio,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getSettings } from '../../api/client';
import { RecordingRow, type RecordingState } from '../../components/shared/RecordingRow';

// ── API helpers (isolated, not part of main client) ──────────────────────────

const voiceApi = {
  getScenarios: () => api.get('/voice/scenarios').then(r => r.data),
  getMetrics: () => api.get('/voice/metrics').then(r => r.data),
  testConnection: (data: { apiKey: string; assistantId: string }) =>
    api.post('/voice/test-connection', data).then(r => r.data),
  evaluate: (data: {
    apiKey: string; assistantId: string; scenarioId: string; metricIds: string[];
  }) => api.post('/voice/evaluate', data).then(r => r.data),
  startTwilioEval: (data: {
    accountSid: string; authToken: string; fromNumber: string;
    toNumber: string; webhookBaseUrl: string; scenarioId: string; metricIds: string[];
    silenceTimeout?: number; mainAgentSpeaksFirst?: boolean;
    customPersona?: TwilioCustomPersona; customScenario?: TwilioCustomCallScenario;
  }) => api.post('/voice/evaluate-voice-twilio', data).then(r => r.data),
  startVapiEval: (data: {
    vapiApiKey: string; vapiAssistantId: string; toNumber: string;
    scenarioId: string; metricIds: string[];
    vapiSpeaksFirst?: boolean;
    silenceTimeout?: number;
    customPersona?: TwilioCustomPersona; customScenario?: TwilioCustomCallScenario;
  }) => api.post('/voice/evaluate-vapi', data).then(r => r.data),
  pollCallStatus: (sessionId: string) =>
    api.get(`/voice/call-status/${sessionId}`).then(r => r.data),
  cancelCall: (sessionId: string) =>
    api.post(`/voice/cancel/${sessionId}`).then(r => r.data),
  deleteRecording: (sessionId: string) =>
    api.delete(`/voice/recording/${sessionId}`).then(r => r.data),
  getVapiTrace: (sessionId: string) =>
    api.get(`/voice/vapi-trace/${sessionId}`).then(r => r.data),
  // ── Voice Agent (LiveKit) — isolated, hits /api/livekit/* ──
  startLiveKitEval: (data: {
    toNumber: string; scenarioId: string; metricIds: string[];
    silenceTimeout?: number; ttsProvider?: string; sttProvider?: string;
    mainAgentSpeaksFirst?: boolean; recordCall?: boolean; customerSimulatorModel?: string; ttsSpeed?: number; ttsVoice?: string;
  }) => api.post('/livekit/evaluate', data).then(r => r.data),
  pollLiveKitStatus: (sessionId: string) =>
    api.get(`/livekit/call-status/${sessionId}`).then(r => r.data),
  cancelLiveKit: (sessionId: string) =>
    api.post(`/livekit/cancel/${sessionId}`).then(r => r.data),
  testLiveKitConnection: () =>
    api.post('/livekit/test-connection', {}).then(r => r.data),
};

// ── Types ────────────────────────────────────────────────────────────────────

interface VapiScenario { id: string; name: string; description: string; seed: string; }
interface VapiMetric { id: string; name: string; description: string; }
interface Turn { role: 'user' | 'agent'; content: string; timestamp_ms: number; }
interface MetricResult extends VapiMetric { score: number; rationale: string; }
interface EvalResult {
  scenario: { name: string; description: string; seed: string; id?: string };
  persona?: { name: string; emotional_state: string };
  turns: Turn[];
  metrics: MetricResult[];
  duration_ms: number;
  turn_count: number;
  call_id?: string;
  ended_reason?: string;
  recording?: RecordingState;
  sessionId?: string;
}

interface TwilioCustomPersona {
  name: string; age: string; policy_number: string;
  emotional_state: string; otp: string; dob: string;
}

interface TwilioCustomCallScenario {
  reason: string; details: string; goal: string; opening_line: string;
}

interface VapiToolCallTrace {
  id: string;
  name: string;
  arguments: unknown;
  result: unknown;
  timestamp_ms: number;
  status: 'success' | 'pending' | 'error';
}

interface VapiTrace {
  callId: string;
  status: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: string;
  vapiTranscript: Array<{ role: 'bot' | 'user'; content: string; timestamp_ms: number }>;
  toolCalls: VapiToolCallTrace[];
  costBreakdown?: Record<string, number>;
  recordingUrl?: string;
}

const EMOTIONAL_STATES = ['calm', 'frustrated', 'confused', 'urgent', 'polite', 'anxious'];

type EvalMode = 'chat' | 'twilio-voice' | 'vapi' | 'livekit';

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = pct >= 70 ? 'bg-green-100 text-green-700 border-green-200'
    : pct >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-red-100 text-red-700 border-red-200';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>{pct}%</span>;
}

function TranscriptTurn({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user';
  const ms = turn.timestamp_ms;
  const time = ms > 0 ? (ms < 1000 ? `T+${ms}ms` : `T+${(ms / 1000).toFixed(1)}s`) : null;
  return (
    <div className={`flex gap-3 ${isUser ? '' : 'flex-row-reverse'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
        isUser ? 'bg-gray-200 text-gray-600' : 'bg-primary-blue text-white'
      }`}>{isUser ? 'C' : 'A'}</div>
      <div className={`max-w-[75%] ${isUser ? '' : 'items-end flex flex-col'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500">{isUser ? 'Customer (Simulator)' : 'Vapi Agent'}</span>
          {time && <span className="text-xs text-gray-400">{time}</span>}
        </div>
        <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${
          isUser ? 'bg-gray-100 text-dark-text rounded-tl-none' : 'bg-primary-blue text-white rounded-tr-none'
        }`}>{turn.content}</div>
      </div>
    </div>
  );
}

// ── Voice loading indicator ───────────────────────────────────────────────────

const CHAT_STEPS = ['Connecting to Vapi agent…', 'Running conversation (up to 20 turns)…', 'Scoring metrics…'];
const VOICE_STEPS = ['Initiating outbound call…', 'Waiting for agent to answer…', 'Conversation in progress…', 'Call ended — scoring metrics…', 'Done!'];

function LiveTranscript({ turns }: { turns: Turn[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length]);

  if (turns.length === 0) {
    return (
      <div className="text-xs text-gray-text italic text-center py-4">
        Waiting for first turn… transcript will appear here as the conversation progresses.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
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

function LoadingIndicator({ mode, turnCount, callStatus }: { mode: EvalMode; turnCount?: number; callStatus?: string }) {
  const steps = mode === 'chat' ? CHAT_STEPS : VOICE_STEPS;

  // Derive step from real call status for voice, or from a timer for chat
  const scoringStep = VOICE_STEPS.indexOf('Call ended — scoring metrics…');
  const [timerStep, setTimerStep] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timings = mode === 'chat' ? [2000, 8000] : [3000, 8000, 20000];
    timersRef.current = timings.map((ms, i) =>
      setTimeout(() => setTimerStep(i + 1), ms)
    );
    return () => timersRef.current.forEach(clearTimeout);
  }, [mode]);

  // Timer can only advance up to "Conversation in progress" (step 2).
  // "Call ended — scoring metrics" (step 3) is only shown via the real callStatus.
  const stepIndex = callStatus === 'scoring'
    ? scoringStep
    : Math.min(timerStep, scoringStep - 1);

  return (
    <div className="flex flex-col items-center justify-center gap-5 min-h-[400px]">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-primary-blue/20 border-t-primary-blue rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          {mode === 'chat' ? <MessageSquare size={20} className="text-primary-blue" /> : <PhoneCall size={20} className="text-primary-blue" />}
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-dark-text">{steps[Math.min(stepIndex, steps.length - 1)]}</p>
        {mode !== 'chat' && callStatus !== 'scoring' && (
          <p className="text-xs text-gray-text">Voice calls take 3–8 minutes to complete</p>
        )}
        {callStatus === 'scoring' && (
          <p className="text-xs text-gray-text">Scoring {turnCount} turns with OpenAI — usually under 30 seconds…</p>
        )}
        {turnCount !== undefined && turnCount > 0 && callStatus !== 'scoring' && (
          <p className="text-xs text-success-green font-medium">{turnCount} turns captured so far…</p>
        )}
      </div>
      <div className="flex gap-1.5 mt-1">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${
            i <= stepIndex ? 'w-5 bg-primary-blue' : 'w-1.5 bg-gray-200'
          }`} />
        ))}
      </div>
    </div>
  );
}

// ── Shared sub-panels ─────────────────────────────────────────────────────────

function ScenarioPanel({
  scenarios, selectedScenario, onSelect,
}: { scenarios: VapiScenario[]; selectedScenario: string; onSelect: (id: string) => void }) {
  return (
    <div className="bg-white border border-brand-border rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-dark-text">Select Scenario</h2>
      <div className="space-y-2">
        {scenarios.map(s => (
          <label key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            selectedScenario === s.id ? 'border-primary-blue bg-light-blue/40' : 'border-brand-border hover:border-primary-blue/40 hover:bg-light-blue/20'
          }`}>
            <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              selectedScenario === s.id ? 'border-primary-blue' : 'border-gray-300'
            }`}>
              {selectedScenario === s.id && <div className="w-2 h-2 rounded-full bg-primary-blue" />}
            </div>
            <input type="radio" name="scenario" value={s.id} checked={selectedScenario === s.id} onChange={() => onSelect(s.id)} className="hidden" />
            <div>
              <div className="text-sm font-medium text-dark-text">{s.name}</div>
              <div className="text-xs text-gray-text mt-0.5">{s.description}</div>
              <div className="text-xs text-gray-400 italic mt-1">"{s.seed}"</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function MetricsPanel({
  metrics, selectedMetrics, onToggle,
}: { metrics: VapiMetric[]; selectedMetrics: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="bg-white border border-brand-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-text">Metrics to Evaluate</h2>
        <button className="text-xs text-primary-blue hover:underline" onClick={() => {
          if (selectedMetrics.length === metrics.length) metrics.forEach(m => onToggle(m.id));
          else metrics.filter(m => !selectedMetrics.includes(m.id)).forEach(m => onToggle(m.id));
        }}>
          {selectedMetrics.length === metrics.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="space-y-2">
        {metrics.map(m => (
          <label key={m.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            selectedMetrics.includes(m.id) ? 'border-primary-blue bg-light-blue/40' : 'border-brand-border hover:border-primary-blue/40 hover:bg-light-blue/20'
          }`}>
            <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              selectedMetrics.includes(m.id) ? 'bg-primary-blue border-primary-blue' : 'border-gray-300'
            }`}>
              {selectedMetrics.includes(m.id) && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={selectedMetrics.includes(m.id)} onChange={() => onToggle(m.id)} className="hidden" />
            <div>
              <div className="text-sm font-medium text-dark-text">{m.name}</div>
              <div className="text-xs text-gray-text mt-0.5">{m.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ResultsPanel({ result, isVoice, recordingBasePath = '/voice' }: { result: EvalResult; isVoice?: boolean; recordingBasePath?: string }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="space-y-4">
      <div className="bg-white border border-brand-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-dark-text">Evaluation Results</h2>
              {isVoice && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs">
                  <PhoneCall size={10} /> Voice
                </span>
              )}
            </div>
            <p className="text-xs text-gray-text mt-0.5">
              Scenario: <span className="font-medium text-dark-text">{result.scenario.name}</span>
              <span className="mx-2">·</span>{result.turn_count} turns
              {result.duration_ms > 0 && <><span className="mx-2">·</span><Clock size={10} className="inline mr-0.5" />{(result.duration_ms / 1000).toFixed(1)}s</>}
              {result.ended_reason && <><span className="mx-2">·</span>ended: {result.ended_reason}</>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-text mb-1">Avg Score</div>
            <ScoreBadge score={result.metrics.reduce((s, m) => s + m.score, 0) / (result.metrics.length || 1)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {result.metrics.map(m => (
            <div key={m.id} className="border border-brand-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-dark-text">{m.name}</span>
                <ScoreBadge score={m.score} />
              </div>
              <p className="text-xs text-gray-text leading-relaxed">{m.rationale}</p>
            </div>
          ))}
        </div>
        {isVoice && result.recording && (
          <div className="mt-4 pt-4 border-t border-brand-border">
            <RecordingRow recording={result.recording} sessionId={result.sessionId} basePath={recordingBasePath} />
          </div>
        )}
      </div>
      <div className="bg-white border border-brand-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-brand-border cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpanded(v => !v)}>
          <h2 className="text-sm font-semibold text-dark-text">
            Conversation Transcript
            <span className="ml-2 text-xs font-normal text-gray-text">{result.turns.length} turns</span>
          </h2>
          {expanded ? <ChevronUp size={16} className="text-gray-text" /> : <ChevronDown size={16} className="text-gray-text" />}
        </div>
        {expanded && (
          <div className="p-5 space-y-4 max-h-[520px] overflow-y-auto">
            {result.turns.map((turn, i) => <TranscriptTurn key={i} turn={turn} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Vapi Trace Panel ──────────────────────────────────────────────────────────

function JsonBlock({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = JSON.stringify(value, null, 2);
  const short = JSON.stringify(value);
  const isLong = short.length > 60;
  if (!isLong) return <code className="text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded font-mono break-all">{short}</code>;
  return (
    <div>
      <button onClick={() => setExpanded(v => !v)} className="text-xs text-primary-blue hover:underline flex items-center gap-1">
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {expanded ? 'Collapse' : 'Expand JSON'}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs bg-gray-50 border border-gray-200 rounded-lg p-2.5 overflow-x-auto font-mono text-gray-700 max-h-48">{text}</pre>
      )}
    </div>
  );
}

function VapiTracePanel({ trace, loading, error, onRetry }: { trace: VapiTrace | null; loading: boolean; error?: string; onRetry?: () => void }) {
  if (loading) {
    return (
      <div className="bg-white border border-brand-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary-blue/30 border-t-primary-blue rounded-full animate-spin" />
          <h3 className="text-sm font-semibold text-dark-text">Fetching Vapi Agent Trace…</h3>
        </div>
        <p className="text-xs text-gray-text">Waiting for Vapi to finalize call record — retrying automatically if needed (up to 50s).</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-amber-700 mb-1">Vapi trace unavailable</p>
          <p className="text-xs text-amber-600">{error}</p>
          <p className="text-xs text-amber-500 mt-1">Make sure the Vapi webhook URL is set in Vapi Settings → Phone Numbers → Server URL.</p>
        </div>
        {onRetry && (
          <button onClick={onRetry} className="shrink-0 text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg border border-amber-300 transition-colors">
            Retry
          </button>
        )}
      </div>
    );
  }
  if (!trace) return null;

  const durationMs = trace.startedAt && trace.endedAt
    ? new Date(trace.endedAt).getTime() - new Date(trace.startedAt).getTime()
    : null;

  return (
    <div className="space-y-3">
      {/* Vapi metadata */}
      <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-dark-text">Vapi Agent Trace</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-text font-mono">{trace.callId.slice(0, 8)}…</span>
            {trace.endedReason && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200">{trace.endedReason}</span>
            )}
            {durationMs && (
              <span className="text-xs text-gray-text">{(durationMs / 1000).toFixed(1)}s</span>
            )}
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
        <div>
          <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">
            Tool Calls ({trace.toolCalls.length})
          </p>
          {trace.toolCalls.length === 0 ? (
            <p className="text-xs text-gray-text italic">No tool calls recorded for this call.</p>
          ) : (
            <div className="space-y-2">
              {trace.toolCalls.map((tc, i) => (
                <div key={i} className="border border-brand-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-brand-border">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tc.status === 'success' ? 'bg-success-green' : tc.status === 'error' ? 'bg-error-red' : 'bg-amber-400'}`} />
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
                    {tc.result !== null && (
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

        {/* Vapi transcript — structured messages preferred, plain text fallback */}
        {trace.vapiTranscript.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">
              Vapi Transcript
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {trace.vapiTranscript.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${t.role === 'user' ? 'bg-gray-200 text-gray-600' : 'bg-primary-blue text-white'}`}>
                    {t.role === 'user' ? 'C' : 'A'}
                  </span>
                  <div className="flex-1">
                    <span className="text-xs text-gray-400 mr-1">T+{(t.timestamp_ms / 1000).toFixed(1)}s</span>
                    <span className="text-xs text-dark-text">{t.content}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : trace.transcript ? (
          <div>
            <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">
              Vapi Transcript
            </p>
            <pre className="text-xs text-dark-text bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
              {trace.transcript}
            </pre>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-gray-text uppercase tracking-wide mb-2">Vapi Transcript</p>
            <p className="text-xs text-gray-text italic">No transcript available for this call.</p>
          </div>
        )}

        {trace.recordingUrl && (
          <a href={trace.recordingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary-blue hover:underline">
            🎵 Download Vapi Recording
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VoiceAgent() {
  const [evalMode, setEvalMode] = useState<EvalMode>('livekit');

  // Chat
  const [apiKey, setApiKey] = useState('');
  const [assistantId, setAssistantId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [connected, setConnected] = useState(false);

  // Twilio voice
  const [twilioToNumber, setTwilioToNumber] = useState('');
  const [silenceTimeout, setSilenceTimeout] = useState(3);
  const [twilioMainAgentSpeaksFirst, setTwilioMainAgentSpeaksFirst] = useState(true);

  // LiveKit voice (isolated tab)
  const [livekitToNumber, setLivekitToNumber] = useState('');
  const [livekitMainAgentSpeaksFirst, setLivekitMainAgentSpeaksFirst] = useState(true);
  // Record call OFF by default — recording consumes LiveKit egress minutes.
  const [livekitRecordCall, setLivekitRecordCall] = useState(false);
  // Customer simulator LLM for the LiveKit call (mirrors the Eval Run modal).
  const [livekitCustomerModel, setLivekitCustomerModel] = useState('gpt-4o-mini');
  // TTS provider for the LiveKit call: deepgram (fast) / cartesia (natural) / openai.
  const [livekitTtsProvider, setLivekitTtsProvider] = useState('deepgram');
  // TTS speaking speed (per selected provider; clamped per provider in the worker).
  const [livekitTtsSpeed, setLivekitTtsSpeed] = useState('1');
  // Cartesia voice ID (only used when ttsProvider=cartesia).
  const [livekitTtsVoice, setLivekitTtsVoice] = useState('5ee9feff-1265-424a-9d7f-8e4d431a12c7');
  const [twilioScenarioMode, setTwilioScenarioMode] = useState<'preset' | 'custom'>('preset');
  const [twilioCustomPersona, setTwilioCustomPersona] = useState<TwilioCustomPersona>({
    name: 'James Hartley',
    age: '40',
    policy_number: 'SFG-2291-7743',
    emotional_state: 'frustrated',
    otp: '',
    dob: '12 March 1985',
  });
  const [twilioCustomScenario, setTwilioCustomScenario] = useState<TwilioCustomCallScenario>({
    reason: 'Cancel Safeguard Insurance policy due to undisclosed charges',
    details: 'Customer was not informed about a $25/month Policy Administration Fee and a $15/month Emergency Response Surcharge at the time of purchase. These charges appeared from month 3 onwards. Customer noticed them only recently and feels misled. Will agree to stay only if agent proactively offers a discount of at least 15% off the monthly premium — will not ask for it themselves.',
    goal: 'Cancel the policy, or stay if agent proactively offers ≥15% discount unprompted',
    opening_line: "Hi, I'm calling because I want to cancel my Safeguard Insurance policy. I've been charged fees that nobody told me about when I signed up, and I'm really not happy about it.",
  });
  const updateTwilioCustomPersona = (field: keyof TwilioCustomPersona, value: string) =>
    setTwilioCustomPersona(prev => ({ ...prev, [field]: value }));
  const updateTwilioCustomScenario = (field: keyof TwilioCustomCallScenario, value: string) =>
    setTwilioCustomScenario(prev => ({ ...prev, [field]: value }));

  // Vapi Agent tab
  const [vapiApiKey, setVapiApiKey] = useState('');
  const [vapiAssistantId, setVapiAssistantId] = useState('');
  const [showVapiApiKey, setShowVapiApiKey] = useState(false);
  const [vapiToNumber, setVapiToNumber] = useState('');
  const [vapiSpeaksFirst, setVapiSpeaksFirst] = useState(true);
  const [vapiTrace, setVapiTrace] = useState<VapiTrace | null>(null);
  const [vapiTraceLoading, setVapiTraceLoading] = useState(false);
  const [vapiTraceError, setVapiTraceError] = useState<string | undefined>();
  const [lastVapiSessionId, setLastVapiSessionId] = useState<string | null>(null);

  // Shared eval state
  const [selectedScenario, setSelectedScenario] = useState('');
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [result, setResult] = useState<EvalResult | null>(null);

  // Twilio polling state
  const [twilioSessionId, setTwilioSessionId] = useState<string | null>(null);
  const [twilioStatus, setTwilioStatus] = useState<string>('');
  const [twilioTurnCount, setTwilioTurnCount] = useState(0);
  const [liveTurns, setLiveTurns] = useState<Turn[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: scenarios = [] } = useQuery<VapiScenario[]>({ queryKey: ['voice-scenarios'], queryFn: voiceApi.getScenarios });
  const { data: appSettings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const twilioAccountSid: string = appSettings?.settings?.twilio_account_sid || '';
  const twilioAuthToken: string = appSettings?.settings?.twilio_auth_token || '';
  const twilioFromNumber: string = appSettings?.settings?.twilio_from_number || '';
  const webhookBaseUrl: string = appSettings?.settings?.twilio_webhook_url || '';
  const twilioCredsConfigured = !!(twilioAccountSid && twilioAuthToken && twilioFromNumber && webhookBaseUrl);
  const savedVapiApiKey: string = appSettings?.settings?.vapi_api_key || '';
  const savedVapiAssistantId: string = appSettings?.settings?.vapi_assistant_id || '';

  // LiveKit (Voice Agent — LiveKit tab) config presence check
  const livekitUrl: string = appSettings?.settings?.livekit_url || '';
  const livekitApiKey: string = appSettings?.settings?.livekit_api_key || '';
  const livekitApiSecret: string = appSettings?.settings?.livekit_api_secret || '';
  const livekitSipTrunkId: string = appSettings?.settings?.livekit_sip_trunk_id || '';
  const livekitConfigured = !!(livekitUrl && livekitApiKey && livekitApiSecret && livekitSipTrunkId);

  // Pre-populate Vapi fields from saved settings (only on first load)
  useEffect(() => {
    if (savedVapiApiKey) setVapiApiKey(v => v || savedVapiApiKey);
    if (savedVapiAssistantId) setVapiAssistantId(v => v || savedVapiAssistantId);
  }, [savedVapiApiKey, savedVapiAssistantId]);
  const { data: metrics = [] } = useQuery<VapiMetric[]>({ queryKey: ['voice-metrics'], queryFn: voiceApi.getMetrics });

  const toggleMetric = (id: string) =>
    setSelectedMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);

  const switchMode = (mode: EvalMode) => {
    setEvalMode(mode);
    setResult(null);
    setConnected(false);
    setVapiTrace(null);
    setVapiTraceError(undefined);
    stopPolling();
  };

  // ── Polling for Twilio calls ──
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setTwilioSessionId(null);
  };

  const startPolling = (
    sessionId: string,
    onCompleted?: (sessionId: string) => void,
    pollStatusFn: (sessionId: string) => Promise<unknown> = voiceApi.pollCallStatus,
  ) => {
    setTwilioSessionId(sessionId);
    setTwilioStatus('calling');
    setTwilioTurnCount(0);
    setLiveTurns([]);

    let evalAnnounced = false;
    let recordingWaitTicks = 0; // bounded wait for recording after eval completes
    pollRef.current = setInterval(async () => {
      try {
        const data = await pollStatusFn(sessionId) as {
          status: string; turnCount?: number; turns?: Turn[];
          result?: EvalResult; recording?: RecordingState; error?: string;
        };
        setTwilioStatus(data.status);
        setTwilioTurnCount(data.turnCount ?? 0);
        if (Array.isArray(data.turns)) setLiveTurns(data.turns as Turn[]);

        if (data.status === 'completed' && data.result) {
          // Merge recording info into result so the panel can show download status.
          // Keep polling after eval completes until recording reaches a final state.
          setResult(prev => {
            const next = data.result as EvalResult;
            return {
              ...next,
              sessionId,
              recording: data.recording ?? prev?.recording ?? next.recording,
            };
          });

          if (!evalAnnounced) {
            evalAnnounced = true;
            toast.success('Voice evaluation complete');
            onCompleted?.(sessionId);
          }

          const rec = data.recording;
          // Stop once recording reaches a terminal state OR there is no recording.
          // Also cap how long we keep polling just for the recording — the eval
          // result is already shown, so the call must not appear "stuck" if the
          // recording is slow/never finalizes (poll is 4s; ~30 ticks ≈ 2 min).
          recordingWaitTicks += 1;
          if (!rec || rec.status === 'ready' || rec.status === 'error' || recordingWaitTicks > 30) {
            stopPolling();
          }
        } else if (data.status === 'failed') {
          stopPolling();
          toast.error(data.error || 'Voice call evaluation failed');
        }
      } catch {
        // polling errors are transient — keep trying
      }
    }, 4000);
  };

  const fetchVapiTrace = async (sessionId: string) => {
    setVapiTraceLoading(true);
    setVapiTraceError(undefined);

    // Retry up to 4 times with increasing delays (5s, 10s, 15s, 20s gaps)
    // to handle Vapi webhook delivery latency.
    const delays = [5000, 10000, 15000, 20000];
    let lastError = 'Failed to fetch Vapi trace';

    for (let attempt = 0; attempt < delays.length; attempt++) {
      await new Promise(r => setTimeout(r, delays[attempt]));
      try {
        const trace = await voiceApi.getVapiTrace(sessionId);
        setVapiTrace(trace);
        setVapiTraceLoading(false);
        return;
      } catch (err: unknown) {
        // Extract the actual server error message from Axios response
        const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
        lastError = axiosErr?.response?.data?.error || axiosErr?.message || 'Failed to fetch Vapi trace';
        console.warn(`[vapi-trace] attempt ${attempt + 1} failed:`, lastError);
      }
    }

    setVapiTraceError(lastError);
    setVapiTraceLoading(false);
  };

  useEffect(() => () => stopPolling(), []);

  // ── Mutations ──
  const connectMutation = useMutation({
    mutationFn: () => voiceApi.testConnection({ apiKey, assistantId }),
    onSuccess: () => { setConnected(true); toast.success('Connected to voice agent successfully'); },
    onError: (err: Error) => { setConnected(false); toast.error(err.message || 'Connection failed'); },
  });

  const chatEvalMutation = useMutation({
    mutationFn: () => voiceApi.evaluate({ apiKey, assistantId, scenarioId: selectedScenario, metricIds: selectedMetrics }),
    onSuccess: (data: EvalResult) => { setResult(data); toast.success('Chat evaluation complete'); },
    onError: (err: Error) => toast.error(err.message || 'Evaluation failed'),
  });

  const twilioEvalMutation = useMutation({
    mutationFn: () => voiceApi.startTwilioEval({
      accountSid: twilioAccountSid, authToken: twilioAuthToken,
      fromNumber: twilioFromNumber, toNumber: twilioToNumber,
      webhookBaseUrl,
      scenarioId: twilioScenarioMode === 'custom' ? 'custom' : selectedScenario,
      metricIds: selectedMetrics,
      silenceTimeout,
      mainAgentSpeaksFirst: twilioMainAgentSpeaksFirst,
      ...(twilioScenarioMode === 'custom' && {
        customPersona: twilioCustomPersona,
        customScenario: twilioCustomScenario,
      }),
    }),
    onSuccess: (data: { sessionId: string }) => {
      toast.success('Outbound call initiated');
      startPolling(data.sessionId);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start voice call'),
  });

  const vapiEvalMutation = useMutation({
    mutationFn: () => voiceApi.startVapiEval({
      vapiApiKey, vapiAssistantId,
      toNumber: vapiToNumber,
      scenarioId: twilioScenarioMode === 'custom' ? 'custom' : selectedScenario,
      metricIds: selectedMetrics,
      vapiSpeaksFirst,
      silenceTimeout,
      ...(twilioScenarioMode === 'custom' && {
        customPersona: twilioCustomPersona,
        customScenario: twilioCustomScenario,
      }),
    }),
    onSuccess: (data: { sessionId: string }) => {
      toast.success('Outbound call to Vapi agent initiated');
      setVapiTrace(null);
      setVapiTraceError(undefined);
      setLastVapiSessionId(data.sessionId);
      startPolling(data.sessionId, fetchVapiTrace);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start Vapi voice call'),
  });

  const livekitEvalMutation = useMutation({
    mutationFn: () => voiceApi.startLiveKitEval({
      toNumber: livekitToNumber,
      scenarioId: selectedScenario,
      metricIds: selectedMetrics,
      silenceTimeout,
      mainAgentSpeaksFirst: livekitMainAgentSpeaksFirst,
      recordCall: livekitRecordCall,
      customerSimulatorModel: livekitCustomerModel,
      ttsProvider: livekitTtsProvider,
      ttsSpeed: Number(livekitTtsSpeed),
      ttsVoice: livekitTtsVoice,
    }),
    onSuccess: (data: { sessionId: string }) => {
      toast.success('LiveKit outbound call initiated');
      startPolling(data.sessionId, undefined, voiceApi.pollLiveKitStatus);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to start LiveKit voice call'),
  });

  const handleCancelCall = async () => {
    if (!twilioSessionId) return;
    if (!confirm('End this call now? The conversation will be scored on whatever happened so far.')) return;
    setCancelling(true);
    try {
      // LiveKit sessions live under /livekit; all other voice modes under /voice.
      if (evalMode === 'livekit') {
        await voiceApi.cancelLiveKit(twilioSessionId);
      } else {
        await voiceApi.cancelCall(twilioSessionId);
      }
      toast.success('Ending call…');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to cancel call');
    } finally {
      setCancelling(false);
    }
  };

  const isRunning = chatEvalMutation.isPending || twilioEvalMutation.isPending || vapiEvalMutation.isPending || livekitEvalMutation.isPending || !!twilioSessionId;

  const canRunChat = connected && selectedScenario && !isRunning;
  const twilioCredsReady = !!(twilioAccountSid && twilioAuthToken && twilioFromNumber && twilioToNumber && webhookBaseUrl);
  const twilioScenarioReady = twilioScenarioMode === 'preset'
    ? !!selectedScenario
    : !!(twilioCustomPersona.name && twilioCustomScenario.reason && twilioCustomScenario.opening_line);
  const canRunTwilio = twilioCredsReady && twilioScenarioReady && !isRunning;
  const vapiCredsReady = !!(vapiApiKey.trim() && vapiAssistantId.trim() && vapiToNumber.trim() && twilioCredsConfigured);
  const canRunVapi = vapiCredsReady && twilioScenarioReady && !isRunning;
  const canRunLiveKit = livekitConfigured && !!livekitToNumber.trim() && !!selectedScenario && !isRunning;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-dark-text">Quick Test Your Agent</h1>
          <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200 rounded-full">Beta</span>
        </div>
        <p className="text-sm text-gray-text mt-0.5">
          Run a one-off simulated conversation against your agent and score it on the spot. This is a standalone quick test — separate from the full Eval Run flow.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { mode: 'twilio-voice', icon: PhoneCall, label: 'Voice Agent (Twilio)' },
          { mode: 'livekit', icon: Radio, label: 'Voice Agent (LiveKit)' },
          { mode: 'vapi', icon: Zap, label: 'Vapi Agent' },
          { mode: 'chat', icon: MessageSquare, label: 'Chat Agent' },
        ] as const).map(({ mode, icon: Icon, label }) => (
          <button key={mode} onClick={() => switchMode(mode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              evalMode === mode ? 'bg-white text-dark-text shadow-sm' : 'text-gray-text hover:text-dark-text'
            }`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Left: config */}
        <div className="col-span-2 space-y-5">

          {/* Agent Configuration card */}
          <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-dark-text">Main Agent Configuration</h2>

            {/* ── Chat mode ── */}
            {evalMode === 'chat' && (
              <>
                <div>
                  <label className="label">Vapi API Key *</label>
                  <div className="relative">
                    <input type={showApiKey ? 'text' : 'password'} value={apiKey}
                      onChange={e => { setApiKey(e.target.value); setConnected(false); }}
                      className="input pr-10" placeholder="Enter your Vapi private API key" />
                    <button type="button" onClick={() => setShowApiKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text">
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-text mt-1">Vapi dashboard → API Keys</p>
                </div>
                <div>
                  <label className="label">Assistant ID *</label>
                  <input type="text" value={assistantId}
                    onChange={e => { setAssistantId(e.target.value); setConnected(false); }}
                    className="input" placeholder="e.g. a1b2c3d4-e5f6-…" />
                  <p className="text-xs text-gray-text mt-1">Vapi dashboard → Assistants</p>
                </div>
                <button onClick={() => connectMutation.mutate()}
                  disabled={!apiKey.trim() || !assistantId.trim() || connectMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-primary-blue text-primary-blue hover:bg-light-blue">
                  {connectMutation.isPending ? <span className="w-4 h-4 border-2 border-primary-blue/30 border-t-primary-blue rounded-full animate-spin" />
                    : connected ? <CheckCircle size={14} className="text-success-green" /> : <Zap size={14} />}
                  {connectMutation.isPending ? 'Testing…' : connected ? 'Connected' : 'Test Connection'}
                </button>
                {connected && (
                  <div className="flex items-center gap-2 text-xs text-success-green bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle size={12} /> Successfully connected to Vapi assistant
                  </div>
                )}
              </>
            )}

            {/* ── Vapi Agent mode ── */}
            {evalMode === 'vapi' && (
              <>
                {!twilioCredsConfigured && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>Twilio credentials not configured (needed to place the call).{' '}
                      <Link to="/settings" className="font-medium underline hover:text-amber-900 inline-flex items-center gap-0.5">Settings <Settings size={11} /></Link>
                      {' '}→ Voice Simulation.
                    </span>
                  </div>
                )}
                {savedVapiApiKey && savedVapiAssistantId ? (
                  <div className="flex items-center gap-2 text-xs text-success-green bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle size={13} />
                    <span>Vapi credentials loaded from <Link to="/settings" className="underline hover:text-green-800">Settings</Link></span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>Vapi credentials not saved. <Link to="/settings" className="font-medium underline hover:text-amber-900">Go to Settings → Vapi</Link> to save them, or enter below.</span>
                  </div>
                )}
                <div>
                  <label className="label">Vapi API Key *</label>
                  <div className="relative">
                    <input type={showVapiApiKey ? 'text' : 'password'} value={vapiApiKey}
                      onChange={e => setVapiApiKey(e.target.value)}
                      className="input pr-10" placeholder="Enter your Vapi private API key" />
                    <button type="button" onClick={() => setShowVapiApiKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-text hover:text-dark-text">
                      {showVapiApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Vapi Assistant ID *</label>
                  <input type="text" value={vapiAssistantId} onChange={e => setVapiAssistantId(e.target.value)}
                    className="input" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" />
                </div>
                <div>
                  <label className="label">Agent Phone Number (To) *</label>
                  <input type="text" value={vapiToNumber} onChange={e => setVapiToNumber(e.target.value)}
                    className="input" placeholder="+10987654321" />
                  <p className="text-xs text-gray-text mt-1">The Vapi phone number your assistant receives calls on</p>
                </div>
                <div>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <div className="mt-0.5 flex-shrink-0">
                      <div
                        onClick={() => setVapiSpeaksFirst(v => !v)}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${vapiSpeaksFirst ? 'bg-primary-blue' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${vapiSpeaksFirst ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-dark-text">Vapi agent speaks first</div>
                      <div className="text-xs text-gray-text mt-0.5">
                        When enabled, the simulator waits and records the agent's opening greeting before saying the seed utterance. Enable this if your Vapi agent greets the caller first.
                      </div>
                    </div>
                  </label>
                </div>
                <div>
                  <label className="label">End-of-turn silence timeout (seconds)</label>
                  <input type="number" min={1} max={15} step={0.5}
                    value={silenceTimeout}
                    onChange={e => setSilenceTimeout(Math.max(1, Math.min(15, Number(e.target.value) || 3)))}
                    className="input w-32" />
                  <p className="text-xs text-gray-text mt-1">
                    How long the simulator waits after the agent stops talking before ending the turn. Lower = snappier turns but may cut off mid-sentence pauses. Default 3s for Voice mode, 10s for Vapi.
                  </p>
                </div>
                {webhookBaseUrl && (
                  <div className="space-y-1.5 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-xs font-semibold text-dark-text">Configure Vapi Webhook</p>
                    <p className="text-xs text-gray-text">In Vapi settings, set the <span className="font-medium">Server URL</span> on your phone number to:</p>
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1 flex-1 break-all text-primary-blue">
                        {webhookBaseUrl.replace(/\/$/, '')}/api/voice/vapi-webhook
                      </code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`${webhookBaseUrl.replace(/\/$/, '')}/api/voice/vapi-webhook`); toast.success('Copied'); }}
                        className="flex-shrink-0 px-2 py-1 text-xs text-gray-text border border-gray-200 rounded hover:bg-white transition-colors"
                      >Copy</button>
                    </div>
                    <p className="text-xs text-gray-text">When configured, tool calls and transcript are pushed to this eval suite the moment the call ends — no API polling needed.</p>
                  </div>
                )}
                <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                  <Zap size={12} className="mt-0.5 flex-shrink-0" />
                  <span>Twilio will call this number. Tool calls and traces are pulled from Vapi after the call ends.</span>
                </div>
              </>
            )}

            {/* ── Twilio Voice mode ── */}
            {evalMode === 'twilio-voice' && (
              <>
                {/* Credential status from Settings */}
                {twilioCredsConfigured ? (
                  <div className="flex items-center gap-2 text-xs text-success-green bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                    <CheckCircle size={13} />
                    <span>Twilio credentials configured — from number: <span className="font-mono">{twilioFromNumber}</span></span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>
                      Twilio credentials not configured.{' '}
                      <Link to="/settings" className="font-medium underline hover:text-amber-900 inline-flex items-center gap-0.5">
                        Go to Settings <Settings size={11} />
                      </Link>
                      {' '}→ Voice Simulation tab to add them.
                    </span>
                  </div>
                )}
                <div>
                  <label className="label">Agent Phone Number (To) *</label>
                  <input type="text" value={twilioToNumber} onChange={e => setTwilioToNumber(e.target.value)}
                    className="input" placeholder="+10987654321" />
                  <p className="text-xs text-gray-text mt-1">The phone number your voice agent receives calls on</p>
                </div>
                <div>
                  <label className="label">End-of-turn silence timeout (seconds)</label>
                  <input type="number" min={1} max={15} step={0.5}
                    value={silenceTimeout}
                    onChange={e => setSilenceTimeout(Math.max(1, Math.min(15, Number(e.target.value) || 3)))}
                    className="input w-32" />
                  <p className="text-xs text-gray-text mt-1">
                    How long Twilio waits after you stop talking before ending each recording. Lower = snappier turns but cuts off mid-sentence pauses. Higher = patient but adds dead air. Sweet spot: 2.5–4s.
                  </p>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-purple-800">Main Agent Speaks First</p>
                    <p className="text-xs text-purple-600 mt-0.5">For inbound use cases — the agent greets first and the simulator says the seed after the agent's opening. Turn off for outbound (simulator speaks first).</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTwilioMainAgentSpeaksFirst(v => !v)}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${twilioMainAgentSpeaksFirst ? 'bg-purple-500' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${twilioMainAgentSpeaksFirst ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </>
            )}

            {evalMode === 'livekit' && (
              <>
                {/* LiveKit config status from Settings */}
                {livekitConfigured ? (
                  <div className="flex items-center gap-2 text-xs text-success-green bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                    <CheckCircle size={13} />
                    <span>LiveKit configured — SIP trunk: <span className="font-mono">{livekitSipTrunkId}</span></span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>
                      LiveKit not configured.{' '}
                      <Link to="/settings" className="font-medium underline hover:text-amber-900 inline-flex items-center gap-0.5">
                        Go to Settings <Settings size={11} />
                      </Link>
                      {' '}→ Voice Simulation → Voice Agent (LiveKit) to add the LiveKit URL, API key/secret, and SIP trunk ID.
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-2 text-xs text-primary-blue bg-light-blue border border-blue-200 rounded-lg px-3 py-2.5">
                  <Radio size={13} className="mt-0.5 flex-shrink-0" />
                  <span>
                    This tab dials out via <span className="font-medium">LiveKit Cloud + your Twilio SIP trunk</span> with streaming STT/TTS (Groq + Deepgram). All other tabs continue to use Twilio TwiML, unchanged.
                  </span>
                </div>
                <div>
                  <label className="label">Agent Phone Number (To) *</label>
                  <input type="text" value={livekitToNumber} onChange={e => setLivekitToNumber(e.target.value)}
                    className="input" placeholder="+13472288705" />
                  <p className="text-xs text-gray-text mt-1">Use E.164 format with country code, e.g. <span className="font-mono">+13472288705</span>. A bare 10-digit US number is auto-prefixed with +1.</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-light-blue border border-blue-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-primary-blue">Main Agent Speaks First</p>
                    <p className="text-xs text-primary-blue/80 mt-0.5">For inbound use cases — the agent greets first and the simulator replies after the agent's opening turn. Turn off for outbound (simulator speaks the seed first).</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLivekitMainAgentSpeaksFirst(v => !v)}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${livekitMainAgentSpeaksFirst ? 'bg-primary-blue' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${livekitMainAgentSpeaksFirst ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 border border-brand-border rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-dark-text">Record call</p>
                    <p className="text-xs text-gray-text mt-0.5">When on, the call is recorded and a download link appears in the results. When off, no recording is made — saves LiveKit egress minutes.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLivekitRecordCall(v => !v)}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${livekitRecordCall ? 'bg-primary-blue' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${livekitRecordCall ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div>
                  <label className="label">Customer Simulator LLM</label>
                  <select value={livekitCustomerModel} onChange={e => setLivekitCustomerModel(e.target.value)} className="input">
                    <optgroup label="OpenAI">
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo (faster, lower cost)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (smarter, slightly slower)</option>
                      <option value="gpt-4o">GPT-4o (most capable)</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    </optgroup>
                    <optgroup label="Groq (fastest, lowest cost)">
                      <option value="groq:openai/gpt-oss-120b">GPT-OSS 120B (Groq, fast + smart)</option>
                      <option value="groq:openai/gpt-oss-20b">GPT-OSS 20B (Groq, fastest)</option>
                    </optgroup>
                  </select>
                  <p className="text-xs text-gray-text mt-1">Model powering the customer simulator on the LiveKit call. Groq models require GROQ_API_KEY in .env.</p>
                </div>
                <div>
                  <label className="label">TTS Voice Provider</label>
                  <select value={livekitTtsProvider} onChange={e => setLivekitTtsProvider(e.target.value)} className="input">
                    <option value="deepgram">Deepgram Aura (fastest, lowest latency)</option>
                    <option value="cartesia">Cartesia Sonic (most natural — requires CARTESIA_API_KEY)</option>
                    <option value="openai">OpenAI (natural, higher latency)</option>
                  </select>
                  <p className="text-xs text-gray-text mt-1">Voice engine for the simulated caller. Cartesia = most natural + natural pacing; Deepgram = snappiest. Voice/speed set via env (CARTESIA_TTS_VOICE / _SPEED, DEEPGRAM_TTS_MODEL).</p>
                </div>
                {livekitTtsProvider === 'cartesia' && (
                  <div>
                    <label className="label">Cartesia Voice</label>
                    <select value={livekitTtsVoice} onChange={e => setLivekitTtsVoice(e.target.value)} className="input">
                      {CARTESIA_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-text mt-1">Voice for the Cartesia (Sonic) simulated caller.</p>
                  </div>
                )}
                <div>
                  <label className="label">Speaking Speed</label>
                  <select value={livekitTtsSpeed} onChange={e => setLivekitTtsSpeed(e.target.value)} className="input">
                    <option value="0.8">Slower (0.8×)</option>
                    <option value="0.9">Slightly slower (0.9×)</option>
                    <option value="1">Normal (1.0×)</option>
                    <option value="1.1">Slightly faster (1.1×)</option>
                  </select>
                  <p className="text-xs text-gray-text mt-1">Applies to the selected provider. Note: Deepgram Aura-1 voices ignore speed (Aura-2 only); Cartesia &amp; OpenAI honor it naturally.</p>
                </div>
              </>
            )}
          </div>

          {evalMode === 'chat' && (
            <ScenarioPanel scenarios={scenarios} selectedScenario={selectedScenario} onSelect={setSelectedScenario} />
          )}

          {evalMode === 'vapi' && (
            <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-dark-text">Scenario</h2>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  {(['preset', 'custom'] as const).map(mode => (
                    <button key={mode} onClick={() => setTwilioScenarioMode(mode)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                        twilioScenarioMode === mode ? 'bg-white text-dark-text shadow-sm' : 'text-gray-text hover:text-dark-text'
                      }`}>
                      {mode === 'preset' ? 'Preset' : 'Custom'}
                    </button>
                  ))}
                </div>
              </div>
              {twilioScenarioMode === 'preset' && (
                <div className="space-y-2">
                  {scenarios.map(s => (
                    <label key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedScenario === s.id ? 'border-primary-blue bg-light-blue/40' : 'border-brand-border hover:border-primary-blue/40 hover:bg-light-blue/20'
                    }`}>
                      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        selectedScenario === s.id ? 'border-primary-blue' : 'border-gray-300'
                      }`}>
                        {selectedScenario === s.id && <div className="w-2 h-2 rounded-full bg-primary-blue" />}
                      </div>
                      <input type="radio" name="vapi-scenario" value={s.id} checked={selectedScenario === s.id} onChange={() => setSelectedScenario(s.id)} className="hidden" />
                      <div>
                        <div className="text-sm font-medium text-dark-text">{s.name}</div>
                        <div className="text-xs text-gray-text mt-0.5">{s.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {twilioScenarioMode === 'custom' && (
                <div className="space-y-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                    Define your own customer persona and call scenario for the Vapi agent test.
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-text uppercase tracking-wide">Customer Persona</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="label">Name *</label><input type="text" value={twilioCustomPersona.name} onChange={e => updateTwilioCustomPersona('name', e.target.value)} className="input" placeholder="e.g. James Hartley" /></div>
                      <div><label className="label">Age</label><input type="text" value={twilioCustomPersona.age} onChange={e => updateTwilioCustomPersona('age', e.target.value)} className="input" placeholder="e.g. 38" /></div>
                    </div>
                    <div><label className="label">Policy / Account Number</label><input type="text" value={twilioCustomPersona.policy_number} onChange={e => updateTwilioCustomPersona('policy_number', e.target.value)} className="input" /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="label">Date of Birth</label><input type="text" value={twilioCustomPersona.dob} onChange={e => updateTwilioCustomPersona('dob', e.target.value)} className="input" /></div>
                      <div><label className="label">OTP / PIN</label><input type="text" value={twilioCustomPersona.otp} onChange={e => updateTwilioCustomPersona('otp', e.target.value)} className="input" /></div>
                    </div>
                    <div><label className="label">Emotional State</label><select value={twilioCustomPersona.emotional_state} onChange={e => updateTwilioCustomPersona('emotional_state', e.target.value)} className="input">{EMOTIONAL_STATES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select></div>
                  </div>
                  <div className="space-y-3 pt-1">
                    <p className="text-xs font-semibold text-gray-text uppercase tracking-wide">Call Scenario</p>
                    <div><label className="label">Reason for Calling *</label><input type="text" value={twilioCustomScenario.reason} onChange={e => updateTwilioCustomScenario('reason', e.target.value)} className="input" /></div>
                    <div><label className="label">Key Details</label><textarea value={twilioCustomScenario.details} onChange={e => updateTwilioCustomScenario('details', e.target.value)} className="input min-h-[60px] resize-none" /></div>
                    <div><label className="label">Customer Goal</label><input type="text" value={twilioCustomScenario.goal} onChange={e => updateTwilioCustomScenario('goal', e.target.value)} className="input" /></div>
                    <div><label className="label">Opening Line *</label><input type="text" value={twilioCustomScenario.opening_line} onChange={e => updateTwilioCustomScenario('opening_line', e.target.value)} className="input" /><p className="text-xs text-gray-text mt-1">First thing the simulated customer says when the call connects.</p></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {evalMode === 'twilio-voice' && (
            <>
              {/* Scenario mode toggle */}
              <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-dark-text">Scenario</h2>
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    {(['preset', 'custom'] as const).map(mode => (
                      <button key={mode} onClick={() => setTwilioScenarioMode(mode)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          twilioScenarioMode === mode ? 'bg-white text-dark-text shadow-sm' : 'text-gray-text hover:text-dark-text'
                        }`}>
                        {mode === 'preset' ? 'Preset' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {twilioScenarioMode === 'preset' && (
                  <div className="space-y-2">
                    {scenarios.map(s => (
                      <label key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedScenario === s.id ? 'border-primary-blue bg-light-blue/40' : 'border-brand-border hover:border-primary-blue/40 hover:bg-light-blue/20'
                      }`}>
                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          selectedScenario === s.id ? 'border-primary-blue' : 'border-gray-300'
                        }`}>
                          {selectedScenario === s.id && <div className="w-2 h-2 rounded-full bg-primary-blue" />}
                        </div>
                        <input type="radio" name="twilio-scenario" value={s.id} checked={selectedScenario === s.id} onChange={() => setSelectedScenario(s.id)} className="hidden" />
                        <div>
                          <div className="text-sm font-medium text-dark-text">{s.name}</div>
                          <div className="text-xs text-gray-text mt-0.5">{s.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {twilioScenarioMode === 'custom' && (
                  <div className="space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                      Define your own customer persona and call scenario. The simulator will roleplay this customer on the live call.
                    </div>

                    {/* Custom Persona */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-gray-text uppercase tracking-wide">Customer Persona</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label">Name *</label>
                          <input type="text" value={twilioCustomPersona.name}
                            onChange={e => updateTwilioCustomPersona('name', e.target.value)}
                            className="input" placeholder="e.g. James Hartley" />
                        </div>
                        <div>
                          <label className="label">Age</label>
                          <input type="text" value={twilioCustomPersona.age}
                            onChange={e => updateTwilioCustomPersona('age', e.target.value)}
                            className="input" placeholder="e.g. 38" />
                        </div>
                      </div>
                      <div>
                        <label className="label">Policy / Account Number</label>
                        <input type="text" value={twilioCustomPersona.policy_number}
                          onChange={e => updateTwilioCustomPersona('policy_number', e.target.value)}
                          className="input" placeholder="e.g. SFG-2291-7743" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label">Date of Birth</label>
                          <input type="text" value={twilioCustomPersona.dob}
                            onChange={e => updateTwilioCustomPersona('dob', e.target.value)}
                            className="input" placeholder="e.g. 12 March 1985" />
                        </div>
                        <div>
                          <label className="label">OTP / PIN</label>
                          <input type="text" value={twilioCustomPersona.otp}
                            onChange={e => updateTwilioCustomPersona('otp', e.target.value)}
                            className="input" placeholder="e.g. 482910" />
                        </div>
                      </div>
                      <div>
                        <label className="label">Emotional State</label>
                        <select value={twilioCustomPersona.emotional_state}
                          onChange={e => updateTwilioCustomPersona('emotional_state', e.target.value)}
                          className="input">
                          {EMOTIONAL_STATES.map(s => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Custom Call Scenario */}
                    <div className="space-y-3 pt-1">
                      <p className="text-xs font-semibold text-gray-text uppercase tracking-wide">Call Scenario</p>
                      <div>
                        <label className="label">Reason for Calling *</label>
                        <input type="text" value={twilioCustomScenario.reason}
                          onChange={e => updateTwilioCustomScenario('reason', e.target.value)}
                          className="input" placeholder="e.g. Cancel policy due to hidden charges" />
                      </div>
                      <div>
                        <label className="label">Key Details</label>
                        <textarea value={twilioCustomScenario.details}
                          onChange={e => updateTwilioCustomScenario('details', e.target.value)}
                          className="input min-h-[60px] resize-none"
                          placeholder="e.g. Monthly admin fee not disclosed at signup, discovered after 3 months." />
                      </div>
                      <div>
                        <label className="label">Customer Goal</label>
                        <input type="text" value={twilioCustomScenario.goal}
                          onChange={e => updateTwilioCustomScenario('goal', e.target.value)}
                          className="input" placeholder="e.g. Cancel policy or get compensation" />
                      </div>
                      <div>
                        <label className="label">Opening Line *</label>
                        <input type="text" value={twilioCustomScenario.opening_line}
                          onChange={e => updateTwilioCustomScenario('opening_line', e.target.value)}
                          className="input" placeholder="e.g. Hi, I want to cancel my insurance policy." />
                        <p className="text-xs text-gray-text mt-1">First thing the simulated customer says when the call connects.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {evalMode === 'livekit' && (
            <ScenarioPanel scenarios={scenarios} selectedScenario={selectedScenario} onSelect={setSelectedScenario} />
          )}
          <MetricsPanel metrics={metrics} selectedMetrics={selectedMetrics} onToggle={toggleMetric} />

          {/* Evaluate button */}
          {evalMode === 'chat' && (
            <button onClick={() => { setResult(null); chatEvalMutation.mutate(); }} disabled={!canRunChat}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-primary-blue text-white rounded-xl hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {chatEvalMutation.isPending
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Evaluating…</>
                : <><MessageSquare size={16} />Evaluate Chat Agent</>}
            </button>
          )}
          {evalMode === 'twilio-voice' && (
            <button onClick={() => { setResult(null); twilioEvalMutation.mutate(); }} disabled={!canRunTwilio}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-primary-blue text-white rounded-xl hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {twilioEvalMutation.isPending || twilioSessionId
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {twilioStatus === 'calling' ? 'Calling agent…' : 'Conversation in progress…'}</>
                : <><PhoneCall size={16} />Evaluate Voice Agent</>}
            </button>
          )}
          {evalMode === 'vapi' && (
            <button onClick={() => { setResult(null); setVapiTrace(null); vapiEvalMutation.mutate(); }} disabled={!canRunVapi}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-primary-blue text-white rounded-xl hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {vapiEvalMutation.isPending || twilioSessionId
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {twilioStatus === 'calling' ? 'Calling Vapi agent…' : 'Conversation in progress…'}</>
                : <><Zap size={16} />Evaluate Vapi Agent</>}
            </button>
          )}
          {evalMode === 'livekit' && (
            <button onClick={() => { setResult(null); livekitEvalMutation.mutate(); }} disabled={!canRunLiveKit}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-primary-blue text-white rounded-xl hover:bg-primary-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {livekitEvalMutation.isPending || twilioSessionId
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {twilioStatus === 'calling' ? 'Calling agent (LiveKit)…' : 'Conversation in progress…'}</>
                : <><Radio size={16} />Evaluate Voice Agent (LiveKit)</>}
            </button>
          )}

          {!isRunning && evalMode === 'chat' && !connected && (
            <p className="text-xs text-gray-text text-center">Test connection to an agent before evaluating</p>
          )}
        </div>

        {/* Right: results */}
        <div className="col-span-3">
          {chatEvalMutation.isPending ? (
            <div className="bg-white border border-brand-border rounded-xl p-8">
              <LoadingIndicator mode="chat" />
            </div>
          ) : ((twilioEvalMutation.isPending || vapiEvalMutation.isPending || !!twilioSessionId) && !result) ? (
            <div className="bg-white border border-brand-border rounded-xl p-8 space-y-6">
              <LoadingIndicator mode="twilio-voice" turnCount={twilioTurnCount} callStatus={twilioStatus} />
              {/* Live transcript while the call is happening */}
              {!!twilioSessionId && twilioStatus !== 'calling' && (
                <div className="border-t border-brand-border pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-dark-text">Live transcript</h3>
                    <span className="text-xs text-gray-text">{liveTurns.length} turns</span>
                  </div>
                  <LiveTranscript turns={liveTurns} />
                </div>
              )}
              {/* Stop call button — only while a Twilio session is in flight */}
              {!!twilioSessionId && twilioStatus !== 'completed' && twilioStatus !== 'scoring' && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={handleCancelCall}
                    disabled={cancelling}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-error-red hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <PhoneCall size={14} className="rotate-[135deg]" />
                    {cancelling ? 'Ending call…' : 'End call now'}
                  </button>
                </div>
              )}
            </div>
          ) : result ? (
            <div className="space-y-4">
              <ResultsPanel result={result} isVoice={evalMode !== 'chat'} recordingBasePath={evalMode === 'livekit' ? '/livekit' : '/voice'} />
              {evalMode === 'vapi' && (
                <VapiTracePanel
                  trace={vapiTrace}
                  loading={vapiTraceLoading}
                  error={vapiTraceError}
                  onRetry={lastVapiSessionId ? () => fetchVapiTrace(lastVapiSessionId) : undefined}
                />
              )}
            </div>
          ) : (
            <div className="bg-white border border-dashed border-brand-border rounded-xl p-12 flex flex-col items-center justify-center gap-3 min-h-[400px] text-center">
              <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
                {evalMode === 'chat' ? <MessageSquare size={24} className="text-amber-500" />
                  : evalMode === 'vapi' ? <Zap size={24} className="text-amber-500" />
                  : <PhoneCall size={24} className="text-amber-500" />}
              </div>
              <p className="text-sm font-semibold text-dark-text">No evaluation results yet</p>
              <p className="text-xs text-gray-text max-w-xs">
                {evalMode === 'chat'
                  ? <>Configure your Vapi credentials, select a scenario, then click <strong>Evaluate Chat Agent</strong>.</>
                  : evalMode === 'vapi'
                  ? <>Enter your Vapi API key, assistant ID, phone number, select a scenario, then click <strong>Evaluate Vapi Agent</strong>. Tool calls and traces will appear here after the call.</>
                  : <>Enter the agent phone number, select a scenario, then click <strong>Evaluate Voice Agent</strong>.</>}
              </p>
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Beta: Results are not saved to Eval Runs and won't affect existing data.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
