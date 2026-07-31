export interface Agent {
  id: string;
  name: string;
  version: string;
  prompt?: string;
  sop?: string;
  tools?: string[];
  knowledge_bases?: string[];
  created_at: string;
  updated_at: string;
}

export interface Persona {
  id: string;
  agent_id: string;
  name: string;
  tone?: string;
  goal?: string;
  frustration_level?: number;
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
  mode: 'mock' | 'live';
  status: 'pending' | 'running' | 'complete' | 'failed';
  summary_metrics?: Record<string, number>;
  created_at: string;
  completed_at?: string;
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
  created_at: string;
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

export interface KBCall {
  id: string;
  turn_id: string;
  query: string;
  chunks?: KBChunk[];
  latency_ms?: number;
  kb_source?: string;
}

export interface KBChunk {
  title: string;
  snippet: string;
  score: number;
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
  history?: Array<{ status: string; changed_at: string }>;
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

export interface SimulationResult {
  turns: TranscriptTurn[];
  tool_calls: ToolCall[];
  kb_calls: KBCall[];
  nfr_metrics: NFRMetrics;
  talk_ratio: number;
}
