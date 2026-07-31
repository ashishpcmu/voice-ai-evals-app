import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../data/bais.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let dbInstance: Database | null = null;

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (dbInstance) {
      const data = dbInstance.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
  }, SAVE_DEBOUNCE_MS);
}

type SqliteRow = Record<string, string | number | boolean | null | Buffer>;

export interface SqliteStatement {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => SqliteRow | undefined;
  all: (...params: unknown[]) => SqliteRow[];
}

function getDb() {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
}

export const sqlite = {
  exec(sql: string) {
    getDb().run(sql);
    scheduleSave();
  },
  prepare(sql: string): SqliteStatement {
    return {
      run(...params: unknown[]) {
        // sql.js BindParams only allows string|number|null|Uint8Array - cast booleans to numbers
        const normalized = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p instanceof Buffer ? new Uint8Array(p) : p);
        getDb().run(sql, normalized as (string | number | null | Uint8Array)[]);
        scheduleSave();
      },
      get(...params: unknown[]) {
        const stmt = getDb().prepare(sql);
        if (params.length > 0) {
          const normalized = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p instanceof Buffer ? new Uint8Array(p) : p);
          stmt.bind(normalized as (string | number | null | Uint8Array)[]);
        }
        const hasRow = stmt.step();
        if (hasRow) {
          const result = stmt.getAsObject() as SqliteRow;
          stmt.free();
          return result;
        }
        stmt.free();
        return undefined;
      },
      all(...params: unknown[]) {
        const results: SqliteRow[] = [];
        const stmt = getDb().prepare(sql);
        if (params.length > 0) {
          const normalized = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p instanceof Buffer ? new Uint8Array(p) : p);
          stmt.bind(normalized as (string | number | null | Uint8Array)[]);
        }
        while (stmt.step()) {
          results.push(stmt.getAsObject() as SqliteRow);
        }
        stmt.free();
        return results;
      }
    };
  }
};

function now() {
  return new Date().toISOString();
}

function createTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      prompt TEXT,
      sop TEXT,
      tools TEXT,
      knowledge_bases TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tone TEXT,
      goal TEXT,
      frustration_level INTEGER,
      additional_attributes TEXT,
      is_synthetic INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      seed_utterance TEXT NOT NULL,
      expected_outcome_type TEXT NOT NULL,
      expected_outcome_value TEXT,
      persona_id TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_version TEXT,
      name TEXT NOT NULL,
      scenario_ids TEXT,
      n_trials INTEGER NOT NULL DEFAULT 1,
      k_threshold INTEGER NOT NULL DEFAULT 1,
      metric_ids TEXT,
      mode TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'pending',
      summary_metrics TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS trial_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      trial_index INTEGER NOT NULL,
      kpi_score REAL,
      kpi_rationale TEXT,
      pass_fail INTEGER,
      nfr_metrics TEXT,
      talk_ratio REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_turns (
      id TEXT PRIMARY KEY,
      trial_result_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp_ms INTEGER,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_args TEXT,
      response TEXT,
      latency_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'success'
    );

    CREATE TABLE IF NOT EXISTS kb_calls (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      query TEXT NOT NULL,
      chunks TEXT,
      latency_ms INTEGER,
      kb_source TEXT
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      trial_result_id TEXT NOT NULL,
      turn_id TEXT,
      note_text TEXT NOT NULL,
      tags TEXT,
      author_id TEXT,
      author_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      trial_result_id TEXT NOT NULL,
      assignee_id TEXT,
      assignee_name TEXT,
      status TEXT NOT NULL DEFAULT 'unassigned',
      due_date TEXT,
      history TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_ratings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      trial_result_id TEXT NOT NULL,
      rater_id TEXT,
      rater_name TEXT,
      rating TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disagreement_reports (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      disagreement_rate REAL,
      kappa_score REAL,
      false_positives TEXT,
      false_negatives TEXT,
      summary TEXT,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      parsed_content TEXT,
      parsing_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'conversation',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function seedDatabase() {
  const agentCount = sqlite.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number } | undefined;
  if (agentCount && agentCount.count > 0) return;

  console.log('Seeding database with initial data...');

  const agentId = uuidv4();
  const personaIds = [uuidv4(), uuidv4(), uuidv4()];
  const scenarioIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
  const runId = uuidv4();
  const metricIds = [uuidv4(), uuidv4(), uuidv4()];

  sqlite.prepare(`INSERT INTO agents (id, name, version, prompt, sop, tools, knowledge_bases, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(agentId, 'Policy Cancellation Agent', 'v1',
      'You are a helpful insurance policy cancellation agent for Safeguard Insurance. Your goal is to assist customers with policy cancellations while attempting to retain customers where possible.',
      'Standard Operating Procedure:\n1. Verify customer identity\n2. Retrieve policy details\n3. Understand reason for cancellation\n4. Offer retention options if applicable\n5. Process cancellation if customer confirms\n6. Provide cancellation confirmation',
      JSON.stringify(['verify_customer_identity', 'get_policy_details', 'process_cancellation', 'offer_discount', 'check_refund_eligibility']),
      JSON.stringify(['policy_cancellation_faq', 'refund_policy', 'retention_offers']),
      now(), now());

  const personas = [
    { id: personaIds[0], name: 'Frustrated Customer', description: 'A customer who is highly frustrated and wants to resolve their issue immediately. Uses short, direct sentences and may express annoyance.', tone: 'frustrated', goal: 'cancel immediately', frustration_level: 8, language: 'English', interruption_level: 4, speed: 4 },
    { id: personaIds[1], name: 'Confused Customer', description: 'A customer who is uncertain about what they want and needs guidance. Asks many clarifying questions and may change their mind mid-conversation.', tone: 'confused', goal: 'unclear', frustration_level: 4, language: 'English', interruption_level: 2, speed: 2 },
    { id: personaIds[2], name: 'Interruptive Male Customer', description: 'An assertive male customer who frequently interrupts the agent and speaks quickly. Often completes sentences before the agent finishes.', tone: 'assertive', goal: 'quick resolution', frustration_level: 6, language: 'English', interruption_level: 5, speed: 5 },
  ];

  for (const p of personas) {
    sqlite.prepare(`INSERT INTO personas (id, agent_id, name, description, tone, goal, frustration_level, language, interruption_level, speed, additional_attributes, is_synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.id, agentId, p.name, p.description, p.tone, p.goal, p.frustration_level, p.language, p.interruption_level, p.speed, JSON.stringify({}), 0, now());
  }

  const scenarioData = [
    { id: scenarioIds[0], name: 'Standard Cancellation', seed: "Hi, I'd like to cancel my insurance policy.", outcome_type: 'natural_language', outcome_value: 'Agent successfully processes policy cancellation and provides confirmation number', persona_id: personaIds[0] },
    { id: scenarioIds[1], name: 'Price Objection — Retention Opportunity', seed: "I want to cancel, your prices are way too high.", outcome_type: 'natural_language', outcome_value: 'Agent identifies retention opportunity and offers discount', persona_id: personaIds[1] },
    { id: scenarioIds[2], name: 'Urgent Cancellation', seed: "I need to cancel immediately, I just bought a new policy elsewhere.", outcome_type: 'tool_call', outcome_value: 'process_cancellation', persona_id: personaIds[0] },
    { id: scenarioIds[3], name: 'Confused Customer', seed: "I'm not sure if I want to cancel or just change my plan...", outcome_type: 'natural_language', outcome_value: 'Agent helps customer clarify needs', persona_id: personaIds[2] },
    { id: scenarioIds[4], name: 'Verification Failure', seed: "I want to cancel but I don't have my policy number handy.", outcome_type: 'natural_language', outcome_value: 'Agent attempts alternative verification and handles gracefully', persona_id: personaIds[0] },
  ];

  for (const s of scenarioData) {
    sqlite.prepare(`INSERT INTO scenarios (id, agent_id, name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, agentId, s.name, `Test scenario: ${s.name}`, s.seed, s.outcome_type, s.outcome_value, s.persona_id, JSON.stringify(['insurance', 'cancellation']), 'active', 'system', now(), now());
  }

  const metricsData = [
    { id: metricIds[0], name: 'KPI Score', description: 'Overall conversation quality and goal achievement score', type: 'conversation' },
    { id: metricIds[1], name: 'Response Quality', description: 'Evaluates the quality, accuracy and appropriateness of agent responses', type: 'turn' },
    { id: metricIds[2], name: 'Resolution Rate', description: 'Whether the customer issue was fully resolved in the conversation', type: 'conversation' },
  ];

  for (const m of metricsData) {
    sqlite.prepare(`INSERT INTO metrics (id, name, description, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(m.id, m.name, m.description, m.type, 'active', now(), now());
  }

  sqlite.prepare(`INSERT INTO eval_runs (id, agent_id, agent_version, name, scenario_ids, n_trials, k_threshold, metric_ids, mode, status, summary_metrics, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(runId, agentId, 'v1', 'Initial Evaluation Run — Mar 2026',
      JSON.stringify(scenarioIds), 1, 1, JSON.stringify(metricIds),
      'mock', 'complete',
      JSON.stringify({ avg_kpi: 0.76, pass_rate: 0.80, avg_ttft: 820, avg_latency: 1180, total_cost: 0.0148, total_trials: 5 }),
      now(), now());

  const trialData = [
    {
      scenario_id: scenarioIds[0], kpi_score: 0.85, pass_fail: 1, ttft: 780, avg_latency: 1100, e2e_latency: 8800, cost: 0.0028, input_tokens: 890, output_tokens: 420, model_calls: 3, talk_ratio: 1.4,
      kpi_rationale: 'The agent successfully verified customer identity, attempted retention, and processed the cancellation professionally.',
      turns: [
        { role: 'user', content: "Hi, I'd like to cancel my insurance policy.", ts: 0 },
        { role: 'agent', content: "I'd be happy to help you with your cancellation request. To get started, I'll need to verify your identity.", ts: 780 },
        { role: 'tool', content: 'verify_customer_identity', ts: 2100 },
        { role: 'agent', content: "Thank you, I've verified your identity successfully. Before I proceed, may I ask the reason for your request?", ts: 2900 },
        { role: 'kb', content: 'policy_cancellation_faq', ts: 3200 },
        { role: 'agent', content: "I can see you've been with us for 3 years. Could I offer you a 15% discount as a loyalty gesture?", ts: 4100 },
        { role: 'user', content: "That's a nice offer but I've already made my decision. Please proceed with the cancellation.", ts: 5200 },
        { role: 'tool', content: 'process_cancellation', ts: 6300 },
        { role: 'agent', content: "I've processed your cancellation. Your confirmation number is CAN-20240315-1234. You'll receive a refund of $340 within 5-7 business days.", ts: 7100 },
        { role: 'user', content: "No, that's all. Thank you.", ts: 8200 },
        { role: 'agent', content: "You're welcome! Have a great day!", ts: 8800 },
      ]
    },
    {
      scenario_id: scenarioIds[1], kpi_score: 0.92, pass_fail: 1, ttft: 820, avg_latency: 1200, e2e_latency: 9500, cost: 0.0032, input_tokens: 950, output_tokens: 480, model_calls: 4, talk_ratio: 1.6,
      kpi_rationale: 'Excellent retention conversation. Agent identified price objection, presented multiple options, customer was retained.',
      turns: [
        { role: 'user', content: "I want to cancel, your prices are way too high.", ts: 0 },
        { role: 'agent', content: "I'm sorry to hear about your pricing concerns. Let me pull up your account.", ts: 820 },
        { role: 'tool', content: 'verify_customer_identity', ts: 1900 },
        { role: 'tool', content: 'get_policy_details', ts: 2800 },
        { role: 'kb', content: 'retention_offers', ts: 3200 },
        { role: 'agent', content: "I can offer you a 20% loyalty discount ($116/month) or switch to our Standard plan at $89/month. Which interests you?", ts: 4100 },
        { role: 'user', content: "The loyalty discount sounds interesting. What changes?", ts: 5300 },
        { role: 'agent', content: "Nothing changes with your coverage! You keep all benefits but pay $116 instead of $145 — saving $348 per year.", ts: 6200 },
        { role: 'user', content: "That sounds reasonable. Let's do that.", ts: 7400 },
        { role: 'tool', content: 'offer_discount', ts: 8100 },
        { role: 'agent', content: "Done! 20% loyalty discount applied. New premium: $116/month from next billing cycle.", ts: 8900 },
      ]
    },
    {
      scenario_id: scenarioIds[2], kpi_score: 0.78, pass_fail: 1, ttft: 750, avg_latency: 1050, e2e_latency: 7200, cost: 0.0024, input_tokens: 760, output_tokens: 380, model_calls: 3, talk_ratio: 1.2,
      kpi_rationale: 'Efficient urgent cancellation handled correctly. Required tool call process_cancellation was executed.',
      turns: [
        { role: 'user', content: "I need to cancel immediately, I just bought a new policy elsewhere.", ts: 0 },
        { role: 'agent', content: "I understand the urgency. Let me verify your identity first.", ts: 750 },
        { role: 'tool', content: 'verify_customer_identity', ts: 1800 },
        { role: 'tool', content: 'check_refund_eligibility', ts: 2600 },
        { role: 'agent', content: "Identity verified. You're eligible for a pro-rated refund of $127. Shall I proceed?", ts: 3400 },
        { role: 'user', content: "Yes please, proceed.", ts: 4500 },
        { role: 'tool', content: 'process_cancellation', ts: 5300 },
        { role: 'kb', content: 'refund_policy', ts: 5600 },
        { role: 'agent', content: "Done! Policy cancelled. Confirmation: CAN-20240315-5678. Refund of $127 within 3-5 business days.", ts: 6400 },
        { role: 'user', content: "Thank you.", ts: 7200 },
      ]
    },
    {
      scenario_id: scenarioIds[3], kpi_score: 0.68, pass_fail: 0, ttft: 890, avg_latency: 1350, e2e_latency: 11200, cost: 0.0038, input_tokens: 1100, output_tokens: 560, model_calls: 4, talk_ratio: 1.9,
      kpi_rationale: 'Agent provided helpful info but conversation ended without definitive resolution — customer needed time to think.',
      turns: [
        { role: 'user', content: "I'm not sure if I want to cancel or just change my plan...", ts: 0 },
        { role: 'agent', content: "It sounds like you're evaluating options. Could you share what's prompting this?", ts: 890 },
        { role: 'user', content: "Mainly cost, but I want good coverage.", ts: 2100 },
        { role: 'tool', content: 'verify_customer_identity', ts: 2900 },
        { role: 'tool', content: 'get_policy_details', ts: 3800 },
        { role: 'kb', content: 'retention_offers', ts: 4200 },
        { role: 'agent', content: "You're on Premium at $145/month. I suggest a loyalty discount to $116/month with identical coverage.", ts: 5200 },
        { role: 'user', content: "I'll need to think about it. Can I call back?", ts: 9100 },
        { role: 'agent', content: "Of course! When ready, call 1-800-SAFEGUARD. I've noted the Standard plan recommendation.", ts: 10200 },
        { role: 'user', content: "Thanks.", ts: 11200 },
      ]
    },
    {
      scenario_id: scenarioIds[4], kpi_score: 0.55, pass_fail: 0, ttft: 860, avg_latency: 1240, e2e_latency: 9800, cost: 0.0026, input_tokens: 820, output_tokens: 410, model_calls: 3, talk_ratio: 2.1,
      kpi_rationale: 'Agent correctly followed security protocols. Could not process cancellation without proper verification. Offered alternative path.',
      turns: [
        { role: 'user', content: "I want to cancel but I don't have my policy number handy.", ts: 0 },
        { role: 'agent', content: "No problem! I can verify you through other means. Could you provide your date of birth and email?", ts: 860 },
        { role: 'user', content: "It's John Doe, born March 15, 1980. Email: john.doe@email.com", ts: 2100 },
        { role: 'tool', content: 'verify_customer_identity', ts: 3000 },
        { role: 'agent', content: "I need one more piece of information: your SSN last 4 digits or phone number on file.", ts: 3800 },
        { role: 'user', content: "I don't have those with me either.", ts: 4900 },
        { role: 'kb', content: 'policy_cancellation_faq', ts: 5200 },
        { role: 'agent', content: "For security, I cannot process without proper verification. I can email you a secure cancellation link valid for 48 hours.", ts: 6100 },
        { role: 'user', content: "Please send the email.", ts: 7300 },
        { role: 'agent', content: "Sent to john.doe@email.com! The link is valid for 48 hours. Is there anything else?", ts: 8500 },
        { role: 'user', content: "No, I'll check the email.", ts: 9800 },
      ]
    },
  ];

  const toolCallMocks: Record<string, { input: object; output: object }> = {
    verify_customer_identity: { input: { dob: '1990-01-01', ssn_last4: '1234', policy_id: 'POL-9988' }, output: { verified: true, customer_name: 'Jane Smith', policy_id: 'POL-9988' } },
    get_policy_details: { input: { policy_id: 'POL-9988' }, output: { policy_id: 'POL-9988', plan: 'Premium', premium: 145, coverage_limit: 500000, status: 'active' } },
    process_cancellation: { input: { policy_id: 'POL-9988', reason: 'customer_request' }, output: { success: true, confirmation_number: 'CAN-20240315-1234', refund_amount: 340 } },
    offer_discount: { input: { policy_id: 'POL-9988', discount_type: 'loyalty', discount_percent: 20 }, output: { success: true, new_premium: 116, savings_annual: 348 } },
    check_refund_eligibility: { input: { policy_id: 'POL-9988' }, output: { eligible: true, refund_amount: 127 } },
  };

  const kbMocks: Record<string, { query: string; chunks: object[] }> = {
    policy_cancellation_faq: { query: 'What are the cancellation terms?', chunks: [
      { title: 'Policy Cancellation Guide', snippet: 'Policies can be cancelled at any time. Pro-rated refunds issued for unused periods.', score: 0.94 },
      { title: 'Refund Processing Rules', snippet: 'Refunds processed within 5-7 business days to original payment method.', score: 0.87 },
      { title: 'Early Termination Fees', snippet: 'No early termination fees for standard policies.', score: 0.71 }
    ]},
    retention_offers: { query: 'What retention offers are available?', chunks: [
      { title: 'Loyalty Discount Program', snippet: 'Customers with 2+ years eligible for 15-20% loyalty discount.', score: 0.96 },
      { title: 'Plan Downgrade Options', snippet: 'Downgrade from Premium to Standard at $89/month.', score: 0.89 }
    ]},
    refund_policy: { query: 'How are refunds calculated?', chunks: [
      { title: 'Refund Calculation', snippet: 'Pro-rated refund = (Remaining days / Period days) × Monthly premium.', score: 0.93 }
    ]},
  };

  for (let i = 0; i < trialData.length; i++) {
    const trial = trialData[i];
    const trialId = uuidv4();

    sqlite.prepare(`INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics, talk_ratio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(trialId, runId, trial.scenario_id, 0, trial.kpi_score, trial.kpi_rationale, trial.pass_fail,
        JSON.stringify({ ttft: trial.ttft, avg_latency: trial.avg_latency, e2e_latency: trial.e2e_latency, cost: trial.cost, input_tokens: trial.input_tokens, output_tokens: trial.output_tokens, model_calls: trial.model_calls }),
        trial.talk_ratio, now());

    const turnIdsByIndex: Record<number, string> = {};

    for (let j = 0; j < trial.turns.length; j++) {
      const turn = trial.turns[j];
      const turnId = uuidv4();
      turnIdsByIndex[j] = turnId;

      if (turn.role === 'tool') {
        sqlite.prepare(`INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(turnId, trialId, j, 'tool', `Tool call: ${turn.content}`, turn.ts, JSON.stringify({ tool_name: turn.content }));
        const mock = toolCallMocks[turn.content] || { input: {}, output: { success: true } };
        sqlite.prepare(`INSERT INTO tool_calls (id, turn_id, tool_name, input_args, response, latency_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(uuidv4(), turnId, turn.content, JSON.stringify(mock.input), JSON.stringify(mock.output), 100 + Math.floor(Math.random() * 100), 'success');
      } else if (turn.role === 'kb') {
        sqlite.prepare(`INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(turnId, trialId, j, 'kb', `KB lookup: ${turn.content}`, turn.ts, JSON.stringify({ kb_source: turn.content }));
        const kbm = kbMocks[turn.content] || { query: turn.content, chunks: [{ title: 'Info', snippet: 'Retrieved.', score: 0.75 }] };
        sqlite.prepare(`INSERT INTO kb_calls (id, turn_id, query, chunks, latency_ms, kb_source) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(uuidv4(), turnId, kbm.query, JSON.stringify(kbm.chunks), 60 + Math.floor(Math.random() * 50), turn.content);
      } else {
        sqlite.prepare(`INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(turnId, trialId, j, turn.role, turn.content, turn.ts, JSON.stringify({}));
      }
    }

    if (i === 0) {
      sqlite.prepare(`INSERT INTO annotations (id, trial_result_id, turn_id, note_text, tags, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), trialId, null, 'Good handling of the retention attempt. Consider being more specific about discount terms upfront.', JSON.stringify(['review', 'retention']), 'user-1', 'Sarah Johnson', now());
      sqlite.prepare(`INSERT INTO annotations (id, trial_result_id, turn_id, note_text, tags, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), trialId, null, 'Agent correctly followed SOP steps 1-5. Minor suggestion: provide refund timeline proactively.', JSON.stringify(['sop-compliance']), 'user-2', 'Michael Chen', now());
      sqlite.prepare(`INSERT INTO assignments (id, trial_result_id, assignee_id, assignee_name, status, due_date, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), trialId, 'user-3', 'Alex Rodriguez', 'in_review', new Date(Date.now() + 7 * 86400000).toISOString(), JSON.stringify([{ status: 'in_review', changed_at: now() }]), now(), now());
    }
  }

  const defaultSettings = [
    { key: 'talk_ratio_warning', value: '2.0' },
    { key: 'talk_ratio_danger', value: '3.5' },
    { key: 'default_n_trials', value: '1' },
    { key: 'default_k_threshold', value: '1' },
    { key: 'cost_per_1k_tokens', value: '0.002' },
  ];
  for (const s of defaultSettings) {
    sqlite.prepare(`INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), s.key, s.value, now());
  }

  const teamMembers = [
    { id: uuidv4(), name: 'Sarah Johnson', email: 'sarah.johnson@company.com', role: 'QA Engineer' },
    { id: uuidv4(), name: 'Michael Chen', email: 'michael.chen@company.com', role: 'Product Manager' },
    { id: uuidv4(), name: 'Alex Rodriguez', email: 'alex.rodriguez@company.com', role: 'QA Engineer' },
    { id: uuidv4(), name: 'Emma Wilson', email: 'emma.wilson@company.com', role: 'Data Analyst' },
  ];
  for (const m of teamMembers) {
    sqlite.prepare(`INSERT INTO team_members (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(m.id, m.name, m.email, m.role, now());
  }

  // Save immediately after seeding
  if (dbInstance) {
    const data = dbInstance.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  console.log('Database seeded successfully!');
}

export async function initializeDatabase(): Promise<void> {
  // The sql.js package main entry is dist/sql-wasm.js, so wasm is in the same dir
  const sqlJsDir = path.dirname(require.resolve('sql.js'));
  const wasmPath = path.join(sqlJsDir, 'sql-wasm.wasm');

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Cannot find sql-wasm.wasm at: ${wasmPath}`);
  }

  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.run('PRAGMA journal_mode = WAL;');

  createTables();
  // Add agent_type column if it doesn't exist (migration for existing DBs)
  try { sqlite.exec(`ALTER TABLE scenarios ADD COLUMN metric_ids TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN agent_type TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN agent_system_prompt TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN voice_config TEXT`); } catch { /* already exists */ }
  // Add new agent fields
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN description TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN llm_type TEXT DEFAULT 'openai'`); } catch { /* already exists */ }
  // Add test_agent_id to eval_runs
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN test_agent_id TEXT`); } catch { /* already exists */ }
  // Add tags column to trial_results
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN tags TEXT`); } catch { /* already exists */ }
  // Add new persona fields
  // Recreate personas table to remove NOT NULL constraint on agent_id
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS personas_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        name TEXT NOT NULL,
        tone TEXT,
        goal TEXT,
        frustration_level INTEGER,
        additional_attributes TEXT,
        is_synthetic INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        description TEXT,
        language TEXT DEFAULT 'English',
        interruption_level INTEGER DEFAULT 3,
        speed INTEGER DEFAULT 3
      );
      INSERT OR IGNORE INTO personas_new SELECT id, agent_id, name, tone, goal, frustration_level, additional_attributes, is_synthetic, created_at,
        CASE WHEN typeof(description) != 'null' THEN description ELSE NULL END,
        CASE WHEN typeof(language) != 'null' THEN language ELSE 'English' END,
        CASE WHEN typeof(interruption_level) != 'null' THEN interruption_level ELSE 3 END,
        CASE WHEN typeof(speed) != 'null' THEN speed ELSE 3 END
        FROM personas;
      DROP TABLE personas;
      ALTER TABLE personas_new RENAME TO personas;
    `);
  } catch { /* already migrated */ }
  try { sqlite.exec(`ALTER TABLE personas ADD COLUMN description TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE personas ADD COLUMN language TEXT DEFAULT 'English'`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE personas ADD COLUMN interruption_level INTEGER DEFAULT 3`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE personas ADD COLUMN speed INTEGER DEFAULT 3`); } catch { /* already exists */ }
  // Add voice agent fields
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT 'chat'`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN phone_number TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN max_turns INTEGER DEFAULT 5`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN metric_scores TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN kpi_components TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN silence_timeout INTEGER DEFAULT 5`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN stt_mode TEXT DEFAULT 'record'`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN customer_simulator_model TEXT DEFAULT 'gpt-3.5-turbo'`); } catch { /* already exists */ }
  // Vapi agent fields
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN vapi_api_key TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN vapi_assistant_id TEXT`); } catch { /* already exists */ }
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN vapi_speaks_first INTEGER DEFAULT 1`); } catch { /* already exists */ }
  // Voice (LiveKit/Twilio) agent: when 1 (default), the agent-under-test greets
  // first (inbound use case) and the customer simulator replies after the agent's
  // first turn. When 0, the simulator speaks the seed first (outbound).
  try { sqlite.exec(`ALTER TABLE agents ADD COLUMN main_agent_speaks_first INTEGER DEFAULT 1`); } catch { /* already exists */ }
  // Vapi trace storage on trial results
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN vapi_trace TEXT`); } catch { /* already exists */ }
  // Recording session id for voice / vapi trials — keys into the in-memory
  // recording store (services/callRecordingStore.ts) for download / delete.
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN recording_session_id TEXT`); } catch { /* already exists */ }
  // Voice provider for a run — 'twilio' (default, TwiML) or 'livekit' (LiveKit
  // Cloud + SIP trunk, streaming STT/TTS). Only meaningful for voice agent runs.
  try { sqlite.exec(`ALTER TABLE eval_runs ADD COLUMN voice_provider TEXT`); } catch { /* already exists */ }
  // Recording provider for a trial — tells the frontend which recording route
  // ('/voice' vs '/livekit') serves recording_session_id. Defaults to 'voice'.
  try { sqlite.exec(`ALTER TABLE trial_results ADD COLUMN recording_provider TEXT`); } catch { /* already exists */ }
  seedDatabase();
  seedPersonas();
}

function seedPersonas() {
  const count = sqlite.prepare('SELECT COUNT(*) as count FROM personas').get() as { count: number } | undefined;
  if (count && count.count > 0) return;

  console.log('Seeding personas...');
  const personas = [
    { name: 'Frustrated Customer', description: 'A customer who is highly frustrated and wants to resolve their issue immediately. Uses short, direct sentences and may express annoyance.', tone: 'frustrated', goal: 'cancel immediately', frustration_level: 8, language: 'English', interruption_level: 4, speed: 4 },
    { name: 'Confused Customer', description: 'A customer who is uncertain about what they want and needs guidance. Asks many clarifying questions and may change their mind mid-conversation.', tone: 'confused', goal: 'unclear', frustration_level: 4, language: 'English', interruption_level: 2, speed: 2 },
    { name: 'Interruptive Male Customer', description: 'An assertive male customer who frequently interrupts the agent and speaks quickly. Often completes sentences before the agent finishes.', tone: 'assertive', goal: 'quick resolution', frustration_level: 6, language: 'English', interruption_level: 5, speed: 5 },
  ];
  for (const p of personas) {
    sqlite.prepare(`INSERT INTO personas (id, agent_id, name, description, tone, goal, frustration_level, language, interruption_level, speed, additional_attributes, is_synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), null, p.name, p.description, p.tone, p.goal, p.frustration_level, p.language, p.interruption_level, p.speed, JSON.stringify({}), 0, now());
  }
}
