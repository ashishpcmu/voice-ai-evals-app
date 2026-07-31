import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  description: text('description'),
  prompt: text('prompt'),
  sop: text('sop'),
  llm_type: text('llm_type').default('openai'), // openai|claude
  agent_type: text('agent_type').default('chat'), // chat|voice
  phone_number: text('phone_number'),
  silence_timeout: integer('silence_timeout').default(5), // seconds to wait for agent to respond before recording ends
  stt_mode: text('stt_mode').default('record'), // record|gather
  main_agent_speaks_first: integer('main_agent_speaks_first').default(1), // voice: agent greets first (inbound) when 1
  tools: text('tools'), // JSON array
  knowledge_bases: text('knowledge_bases'), // JSON array
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  name: text('name').notNull(),
  tone: text('tone'),
  goal: text('goal'),
  frustration_level: integer('frustration_level'),
  additional_attributes: text('additional_attributes'), // JSON
  is_synthetic: integer('is_synthetic', { mode: 'boolean' }).default(false),
  created_at: text('created_at').notNull(),
});

export const scenarios = sqliteTable('scenarios', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  seed_utterance: text('seed_utterance').notNull(),
  expected_outcome_type: text('expected_outcome_type').notNull(), // natural_language|tool_call|kpi_threshold
  expected_outcome_value: text('expected_outcome_value'),
  persona_id: text('persona_id'),
  tags: text('tags'), // JSON array
  metric_ids: text('metric_ids'), // JSON array of metric IDs
  status: text('status').notNull().default('draft'), // draft|active|archived
  created_by: text('created_by'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const eval_runs = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  agent_version: text('agent_version'),
  name: text('name').notNull(),
  scenario_ids: text('scenario_ids'), // JSON array
  n_trials: integer('n_trials').notNull().default(1),
  k_threshold: integer('k_threshold').notNull().default(1),
  max_turns: integer('max_turns').notNull().default(5),
  customer_simulator_model: text('customer_simulator_model').default('gpt-3.5-turbo'),
  metric_ids: text('metric_ids'), // JSON array
  mode: text('mode').notNull().default('mock'), // mock|live
  status: text('status').notNull().default('pending'), // pending|running|complete|failed
  voice_provider: text('voice_provider'), // 'twilio' (default) | 'livekit' — voice agent runs only
  voice_config: text('voice_config'), // JSON: {stt, llm, ttsProvider, ttsVoice, ttsSpeed} — livekit voice runs
  summary_metrics: text('summary_metrics'), // JSON
  created_at: text('created_at').notNull(),
  completed_at: text('completed_at'),
});

export const trial_results = sqliteTable('trial_results', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  scenario_id: text('scenario_id').notNull(),
  trial_index: integer('trial_index').notNull(),
  kpi_score: real('kpi_score'),
  kpi_rationale: text('kpi_rationale'),
  kpi_components: text('kpi_components'), // JSON: [{component, score, evidence}]
  pass_fail: integer('pass_fail', { mode: 'boolean' }),
  nfr_metrics: text('nfr_metrics'), // JSON: {ttft, avg_latency, e2e_latency, cost, input_tokens, output_tokens, model_calls}
  talk_ratio: real('talk_ratio'),
  metric_scores: text('metric_scores'), // JSON: [{id, name, score, rationale}]
  vapi_trace: text('vapi_trace'), // JSON dump of full Vapi call record (vapi trials only)
  recording_session_id: text('recording_session_id'), // key into call recording store (voice/vapi trials)
  recording_provider: text('recording_provider'), // 'voice' (default) | 'livekit' — which recording route serves recording_session_id
  created_at: text('created_at').notNull(),
});

export const transcript_turns = sqliteTable('transcript_turns', {
  id: text('id').primaryKey(),
  trial_result_id: text('trial_result_id').notNull(),
  turn_index: integer('turn_index').notNull(),
  role: text('role').notNull(), // user|agent|tool|kb
  content: text('content').notNull(),
  timestamp_ms: integer('timestamp_ms'),
  metadata: text('metadata'), // JSON
});

export const tool_calls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  turn_id: text('turn_id').notNull(),
  tool_name: text('tool_name').notNull(),
  input_args: text('input_args'), // JSON
  response: text('response'), // JSON
  latency_ms: integer('latency_ms'),
  status: text('status').notNull().default('success'), // success|error
});

export const kb_calls = sqliteTable('kb_calls', {
  id: text('id').primaryKey(),
  turn_id: text('turn_id').notNull(),
  query: text('query').notNull(),
  chunks: text('chunks'), // JSON: [{title, snippet, score}]
  latency_ms: integer('latency_ms'),
  kb_source: text('kb_source'),
});

export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  trial_result_id: text('trial_result_id').notNull(),
  turn_id: text('turn_id'),
  note_text: text('note_text').notNull(),
  tags: text('tags'), // JSON array
  author_id: text('author_id'),
  author_name: text('author_name'),
  created_at: text('created_at').notNull(),
});

export const assignments = sqliteTable('assignments', {
  id: text('id').primaryKey(),
  trial_result_id: text('trial_result_id').notNull(),
  assignee_id: text('assignee_id'),
  assignee_name: text('assignee_name'),
  status: text('status').notNull().default('unassigned'), // unassigned|in_review|resolved
  due_date: text('due_date'),
  history: text('history'), // JSON
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const human_ratings = sqliteTable('human_ratings', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  scenario_id: text('scenario_id').notNull(),
  trial_result_id: text('trial_result_id').notNull(),
  rater_id: text('rater_id'),
  rater_name: text('rater_name'),
  rating: text('rating').notNull(), // pass|fail
  comment: text('comment'),
  created_at: text('created_at').notNull(),
});

export const disagreement_reports = sqliteTable('disagreement_reports', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  disagreement_rate: real('disagreement_rate'),
  kappa_score: real('kappa_score'),
  false_positives: text('false_positives'), // JSON
  false_negatives: text('false_negatives'), // JSON
  summary: text('summary'),
  generated_at: text('generated_at').notNull(),
});

export const uploaded_files = sqliteTable('uploaded_files', {
  id: text('id').primaryKey(),
  original_name: text('original_name').notNull(),
  file_path: text('file_path').notNull(),
  file_type: text('file_type').notNull(), // pdf|docx
  parsed_content: text('parsed_content'),
  parsing_status: text('parsing_status').notNull().default('pending'), // pending|complete|error
  created_at: text('created_at').notNull(),
});

export const metrics = sqliteTable('metrics', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('conversation'), // conversation|turn
  status: text('status').notNull().default('active'), // active|archived
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value'),
  updated_at: text('updated_at').notNull(),
});

export const team_members = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  created_at: text('created_at').notNull(),
});
