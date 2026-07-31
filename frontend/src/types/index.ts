export interface Agent {
  id: string;
  name: string;
  version: string;
  description?: string;
  prompt?: string;
  sop?: string;
  llm_type?: 'openai' | 'claude';
  agent_type?: 'chat' | 'voice' | 'vapi';
  phone_number?: string;
  silence_timeout?: number;
  stt_mode?: 'record' | 'gather';
  main_agent_speaks_first?: boolean | number;
  vapi_api_key?: string;
  vapi_assistant_id?: string;
  vapi_speaks_first?: boolean | number;
  tools?: string[];
  knowledge_bases?: string[];
  created_at: string;
  updated_at: string;
}

export interface VapiTranscriptTurn {
  role: 'bot' | 'assistant' | 'user';
  content: string;
  timestamp_ms: number;
}

export interface VapiToolCallTrace {
  id: string;
  name: string;
  arguments: unknown;
  result: unknown;
  timestamp_ms: number;
  status: 'success' | 'pending' | 'error';
}

export interface VapiTrace {
  callId?: string;
  id?: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: string;
  messages?: Array<{ role: string; message?: string; content?: string; time?: number; secondsFromStart?: number }>;
  artifact?: { transcript?: string; messages?: Array<unknown> };
  vapiTranscript?: VapiTranscriptTurn[];
  toolCalls?: VapiToolCallTrace[];
  costBreakdown?: Record<string, number>;
  cost?: number;
  analysis?: { summary?: string; successEvaluation?: string };
  recordingUrl?: string;
}

export interface Persona {
  id: string;
  agent_id: string;
  name: string;
  description?: string;
  tone?: string;
  goal?: string;
  frustration_level?: number;
  language?: string;
  interruption_level?: number;
  speed?: number;
  additional_attributes?: Record<string, unknown>;
  is_synthetic?: boolean;
  created_at: string;
}

export interface Scenario {
  id: string;
  agent_id: string;
  name: string;
  description?: string;
  seed_utterance: string;
  expected_outcome_type: 'natural_language' | 'tool_call' | 'kpi_threshold';
  expected_outcome_value?: string;
  persona_id?: string;
  tags?: string[];
  metric_ids?: string[];
  status: 'draft' | 'active' | 'archived';
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface EvalRun {
  id: string;
  agent_id: string;
  agent_version?: string;
  name: string;
  scenario_ids?: string[];
  n_trials: number;
  k_threshold: number;
  metric_ids?: string[];
  mode: 'mock' | 'live' | 'agent' | 'upload';
  agent_type?: 'openai' | 'claude' | 'custom' | 'voice' | 'vapi' | null;
  voice_provider?: 'twilio' | 'livekit' | null;
  test_agent_id?: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  summary_metrics?: {
    avg_kpi: number;
    pass_rate: number;
    avg_ttft: number;
    avg_latency: number;
    total_cost: number;
    total_trials: number;
  };
  created_at: string;
  completed_at?: string;
}

export interface NFRMetrics {
  ttft?: number;
  avg_latency?: number;
  e2e_latency?: number;
  cost?: number;
  input_tokens?: number;
  output_tokens?: number;
  model_calls?: number;
}

export interface TrialResult {
  id: string;
  run_id: string;
  scenario_id: string;
  trial_index: number;
  kpi_score?: number;
  kpi_rationale?: string;
  pass_fail?: boolean;
  nfr_metrics?: NFRMetrics;
  talk_ratio?: number;
  tags?: string[];
  recording_session_id?: string | null;
  recording_provider?: 'voice' | 'livekit' | null;
  created_at: string;
}

export interface TranscriptTurn {
  id: string;
  trial_result_id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'tool' | 'kb';
  content: string;
  timestamp_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  turn_id: string;
  tool_name: string;
  input_args?: Record<string, unknown>;
  response?: Record<string, unknown>;
  latency_ms?: number;
  status: 'success' | 'error';
}

export interface KBChunk {
  title: string;
  snippet: string;
  score: number;
}

export interface KBCall {
  id: string;
  turn_id: string;
  query: string;
  chunks?: KBChunk[];
  latency_ms?: number;
  kb_source?: string;
}

export interface Annotation {
  id: string;
  trial_result_id: string;
  turn_id?: string;
  note_text: string;
  tags?: string[];
  author_id?: string;
  author_name?: string;
  created_at: string;
}

export interface Assignment {
  id: string;
  trial_result_id: string;
  assignee_id?: string;
  assignee_name?: string;
  status: 'unassigned' | 'in_review' | 'resolved';
  due_date?: string;
  history?: Array<{ status: string; changed_at: string; assignee?: string }>;
  created_at: string;
  updated_at: string;
}

export interface Metric {
  id: string;
  name: string;
  description?: string;
  type: 'conversation' | 'turn';
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role?: string;
  created_at: string;
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  trials_run: number;
  trials_total: number;
  pass_count: number;
  pass_at_k: number;
  pass_strict_k: number;
  avg_kpi: number;
  avg_ttft: number;
  avg_latency: number;
  total_cost: number;
  avg_talk_ratio: number;
  tags: string[];
  trials: TrialResult[];
}

export interface MetricScore {
  id: string;
  name: string;
  score: number;
  rationale: string;
}

export interface KpiComponent {
  component: string;
  score: number;
  evidence: string;
}

export interface FullTrialResult extends TrialResult {
  turns: TranscriptTurn[];
  tool_calls: ToolCall[];
  kb_calls: KBCall[];
  annotations: Annotation[];
  assignment?: Assignment | null;
  metric_scores?: MetricScore[];
  kpi_components?: KpiComponent[];
  vapi_trace?: VapiTrace | null;
}
