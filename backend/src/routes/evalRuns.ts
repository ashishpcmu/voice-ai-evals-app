import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { runSimulation } from '../services/simulator';
import { scoreConversation, scoreMetrics } from '../services/scorer';
import { runVoiceTrial, runVapiTrialForEvalRun, buildCustomerContext, twilioCallStates } from '../services/voiceEval';
import {
  runLiveKitTrial,
  cancelLiveKitEval,
  livekitCallStates,
  isLiveKitConfigured,
  type LiveKitConfig,
} from '../services/livekitEval';
import { randomUUID } from 'crypto';

// Per-run voice progress tracker (in-memory, cleared when run completes)
interface VoiceRunProgress {
  sessionId: string;
  scenarioIndex: number;   // 1-based
  totalScenarios: number;
  trialIndex: number;      // 1-based
  totalTrials: number;
  scenarioName: string;
  /** 'twilio' | 'vapi' | 'livekit' — which call engine drives this trial. */
  provider: 'twilio' | 'vapi' | 'livekit';
}
const voiceRunProgress = new Map<string, VoiceRunProgress>();

const router = Router();

function now() { return new Date().toISOString(); }

function parseRun(row: Record<string, unknown>) {
  if (!row) return null;
  // Derive agent_type from the linked test agent record (authoritative source).
  // This ensures past runs created before the voice agent feature correctly reflect
  // the agent's current type rather than whatever was persisted at run creation time.
  let agentType = row.agent_type as string | null;
  if (row.test_agent_id) {
    const testAgent = sqlite.prepare('SELECT agent_type FROM agents WHERE id = ?').get(row.test_agent_id) as { agent_type?: string } | undefined;
    if (testAgent?.agent_type) agentType = testAgent.agent_type;
  }
  return {
    ...row,
    agent_type: agentType,
    scenario_ids: row.scenario_ids ? JSON.parse(row.scenario_ids as string) : [],
    metric_ids: row.metric_ids ? JSON.parse(row.metric_ids as string) : [],
    summary_metrics: row.summary_metrics ? JSON.parse(row.summary_metrics as string) : null,
    voice_config: row.voice_config ? JSON.parse(row.voice_config as string) : null,
  };
}

function parseTrialResult(row: Record<string, unknown>): Record<string, unknown> | null {
  if (!row) return null;
  return {
    ...row,
    nfr_metrics: row.nfr_metrics ? JSON.parse(row.nfr_metrics as string) : null,
    pass_fail: row.pass_fail === 1 || row.pass_fail === true,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
  };
}

// Calculate pass@k
function passAtK(n: number, passCount: number, k: number): number {
  if (passCount >= n) return 1.0;
  if (n < k) return 0;
  // pass@k = 1 - C(n-pass, k) / C(n, k)
  function combinations(n: number, k: number): number {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = result * (n - i) / (i + 1);
    }
    return result;
  }
  const numerator = combinations(n - passCount, k);
  const denominator = combinations(n, k);
  return denominator === 0 ? 0 : 1 - numerator / denominator;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const { agent_id } = req.query;
    let query = 'SELECT * FROM eval_runs WHERE 1=1';
    const params: unknown[] = [];
    if (agent_id) { query += ' AND agent_id = ?'; params.push(agent_id); }
    query += ' ORDER BY created_at DESC';
    const runs = sqlite.prepare(query).all(...params);
    res.json(runs.map(r => parseRun(r as Record<string, unknown>)));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch eval runs', code: 'FETCH_ERROR' });
  }
});

// Voice progress endpoint — polled by the frontend while a voice eval run is in progress
router.get('/:id/voice-progress', (req: Request, res: Response) => {
  const progress = voiceRunProgress.get(req.params.id);
  if (!progress) {
    return res.json({ active: false });
  }
  // Read the live call state from the engine that's driving this trial.
  const callState = progress.provider === 'livekit'
    ? livekitCallStates.get(progress.sessionId)
    : twilioCallStates.get(progress.sessionId);
  res.json({
    active: true,
    provider: progress.provider,
    sessionId: progress.sessionId,
    scenarioIndex: progress.scenarioIndex,
    totalScenarios: progress.totalScenarios,
    trialIndex: progress.trialIndex,
    totalTrials: progress.totalTrials,
    scenarioName: progress.scenarioName,
    callStatus: callState?.status ?? 'completed',
    turnCount: callState?.turns?.length ?? 0,
    // Live transcript turns (LiveKit flow streams these into the EvalRunDetail UI).
    turns: callState?.turns ?? [],
  });
});

// Cancel the in-flight LiveKit call for a running eval-run trial. Ends the
// current call early; the trial is then scored on whatever was captured and the
// run continues to the next trial/scenario. No-op for Twilio/Vapi runs.
router.post('/:id/livekit-cancel', async (req: Request, res: Response) => {
  const progress = voiceRunProgress.get(req.params.id);
  if (!progress || progress.provider !== 'livekit') {
    return res.status(404).json({ error: 'No active LiveKit call for this run', code: 'NOT_FOUND' });
  }
  const ok = await cancelLiveKitEval(progress.sessionId);
  if (!ok) return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
  res.json({ success: true });
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { agent_id, name, scenario_ids, n_trials, k_threshold, max_turns, customer_simulator_model, metric_ids, mode, agent_type, agent_system_prompt, test_agent_id, voice_provider, record_call, tts_provider, tts_speed, tts_voice } = req.body;
    if (!agent_id || !scenario_ids?.length) {
      return res.status(400).json({ error: 'agent_id and scenario_ids are required', code: 'VALIDATION_ERROR' });
    }

    const agent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id) as Record<string, unknown>;
    if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });

    // Resolve agent type and system prompt: test_agent_id takes priority
    let resolvedAgentType = agent_type || null;
    let resolvedSystemPrompt = (agent_system_prompt as string | undefined)?.trim() || null;
    if (test_agent_id) {
      const testAgent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(test_agent_id) as Record<string, unknown>;
      if (testAgent) {
        resolvedAgentType = (testAgent.agent_type === 'voice' || testAgent.agent_type === 'vapi')
          ? (testAgent.agent_type as string)
          : ((testAgent.llm_type as string) || 'openai');
        resolvedSystemPrompt = (testAgent.prompt as string) || null;
      }
    }

    const runId = uuidv4();
    const runName = name || `Run ${new Date().toLocaleDateString()}`;
    const nTrials = Math.min(Math.max(parseInt(n_trials) || 1, 1), 20);
    const kThreshold = Math.min(Math.max(parseInt(k_threshold) || 1, 1), nTrials);
    const maxTurns = Math.min(Math.max(parseInt(max_turns) || 5, 1), 50);
    const resolvedSimulatorModel = customer_simulator_model || 'gpt-3.5-turbo';
    const resolvedMode = mode || 'mock';
    // Voice provider — only meaningful for voice agent runs. 'twilio' (TwiML,
    // default, unchanged) or 'livekit' (LiveKit Cloud + SIP, streaming).
    const resolvedVoiceProvider = voice_provider === 'livekit' ? 'livekit' : 'twilio';
    // Record calls for this run? Off unless explicitly enabled (saves LiveKit
    // egress minutes / Twilio recording storage). Voice agent runs only.
    const resolvedRecordCall = record_call === true;

    // Collect metric_ids from all selected scenarios (union, deduplicated)
    const scenarioMetricIds = new Set<string>();
    for (const sid of scenario_ids as string[]) {
      const sc = sqlite.prepare('SELECT metric_ids FROM scenarios WHERE id = ?').get(sid) as Record<string, unknown> | undefined;
      if (sc?.metric_ids) {
        try {
          const ids = JSON.parse(sc.metric_ids as string) as string[];
          ids.forEach(id => scenarioMetricIds.add(id));
        } catch { /* ignore malformed */ }
      }
    }
    const resolvedMetricIds = scenarioMetricIds.size > 0
      ? [...scenarioMetricIds]
      : (metric_ids || []);

    sqlite.prepare(`
      INSERT INTO eval_runs (id, agent_id, agent_version, name, scenario_ids, n_trials, k_threshold, max_turns, customer_simulator_model, metric_ids, mode, agent_type, agent_system_prompt, test_agent_id, voice_provider, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, agent_id, agent.version as string, runName,
      JSON.stringify(scenario_ids), nTrials, kThreshold, maxTurns, resolvedSimulatorModel,
      JSON.stringify(resolvedMetricIds), resolvedMode, resolvedAgentType, resolvedSystemPrompt,
      test_agent_id || null, resolvedVoiceProvider, 'running', now());

    // Persist the resolved voice pipeline (STT/LLM/TTS) for LiveKit runs so the trace
    // inspector can show what was used. STT mirrors the worker's env-based resolution.
    if (resolvedVoiceProvider === 'livekit') {
      const sttLabel = process.env.DEEPGRAM_API_KEY
        ? ((process.env.LIVEKIT_FLUX_STT ?? 'true').toLowerCase() !== 'false'
            ? `Deepgram Flux (${process.env.LIVEKIT_FLUX_MODEL || 'flux-general-en'})`
            : `Deepgram (${process.env.DEEPGRAM_STT_MODEL || 'nova-2-phonecall'})`)
        : (process.env.GROQ_API_KEY && (process.env.STT_PROVIDER || '').toLowerCase() === 'groq'
            ? `Groq Whisper (${process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo'})`
            : `OpenAI Whisper (${process.env.OPENAI_STT_MODEL || 'whisper-1'})`);
      const voiceConfig = {
        stt: sttLabel,
        llm: resolvedSimulatorModel,
        ttsProvider: tts_provider || 'deepgram',
        ttsVoice: typeof tts_voice === 'string' && tts_voice.trim() ? tts_voice.trim() : null,
        ttsSpeed: typeof tts_speed === 'number' && tts_speed > 0 ? tts_speed : null,
      };
      sqlite.prepare('UPDATE eval_runs SET voice_config = ? WHERE id = ?').run(JSON.stringify(voiceConfig), runId);
    }

    // Resolve test agent record for voice agent detection
    let testAgentRecord: Record<string, unknown> | null = null;
    if (test_agent_id) {
      testAgentRecord = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(test_agent_id) as Record<string, unknown> | null ?? null;
    }

    // Run simulation asynchronously
    runEvaluation(runId, agent, scenario_ids, nTrials, resolvedMode, resolvedAgentType, resolvedSystemPrompt, testAgentRecord, maxTurns, resolvedSimulatorModel, resolvedVoiceProvider, resolvedRecordCall, tts_provider || 'deepgram', typeof tts_speed === 'number' && tts_speed > 0 ? tts_speed : undefined, typeof tts_voice === 'string' && tts_voice.trim() ? tts_voice.trim() : undefined).catch(err => {
      console.error('Eval run failed:', err);
      voiceRunProgress.delete(runId);
      sqlite.prepare('UPDATE eval_runs SET status = ?, completed_at = ? WHERE id = ?').run('failed', now(), runId);
    });

    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(runId) as Record<string, unknown>;
    res.status(201).json(parseRun(run));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create eval run', code: 'CREATE_ERROR' });
  }
});

async function runEvaluation(runId: string, agent: Record<string, unknown>, scenarioIds: string[], nTrials: number, mode: string, agentType?: string | null, agentSystemPrompt?: string | null, testAgent?: Record<string, unknown> | null, maxTurns = 5, customerSimulatorModel = 'gpt-3.5-turbo', voiceProvider: 'twilio' | 'livekit' = 'twilio', recordCall = false, ttsProvider = 'deepgram', ttsSpeed?: number, ttsVoice?: string) {
  const allTrialResults: Array<{ pass: boolean; kpi: number; ttft: number; latency: number; cost: number; duration_ms: number; turn_count: number }> = [];

  const isVoiceAgent = testAgent?.agent_type === 'voice' && testAgent?.phone_number;
  const isVapiAgent = testAgent?.agent_type === 'vapi' && testAgent?.phone_number;
  // LiveKit is a per-run choice that only applies to voice agents. When chosen,
  // trials run through the in-process LiveKit engine instead of Twilio TwiML.
  const useLiveKit = isVoiceAgent && voiceProvider === 'livekit';

  const getSetting = (key: string) => {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  };

  // Read LiveKit config once if this is a LiveKit voice run.
  let livekitConfig: LiveKitConfig | null = null;
  if (useLiveKit) {
    const cfg: Partial<LiveKitConfig> = {
      url: getSetting('livekit_url'),
      apiKey: getSetting('livekit_api_key'),
      apiSecret: getSetting('livekit_api_secret'),
      sipTrunkId: getSetting('livekit_sip_trunk_id'),
    };
    if (!isLiveKitConfigured(cfg)) {
      sqlite.prepare('UPDATE eval_runs SET status = ?, completed_at = ? WHERE id = ?').run('failed', now(), runId);
      console.error('[livekit-eval] LiveKit not configured. Set livekit_url, livekit_api_key, livekit_api_secret, livekit_sip_trunk_id in Settings > Voice Simulation.');
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      sqlite.prepare('UPDATE eval_runs SET status = ?, completed_at = ? WHERE id = ?').run('failed', now(), runId);
      console.error('[livekit-eval] OPENAI_API_KEY not configured (required for LiveKit TTS + scoring).');
      return;
    }
    livekitConfig = cfg;
  }

  // Read Twilio settings once if voice (Twilio) or Vapi agent
  let twilioSettings: { accountSid: string; authToken: string; fromNumber: string; webhookBaseUrl: string } | null = null;
  if ((isVoiceAgent && !useLiveKit) || isVapiAgent) {
    const accountSid = getSetting('twilio_account_sid');
    const authToken = getSetting('twilio_auth_token');
    const fromNumber = getSetting('twilio_from_number');
    const webhookBaseUrl = getSetting('twilio_webhook_url');
    if (!accountSid || !authToken || !fromNumber || !webhookBaseUrl) {
      sqlite.prepare('UPDATE eval_runs SET status = ?, completed_at = ? WHERE id = ?').run('failed', now(), runId);
      console.error('[voice-eval] Twilio not configured. Set credentials in Settings > Voice Simulation.');
      return;
    }
    twilioSettings = { accountSid, authToken, fromNumber, webhookBaseUrl };
  }

  for (const scenarioId of scenarioIds) {
    const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId) as Record<string, unknown>;
    if (!scenario) continue;

    for (let trialIndex = 0; trialIndex < nTrials; trialIndex++) {
      const trialId = uuidv4();

      if (useLiveKit && livekitConfig) {
        // ── Voice agent trial via LiveKit (streaming) ─────────────────────────
        // Mirrors the Twilio voice path below, but drives the call through the
        // in-process LiveKit engine. The customer_context built here is the same
        // prompt the LiveKit customer-simulator agent uses.
        const customerContext = buildCustomerContext({
          name: scenario.name as string,
          description: scenario.description as string | null,
          seed_utterance: scenario.seed_utterance as string,
        });

        const lkScenario = {
          id: scenarioId,
          name: scenario.name as string,
          description: (scenario.description as string) || (scenario.name as string),
          seed: scenario.seed_utterance as string,
          customer_context: customerContext,
        };

        const lkSessionId = randomUUID();
        voiceRunProgress.set(runId, {
          sessionId: lkSessionId,
          scenarioIndex: scenarioIds.indexOf(scenarioId) + 1,
          totalScenarios: scenarioIds.length,
          trialIndex: trialIndex + 1,
          totalTrials: nTrials,
          scenarioName: scenario.name as string,
          provider: 'livekit',
        });

        let lkResult: { turns: Array<{ role: 'user' | 'agent'; content: string; timestamp_ms: number }>; duration_ms: number; sessionId: string };
        try {
          lkResult = await runLiveKitTrial({
            config: livekitConfig,
            openaiApiKey: process.env.OPENAI_API_KEY || '',
            toNumber: testAgent!.phone_number as string,
            scenario: lkScenario,
            sessionId: lkSessionId,
            maxTurns,
            silenceTimeout: (testAgent?.silence_timeout as number) ?? 3,
            // Agent-level setting: when 1/undefined (default), the agent-under-test
            // greets first (inbound) and the simulator replies after; when 0, the
            // simulator speaks the seed first (outbound).
            mainAgentSpeaksFirst: testAgent?.main_agent_speaks_first !== 0,
            // Record this trial's call only when the run opted in (saves egress).
            recordCall,
            // Customer-simulator LLM picked in the New Run modal (drives the
            // LiveKit worker's LLM; falls back to server env when absent).
            customerSimulatorModel,
            // TTS provider + speed picked in the New Run modal.
            ttsProvider,
            ttsSpeed,
            ttsVoice,
          });
        } catch (err) {
          console.error(`[livekit-eval] trial failed for scenario ${scenarioId}:`, err);
          sqlite.prepare(`
            INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics, talk_ratio, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(trialId, runId, scenarioId, trialIndex, 0, `LiveKit call failed: ${(err as Error).message}`, 0, JSON.stringify({}), 0, now());
          allTrialResults.push({ pass: false, kpi: 0, ttft: 0, latency: 0, cost: 0, duration_ms: 0, turn_count: 0 });
          continue;
        }

        // Score the conversation (same scorer as the Twilio voice path).
        const scoreResult = await scoreConversation({
          scenario_name: scenario.name as string,
          expected_outcome_type: scenario.expected_outcome_type as string,
          expected_outcome_value: scenario.expected_outcome_value as string,
          turns: lkResult.turns.map(t => ({ role: t.role, content: t.content })),
          tool_calls: [],
        });

        const scenarioMetricIds: string[] = scenario.metric_ids ? JSON.parse(scenario.metric_ids as string) : [];
        const scenarioMetrics = scenarioMetricIds.length > 0
          ? (sqlite.prepare(`SELECT id, name, description FROM metrics WHERE id IN (${scenarioMetricIds.map(() => '?').join(',')}) AND status = 'active'`).all(...scenarioMetricIds) as Array<{ id: string; name: string; description?: string }>)
          : [];
        const metricScores = await scoreMetrics(scenarioMetrics, lkResult.turns.map(t => ({ role: t.role, content: t.content })), scenario.name as string);

        const agentWords = lkResult.turns.filter(t => t.role === 'agent').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const userWords = lkResult.turns.filter(t => t.role === 'user').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const talkRatio = userWords > 0 ? agentWords / userWords : 0;

        // LiveKit streams turns continuously (no fixed silence-timeout to subtract),
        // so the raw turn-timestamp gaps are the agent's real response latency.
        const agentLatencies: number[] = [];
        for (let i = 0; i < lkResult.turns.length; i++) {
          const t = lkResult.turns[i];
          if (t.role !== 'agent') continue;
          const prevUser = [...lkResult.turns.slice(0, i)].reverse().find(p => p.role === 'user');
          if (!prevUser) continue;
          agentLatencies.push(Math.max(0, (t.timestamp_ms || 0) - (prevUser.timestamp_ms || 0)));
        }
        const firstAgentTurn = lkResult.turns.find(t => t.role === 'agent');
        const ttft = firstAgentTurn ? Math.max(0, firstAgentTurn.timestamp_ms || 0) : 0;
        const avgLatency = agentLatencies.length > 0
          ? agentLatencies.reduce((s, n) => s + n, 0) / agentLatencies.length
          : 0;

        const nfrMetrics = {
          ttft,
          avg_latency: Math.round(avgLatency),
          e2e_latency: lkResult.duration_ms,
          cost: 0,
          input_tokens: 0,
          output_tokens: 0,
          model_calls: lkResult.turns.length,
        };

        sqlite.prepare(`
          INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, kpi_components, pass_fail, nfr_metrics, talk_ratio, metric_scores, recording_session_id, recording_provider, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(trialId, runId, scenarioId, trialIndex, scoreResult.score, scoreResult.rationale,
          scoreResult.components?.length ? JSON.stringify(scoreResult.components) : null,
          scoreResult.pass_fail ? 1 : 0, JSON.stringify(nfrMetrics), talkRatio,
          metricScores.length > 0 ? JSON.stringify(metricScores) : null,
          recordCall ? lkResult.sessionId : null, 'livekit', now());

        lkResult.turns.forEach((turn, idx) => {
          const turnId = uuidv4();
          sqlite.prepare(`
            INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(turnId, trialId, idx, turn.role, turn.content, turn.timestamp_ms || 0, JSON.stringify({}));
        });

        allTrialResults.push({
          pass: scoreResult.pass_fail,
          kpi: scoreResult.score,
          ttft,
          latency: Math.round(avgLatency),
          cost: 0,
          duration_ms: lkResult.duration_ms,
          turn_count: lkResult.turns.length,
        });

      } else if (isVoiceAgent && twilioSettings) {
        // ── Voice agent trial via Twilio ─────────────────────────────────────
        const customerContext = buildCustomerContext({
          name: scenario.name as string,
          description: scenario.description as string | null,
          seed_utterance: scenario.seed_utterance as string,
        });

        const voiceScenario = {
          id: scenarioId,
          name: scenario.name as string,
          description: (scenario.description as string) || (scenario.name as string),
          seed: scenario.seed_utterance as string,
          customer_context: customerContext,
        };

        const voiceSessionId = randomUUID();
        voiceRunProgress.set(runId, {
          sessionId: voiceSessionId,
          scenarioIndex: scenarioIds.indexOf(scenarioId) + 1,
          totalScenarios: scenarioIds.length,
          trialIndex: trialIndex + 1,
          totalTrials: nTrials,
          scenarioName: scenario.name as string,
          provider: 'twilio',
        });

        let voiceResult: { turns: Array<{ role: 'user' | 'agent'; content: string; timestamp_ms: number }>; duration_ms: number; sessionId: string };
        try {
          voiceResult = await runVoiceTrial({
            accountSid: twilioSettings.accountSid,
            authToken: twilioSettings.authToken,
            fromNumber: twilioSettings.fromNumber,
            toNumber: testAgent!.phone_number as string,
            webhookBaseUrl: twilioSettings.webhookBaseUrl,
            openaiApiKey: process.env.OPENAI_API_KEY || '',
            scenario: voiceScenario,
            sessionId: voiceSessionId,
            maxTurns,
            silenceTimeout: (testAgent?.silence_timeout as number) ?? 5,
            sttMode: ((testAgent?.stt_mode as string) === 'gather' ? 'gather' : 'record'),
            customerSimulatorModel,
            // Agent-level setting: when 1/undefined (default), the agent greets
            // first (inbound) — Twilio captures the greeting, then the simulator
            // says the seed. When 0, the simulator speaks the seed first (outbound).
            mainAgentSpeaksFirst: testAgent?.main_agent_speaks_first !== 0,
            // Record this trial's call only when the run opted in.
            recordCall,
          });
        } catch (err) {
          console.error(`[voice-eval] trial failed for scenario ${scenarioId}:`, err);
          // Store a failed trial result and continue
          sqlite.prepare(`
            INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics, talk_ratio, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(trialId, runId, scenarioId, trialIndex, 0, `Voice call failed: ${(err as Error).message}`, 0, JSON.stringify({}), 0, now());
          allTrialResults.push({ pass: false, kpi: 0, ttft: 0, latency: 0, cost: 0, duration_ms: 0, turn_count: 0 });
          continue;
        }

        // Score the voice conversation
        const scoreResult = await scoreConversation({
          scenario_name: scenario.name as string,
          expected_outcome_type: scenario.expected_outcome_type as string,
          expected_outcome_value: scenario.expected_outcome_value as string,
          turns: voiceResult.turns.map(t => ({ role: t.role, content: t.content })),
          tool_calls: [],
        });

        // Score scenario custom metrics
        const scenarioMetricIds: string[] = scenario.metric_ids ? JSON.parse(scenario.metric_ids as string) : [];
        const scenarioMetrics = scenarioMetricIds.length > 0
          ? (sqlite.prepare(`SELECT id, name, description FROM metrics WHERE id IN (${scenarioMetricIds.map(() => '?').join(',')}) AND status = 'active'`).all(...scenarioMetricIds) as Array<{ id: string; name: string; description?: string }>)
          : [];
        const metricScores = await scoreMetrics(scenarioMetrics, voiceResult.turns.map(t => ({ role: t.role, content: t.content })), scenario.name as string);

        // Compute talk ratio from voice turns
        const agentWords = voiceResult.turns.filter(t => t.role === 'agent').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const userWords = voiceResult.turns.filter(t => t.role === 'user').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const talkRatio = userWords > 0 ? agentWords / userWords : 0;

        // Compute TTFT and avg agent-response latency by subtracting the
        // silence-timeout wait (which Twilio enforces after every speaker
        // stops talking) from the gap between user and agent turn timestamps.
        // Result represents agent thinking + TTS playback time, NOT pure
        // model latency (still includes audio time we cannot directly measure).
        const silenceTimeoutMs = ((testAgent?.silence_timeout as number) ?? 5) * 1000;

        // Per-turn agent response latency: gap from preceding user turn to
        // each agent turn, minus silence-timeout. Clamped at 0.
        const agentLatencies: number[] = [];
        for (let i = 0; i < voiceResult.turns.length; i++) {
          const t = voiceResult.turns[i];
          if (t.role !== 'agent') continue;
          const prevUser = [...voiceResult.turns.slice(0, i)].reverse().find(p => p.role === 'user');
          if (!prevUser) continue;
          const gap = (t.timestamp_ms || 0) - (prevUser.timestamp_ms || 0) - silenceTimeoutMs;
          agentLatencies.push(Math.max(0, gap));
        }

        const firstAgentTurn = voiceResult.turns.find(t => t.role === 'agent');
        const ttft = firstAgentTurn ? Math.max(0, (firstAgentTurn.timestamp_ms || 0) - silenceTimeoutMs) : 0;
        const avgLatency = agentLatencies.length > 0
          ? agentLatencies.reduce((s, n) => s + n, 0) / agentLatencies.length
          : 0;

        const nfrMetrics = {
          ttft,
          avg_latency: Math.round(avgLatency),
          e2e_latency: voiceResult.duration_ms,
          cost: 0,
          input_tokens: 0,
          output_tokens: 0,
          model_calls: voiceResult.turns.length,
        };

        sqlite.prepare(`
          INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, kpi_components, pass_fail, nfr_metrics, talk_ratio, metric_scores, recording_session_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(trialId, runId, scenarioId, trialIndex, scoreResult.score, scoreResult.rationale,
          scoreResult.components?.length ? JSON.stringify(scoreResult.components) : null,
          scoreResult.pass_fail ? 1 : 0, JSON.stringify(nfrMetrics), talkRatio,
          metricScores.length > 0 ? JSON.stringify(metricScores) : null,
          recordCall ? voiceResult.sessionId : null, now());

        // Insert transcript turns
        voiceResult.turns.forEach((turn, idx) => {
          const turnId = uuidv4();
          sqlite.prepare(`
            INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(turnId, trialId, idx, turn.role, turn.content, turn.timestamp_ms || 0, JSON.stringify({}));
        });

        allTrialResults.push({
          pass: scoreResult.pass_fail,
          kpi: scoreResult.score,
          ttft,
          latency: Math.round(avgLatency),
          cost: 0,
          duration_ms: voiceResult.duration_ms,
          turn_count: voiceResult.turns.length,
        });

      } else if (isVapiAgent && twilioSettings) {
        // ── Vapi agent trial via Twilio + Vapi webhook ───────────────────────
        const customerContext = buildCustomerContext({
          name: scenario.name as string,
          description: scenario.description as string | null,
          seed_utterance: scenario.seed_utterance as string,
        });

        const vapiScenario = {
          id: scenarioId,
          name: scenario.name as string,
          description: (scenario.description as string) || (scenario.name as string),
          seed: scenario.seed_utterance as string,
          customer_context: customerContext,
        };

        const voiceSessionId = randomUUID();
        voiceRunProgress.set(runId, {
          sessionId: voiceSessionId,
          scenarioIndex: scenarioIds.indexOf(scenarioId) + 1,
          totalScenarios: scenarioIds.length,
          trialIndex: trialIndex + 1,
          totalTrials: nTrials,
          scenarioName: scenario.name as string,
          provider: 'vapi',
        });

        let vapiResult: { turns: Array<{ role: 'user' | 'agent'; content: string; timestamp_ms: number }>; duration_ms: number; vapiTrace: Record<string, unknown> | null; sessionId: string };
        try {
          vapiResult = await runVapiTrialForEvalRun({
            accountSid: twilioSettings.accountSid,
            authToken: twilioSettings.authToken,
            fromNumber: twilioSettings.fromNumber,
            toNumber: testAgent!.phone_number as string,
            webhookBaseUrl: twilioSettings.webhookBaseUrl,
            openaiApiKey: process.env.OPENAI_API_KEY || '',
            vapiApiKey: (testAgent!.vapi_api_key as string) || getSetting('vapi_api_key'),
            vapiAssistantId: (testAgent!.vapi_assistant_id as string) || getSetting('vapi_assistant_id'),
            vapiSpeaksFirst: !!(testAgent!.vapi_speaks_first),
            scenario: vapiScenario,
            sessionId: voiceSessionId,
            maxTurns,
            silenceTimeout: 10,
            customerSimulatorModel,
          });
        } catch (err) {
          console.error(`[vapi-eval] trial failed for scenario ${scenarioId}:`, err);
          sqlite.prepare(`
            INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics, talk_ratio, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(trialId, runId, scenarioId, trialIndex, 0, `Vapi call failed: ${(err as Error).message}`, 0, JSON.stringify({}), 0, now());
          allTrialResults.push({ pass: false, kpi: 0, ttft: 0, latency: 0, cost: 0, duration_ms: 0, turn_count: 0 });
          continue;
        }

        // Score using the Twilio simulator turns (customer side of the conversation)
        const scoreResult = await scoreConversation({
          scenario_name: scenario.name as string,
          expected_outcome_type: scenario.expected_outcome_type as string,
          expected_outcome_value: scenario.expected_outcome_value as string,
          turns: vapiResult.turns.map(t => ({ role: t.role, content: t.content })),
          tool_calls: [],
        });

        const scenarioMetricIds: string[] = scenario.metric_ids ? JSON.parse(scenario.metric_ids as string) : [];
        const scenarioMetrics = scenarioMetricIds.length > 0
          ? (sqlite.prepare(`SELECT id, name, description FROM metrics WHERE id IN (${scenarioMetricIds.map(() => '?').join(',')}) AND status = 'active'`).all(...scenarioMetricIds) as Array<{ id: string; name: string; description?: string }>)
          : [];
        const metricScores = await scoreMetrics(scenarioMetrics, vapiResult.turns.map(t => ({ role: t.role, content: t.content })), scenario.name as string);

        const agentWords = vapiResult.turns.filter(t => t.role === 'agent').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const userWords = vapiResult.turns.filter(t => t.role === 'user').reduce((s, t) => s + t.content.split(/\s+/).length, 0);
        const talkRatio = userWords > 0 ? agentWords / userWords : 0;

        // Same TTFT/latency computation as voice path. Vapi flow uses 10s
        // silence-timeout (set in /evaluate-vapi state init).
        const silenceTimeoutMs = 10 * 1000;
        const agentLatencies: number[] = [];
        for (let i = 0; i < vapiResult.turns.length; i++) {
          const t = vapiResult.turns[i];
          if (t.role !== 'agent') continue;
          const prevUser = [...vapiResult.turns.slice(0, i)].reverse().find(p => p.role === 'user');
          if (!prevUser) continue;
          const gap = (t.timestamp_ms || 0) - (prevUser.timestamp_ms || 0) - silenceTimeoutMs;
          agentLatencies.push(Math.max(0, gap));
        }
        const firstAgentTurn = vapiResult.turns.find(t => t.role === 'agent');
        const ttft = firstAgentTurn ? Math.max(0, (firstAgentTurn.timestamp_ms || 0) - silenceTimeoutMs) : 0;
        const avgLatency = agentLatencies.length > 0
          ? agentLatencies.reduce((s, n) => s + n, 0) / agentLatencies.length
          : 0;

        // Extract cost from Vapi trace if available
        const vapiCost = (vapiResult.vapiTrace?.cost as number) ?? 0;

        const nfrMetrics = {
          ttft,
          avg_latency: Math.round(avgLatency),
          e2e_latency: vapiResult.duration_ms,
          cost: vapiCost,
          input_tokens: 0,
          output_tokens: 0,
          model_calls: vapiResult.turns.length,
        };

        sqlite.prepare(`
          INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, kpi_components, pass_fail, nfr_metrics, talk_ratio, metric_scores, vapi_trace, recording_session_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(trialId, runId, scenarioId, trialIndex, scoreResult.score, scoreResult.rationale,
          scoreResult.components?.length ? JSON.stringify(scoreResult.components) : null,
          scoreResult.pass_fail ? 1 : 0, JSON.stringify(nfrMetrics), talkRatio,
          metricScores.length > 0 ? JSON.stringify(metricScores) : null,
          vapiResult.vapiTrace ? JSON.stringify(vapiResult.vapiTrace) : null,
          vapiResult.sessionId,
          now());

        // Insert Twilio-simulator transcript turns
        vapiResult.turns.forEach((turn, idx) => {
          const turnId = uuidv4();
          sqlite.prepare(`
            INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(turnId, trialId, idx, turn.role, turn.content, turn.timestamp_ms || 0, JSON.stringify({}));
        });

        allTrialResults.push({ pass: scoreResult.pass_fail, kpi: scoreResult.score, ttft, latency: Math.round(avgLatency), cost: vapiCost, duration_ms: vapiResult.duration_ms, turn_count: vapiResult.turns.length });

      } else {
        // ── Chat / mock / agent trial ─────────────────────────────────────────
        const simResult = await runSimulation({
          scenario_seed: scenario.seed_utterance as string,
          expected_outcome_type: scenario.expected_outcome_type as string,
          expected_outcome_value: scenario.expected_outcome_value as string,
          agent_name: agent.name as string,
          agent_prompt: agent.prompt as string,
          agent_sop: agent.sop as string,
          scenario_name: scenario.name as string,
          scenario_description: scenario.description as string,
          mode: mode as 'mock' | 'live' | 'agent',
          agent_type: (agentType || 'custom') as 'openai' | 'claude' | 'custom',
          agent_system_prompt: agentSystemPrompt || undefined,
          max_turns: maxTurns,
        });

        const scoreResult = await scoreConversation({
          scenario_name: scenario.name as string,
          expected_outcome_type: scenario.expected_outcome_type as string,
          expected_outcome_value: scenario.expected_outcome_value as string,
          turns: simResult.turns.map(t => ({ role: t.role, content: t.content })),
          tool_calls: simResult.tool_calls.map(tc => ({ tool_name: tc.tool_name, status: tc.status }))
        });

        // Score scenario custom metrics
        const scenarioMetricIds: string[] = scenario.metric_ids ? JSON.parse(scenario.metric_ids as string) : [];
        const scenarioMetrics = scenarioMetricIds.length > 0
          ? (sqlite.prepare(`SELECT id, name, description FROM metrics WHERE id IN (${scenarioMetricIds.map(() => '?').join(',')}) AND status = 'active'`).all(...scenarioMetricIds) as Array<{ id: string; name: string; description?: string }>)
          : [];
        const metricScores = await scoreMetrics(scenarioMetrics, simResult.turns.map(t => ({ role: t.role, content: t.content })), scenario.name as string);

        sqlite.prepare(`
          INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, kpi_components, pass_fail, nfr_metrics, talk_ratio, metric_scores, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(trialId, runId, scenarioId, trialIndex, scoreResult.score, scoreResult.rationale,
          scoreResult.components?.length ? JSON.stringify(scoreResult.components) : null,
          scoreResult.pass_fail ? 1 : 0, JSON.stringify(simResult.nfr_metrics), simResult.talk_ratio,
          metricScores.length > 0 ? JSON.stringify(metricScores) : null, now());

        // Insert transcript turns
        for (const turn of simResult.turns) {
          const turnId = uuidv4();
          sqlite.prepare(`
            INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(turnId, trialId, turn.turn_index, turn.role, turn.content, turn.timestamp_ms || 0, JSON.stringify(turn.metadata || {}));

          for (const tc of simResult.tool_calls.filter(tc => tc.turn_id === turn.id)) {
            sqlite.prepare(`
              INSERT INTO tool_calls (id, turn_id, tool_name, input_args, response, latency_ms, status)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), turnId, tc.tool_name, JSON.stringify(tc.input_args || {}), JSON.stringify(tc.response || {}), tc.latency_ms || 100, tc.status);
          }

          for (const kb of simResult.kb_calls.filter(kb => kb.turn_id === turn.id)) {
            sqlite.prepare(`
              INSERT INTO kb_calls (id, turn_id, query, chunks, latency_ms, kb_source)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), turnId, kb.query, JSON.stringify(kb.chunks || []), kb.latency_ms || 70, kb.kb_source || null);
          }
        }

        allTrialResults.push({
          pass: scoreResult.pass_fail,
          kpi: scoreResult.score,
          ttft: simResult.nfr_metrics.ttft || 0,
          latency: simResult.nfr_metrics.avg_latency || 0,
          cost: simResult.nfr_metrics.cost || 0,
          duration_ms: simResult.nfr_metrics.e2e_latency || 0,
          turn_count: simResult.turns?.length || 0,
        });
      }
    }
  }

  const passCount = allTrialResults.filter(r => r.pass).length;
  const summaryMetrics = {
    avg_kpi: allTrialResults.reduce((s, r) => s + r.kpi, 0) / (allTrialResults.length || 1),
    pass_rate: passCount / (allTrialResults.length || 1),
    avg_ttft: allTrialResults.reduce((s, r) => s + r.ttft, 0) / (allTrialResults.length || 1),
    avg_latency: allTrialResults.reduce((s, r) => s + r.latency, 0) / (allTrialResults.length || 1),
    avg_duration_ms: allTrialResults.reduce((s, r) => s + r.duration_ms, 0) / (allTrialResults.length || 1),
    total_duration_ms: allTrialResults.reduce((s, r) => s + r.duration_ms, 0),
    avg_turns: allTrialResults.reduce((s, r) => s + r.turn_count, 0) / (allTrialResults.length || 1),
    total_turns: allTrialResults.reduce((s, r) => s + r.turn_count, 0),
    total_cost: allTrialResults.reduce((s, r) => s + r.cost, 0),
    total_trials: allTrialResults.length
  };

  voiceRunProgress.delete(runId);
  sqlite.prepare(`
    UPDATE eval_runs SET status = ?, summary_metrics = ?, completed_at = ? WHERE id = ?
  `).run('complete', JSON.stringify(summaryMetrics), now(), runId);
}

// Upload-based eval run — uses an uploaded transcript instead of running simulation
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { agent_id, name, metric_ids, scenarios: scenarioItems } = req.body;

    if (!agent_id || !scenarioItems?.length) {
      return res.status(400).json({ error: 'agent_id and scenarios are required', code: 'VALIDATION_ERROR' });
    }

    const agent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id) as Record<string, unknown>;
    if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });

    // Validate all transcript files first
    for (const item of scenarioItems) {
      const file = sqlite.prepare('SELECT id, parsing_status FROM uploaded_files WHERE id = ?').get(item.transcript_file_id) as Record<string, unknown> | undefined;
      if (!file) {
        return res.status(400).json({ error: `Transcript file not found: ${item.transcript_file_id}`, code: 'FILE_NOT_FOUND' });
      }
      if (file.parsing_status !== 'complete') {
        return res.status(400).json({ error: `Transcript file not yet parsed: ${item.transcript_file_id}`, code: 'FILE_NOT_PARSED' });
      }
    }

    // Create scenarios and track IDs
    const createdScenarioIds: string[] = [];
    const scenarioTranscriptMap: { scenarioId: string; fileId: string }[] = [];

    for (const item of scenarioItems) {
      const { scenario: scenarioData, transcript_file_id } = item;
      const scenarioId = uuidv4();
      const tags = [...(Array.isArray(scenarioData.tags) ? scenarioData.tags : []), 'upload-eval'];
      sqlite.prepare(`
        INSERT INTO scenarios (id, agent_id, name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scenarioId, agent_id,
        scenarioData.name, scenarioData.description || null,
        scenarioData.seed_utterance || '',
        scenarioData.expected_outcome_type || 'natural_language',
        scenarioData.expected_outcome_value || '',
        scenarioData.persona_id || null,
        JSON.stringify(tags),
        'active', 'upload', now(), now()
      );
      createdScenarioIds.push(scenarioId);
      scenarioTranscriptMap.push({ scenarioId, fileId: transcript_file_id });
    }

    const runId = uuidv4();
    const runName = name || `Upload Run ${new Date().toLocaleDateString()}`;
    sqlite.prepare(`
      INSERT INTO eval_runs (id, agent_id, agent_version, name, scenario_ids, n_trials, k_threshold, metric_ids, mode, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, agent_id, agent.version as string, runName,
      JSON.stringify(createdScenarioIds), 1, 1,
      JSON.stringify(metric_ids || []), 'upload', 'running', now());

    runUploadEvaluation(runId, scenarioTranscriptMap).catch(err => {
      console.error('Upload eval run failed:', err);
      sqlite.prepare('UPDATE eval_runs SET status = ?, completed_at = ? WHERE id = ?').run('failed', now(), runId);
    });

    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(runId) as Record<string, unknown>;
    res.status(201).json(parseRun(run));
  } catch (err) {
    console.error('Failed to create upload eval run:', err);
    res.status(500).json({ error: 'Failed to create upload eval run', code: 'CREATE_ERROR' });
  }
});

async function runUploadEvaluation(
  runId: string,
  scenarioTranscriptMap: { scenarioId: string; fileId: string }[]
) {
  const allTrialResults: Array<{ pass: boolean; kpi: number; cost: number }> = [];

  for (const { scenarioId, fileId } of scenarioTranscriptMap) {
    const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId) as Record<string, unknown>;
    if (!scenario) continue;

    const file = sqlite.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(fileId) as Record<string, unknown>;
    if (!file?.parsed_content) continue;

    const parsedContent = JSON.parse(file.parsed_content as string);
    const parsedTurns: Array<{ role: string; content: string; timestamp?: string; metadata?: Record<string, unknown> }> = parsedContent.turns || [];

    // Calculate talk ratio
    let agentWords = 0, userWords = 0;
    for (const turn of parsedTurns) {
      const wc = (turn.content || '').split(/\s+/).filter(Boolean).length;
      if (turn.role === 'agent') agentWords += wc;
      else if (turn.role === 'user') userWords += wc;
    }
    const talkRatio = userWords > 0 ? Math.round((agentWords / userWords) * 100) / 100 : 1.0;

    // Estimate cost from token count
    const allText = parsedTurns.map(t => t.content || '').join(' ');
    const estimatedTokens = Math.ceil(allText.length / 4);
    const estimatedCost = Math.round(estimatedTokens * 0.002 / 1000 * 10000) / 10000;

    const nfrMetrics = {
      ttft: 0, avg_latency: 0, e2e_latency: 0,
      cost: estimatedCost,
      input_tokens: Math.floor(estimatedTokens * 0.6),
      output_tokens: Math.floor(estimatedTokens * 0.4),
      model_calls: 0
    };

    // Score conversation using the uploaded transcript turns
    const scoreResult = await scoreConversation({
      scenario_name: scenario.name as string,
      expected_outcome_type: scenario.expected_outcome_type as string,
      expected_outcome_value: scenario.expected_outcome_value as string,
      turns: parsedTurns.map(t => ({ role: t.role, content: t.content })),
      tool_calls: []
    });

    const trialId = uuidv4();
    sqlite.prepare(`
      INSERT INTO trial_results (id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics, talk_ratio, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(trialId, runId, scenarioId, 0, scoreResult.score, scoreResult.rationale,
      scoreResult.pass_fail ? 1 : 0, JSON.stringify(nfrMetrics), talkRatio, now());

    // Insert transcript turns from the uploaded file
    let turnIndex = 0;
    for (const turn of parsedTurns) {
      const turnId = uuidv4();
      const tsMs = turn.timestamp ? parseUploadTimestamp(turn.timestamp) : turnIndex * 1000;
      sqlite.prepare(`
        INSERT INTO transcript_turns (id, trial_result_id, turn_index, role, content, timestamp_ms, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(turnId, trialId, turnIndex, turn.role, turn.content, tsMs, JSON.stringify(turn.metadata || {}));

      if (turn.role === 'tool' && turn.metadata) {
        sqlite.prepare(`
          INSERT INTO tool_calls (id, turn_id, tool_name, input_args, response, latency_ms, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), turnId,
          (turn.metadata.tool_name as string) || turn.content,
          JSON.stringify(turn.metadata.input || {}),
          JSON.stringify(turn.metadata.output || {}),
          (turn.metadata.latency_ms as number) || 0, 'success');
      }

      if (turn.role === 'kb' && turn.metadata) {
        sqlite.prepare(`
          INSERT INTO kb_calls (id, turn_id, query, chunks, latency_ms, kb_source)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), turnId,
          (turn.metadata.query as string) || turn.content,
          JSON.stringify(turn.metadata.chunks || []),
          (turn.metadata.latency_ms as number) || 0,
          (turn.metadata.kb_source as string) || null);
      }

      turnIndex++;
    }

    allTrialResults.push({ pass: scoreResult.pass_fail, kpi: scoreResult.score, cost: estimatedCost });
  }

  const passCount = allTrialResults.filter(r => r.pass).length;
  const summaryMetrics = {
    avg_kpi: allTrialResults.reduce((s, r) => s + r.kpi, 0) / (allTrialResults.length || 1),
    pass_rate: passCount / (allTrialResults.length || 1),
    avg_ttft: 0,
    avg_latency: 0,
    total_cost: allTrialResults.reduce((s, r) => s + r.cost, 0),
    total_trials: allTrialResults.length
  };

  sqlite.prepare('UPDATE eval_runs SET status = ?, summary_metrics = ?, completed_at = ? WHERE id = ?')
    .run('complete', JSON.stringify(summaryMetrics), now(), runId);
}

function parseUploadTimestamp(ts: string): number {
  const rel = ts.match(/T\+(\d+\.?\d*)s/);
  if (rel) return Math.round(parseFloat(rel[1]) * 1000);
  const abs = ts.match(/(\d+):(\d+):(\d+)/);
  if (abs) return (parseInt(abs[1]) * 3600 + parseInt(abs[2]) * 60 + parseInt(abs[3])) * 1000;
  return 0;
}

router.get('/:id', (req: Request, res: Response) => {
  try {
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!run) return res.status(404).json({ error: 'Eval run not found', code: 'NOT_FOUND' });
    res.json(parseRun(run));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch eval run', code: 'FETCH_ERROR' });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Eval run not found', code: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM trial_results WHERE run_id = ?').run(req.params.id);
    sqlite.prepare('DELETE FROM eval_runs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete eval run', code: 'DELETE_ERROR' });
  }
});

router.get('/:id/results', (req: Request, res: Response) => {
  try {
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!run) return res.status(404).json({ error: 'Eval run not found', code: 'NOT_FOUND' });

    const scenarioIds = JSON.parse(run.scenario_ids as string || '[]') as string[];
    const nTrials = run.n_trials as number;
    const kThreshold = run.k_threshold as number;

    const results = [];
    for (const scenarioId of scenarioIds) {
      const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId) as Record<string, unknown>;
      if (!scenario) continue;

      const trials = sqlite.prepare('SELECT * FROM trial_results WHERE run_id = ? AND scenario_id = ? ORDER BY trial_index').all(req.params.id, scenarioId) as Array<Record<string, unknown>>;
      const parsedTrials = trials.map(t => parseTrialResult(t));

      const passCount = parsedTrials.filter(t => t?.pass_fail).length;
      const avgKpi = parsedTrials.reduce((s, t) => s + ((t?.kpi_score as number) || 0), 0) / (parsedTrials.length || 1);
      const avgTtft = parsedTrials.reduce((s, t) => s + ((t?.nfr_metrics as Record<string, number>)?.ttft || 0), 0) / (parsedTrials.length || 1);
      const avgLatency = parsedTrials.reduce((s, t) => s + ((t?.nfr_metrics as Record<string, number>)?.avg_latency || 0), 0) / (parsedTrials.length || 1);
      const totalCost = parsedTrials.reduce((s, t) => s + ((t?.nfr_metrics as Record<string, number>)?.cost || 0), 0);
      const avgTalkRatio = parsedTrials.reduce((s, t) => s + ((t?.talk_ratio as number) || 0), 0) / (parsedTrials.length || 1);

      // Collect all unique tags across trials for this scenario
      const allTags = [...new Set(parsedTrials.flatMap(t => (t?.tags as string[]) || []))];

      results.push({
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        trials_run: parsedTrials.length,
        trials_total: nTrials,
        pass_count: passCount,
        pass_at_k: passAtK(parsedTrials.length, passCount, kThreshold),
        pass_strict_k: parsedTrials.length > 0 ? Math.pow(passCount / parsedTrials.length, kThreshold) : 0,
        avg_kpi: Math.round(avgKpi * 100) / 100,
        avg_ttft: Math.round(avgTtft),
        avg_latency: Math.round(avgLatency),
        total_cost: Math.round(totalCost * 10000) / 10000,
        avg_talk_ratio: Math.round(avgTalkRatio * 100) / 100,
        tags: allTags,
        trials: parsedTrials
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results', code: 'FETCH_ERROR' });
  }
});

router.get('/:id/summary', (req: Request, res: Response) => {
  try {
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!run) return res.status(404).json({ error: 'Eval run not found', code: 'NOT_FOUND' });

    const trials = sqlite.prepare('SELECT * FROM trial_results WHERE run_id = ?').all(req.params.id) as Array<Record<string, unknown>>;
    const parsed = trials.map(t => parseTrialResult(t));

    const latencies = parsed.map(t => (t?.nfr_metrics as Record<string, number>)?.avg_latency || 0).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p90 = latencies[Math.floor(latencies.length * 0.9)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    res.json({
      run: parseRun(run),
      summary: run.summary_metrics ? JSON.parse(run.summary_metrics as string) : null,
      latency_distribution: { p50, p90, p99 },
      total_trials: parsed.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary', code: 'FETCH_ERROR' });
  }
});

router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!run) return res.status(404).json({ error: 'Eval run not found', code: 'NOT_FOUND' });
    sqlite.prepare('UPDATE eval_runs SET status = ? WHERE id = ?').run('failed', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel run', code: 'CANCEL_ERROR' });
  }
});

// Human review routes
router.post('/:id/human-review/start', (req: Request, res: Response) => {
  try {
    const { n = 20, sampling_strategy = 'random', rater_name } = req.body;
    const run = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!run) return res.status(404).json({ error: 'Run not found', code: 'NOT_FOUND' });

    let query = 'SELECT * FROM trial_results WHERE run_id = ?';
    const trials = sqlite.prepare(query).all(req.params.id) as Array<Record<string, unknown>>;

    let selected = trials;
    if (sampling_strategy === 'lowest-confidence') {
      selected = trials.sort((a, b) => {
        const kpiA = Math.abs((a.kpi_score as number || 0.5) - 0.5);
        const kpiB = Math.abs((b.kpi_score as number || 0.5) - 0.5);
        return kpiA - kpiB;
      });
    } else {
      // Random shuffle
      for (let i = selected.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [selected[i], selected[j]] = [selected[j], selected[i]];
      }
    }

    selected = selected.slice(0, n);

    res.json({
      session_id: uuidv4(),
      queue: selected.map(t => parseTrialResult(t)),
      total: selected.length,
      rater_name
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start review session', code: 'START_ERROR' });
  }
});

router.get('/:id/human-review/queue', (req: Request, res: Response) => {
  try {
    const trials = sqlite.prepare('SELECT * FROM trial_results WHERE run_id = ? ORDER BY kpi_score ASC').all(req.params.id) as Array<Record<string, unknown>>;
    const rated = sqlite.prepare('SELECT trial_result_id FROM human_ratings WHERE run_id = ?').all(req.params.id) as Array<Record<string, unknown>>;
    const ratedIds = new Set(rated.map(r => r.trial_result_id as string));

    const queue = trials
      .filter(t => !ratedIds.has(t.id as string))
      .slice(0, 20)
      .map(t => parseTrialResult(t));

    res.json({ queue, total: trials.length, rated: ratedIds.size, remaining: queue.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch queue', code: 'FETCH_ERROR' });
  }
});

router.post('/:id/human-review/rate', (req: Request, res: Response) => {
  try {
    const { trial_result_id, rating, comment, rater_name, rater_id } = req.body;
    if (!trial_result_id || !rating) {
      return res.status(400).json({ error: 'trial_result_id and rating are required', code: 'VALIDATION_ERROR' });
    }

    const trial = sqlite.prepare('SELECT * FROM trial_results WHERE id = ?').get(trial_result_id) as Record<string, unknown>;
    if (!trial) return res.status(404).json({ error: 'Trial not found', code: 'NOT_FOUND' });

    const ratingId = uuidv4();
    sqlite.prepare(`
      INSERT INTO human_ratings (id, run_id, scenario_id, trial_result_id, rater_id, rater_name, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ratingId, req.params.id, trial.scenario_id as string, trial_result_id,
      rater_id || 'anonymous', rater_name || 'Anonymous', rating, comment || null, now());

    res.status(201).json({ id: ratingId, success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit rating', code: 'RATE_ERROR' });
  }
});

router.get('/:id/disagreement-report', (req: Request, res: Response) => {
  try {
    const report = sqlite.prepare('SELECT * FROM disagreement_reports WHERE run_id = ? ORDER BY generated_at DESC LIMIT 1').get(req.params.id) as Record<string, unknown>;
    if (!report) return res.status(404).json({ error: 'No disagreement report found', code: 'NOT_FOUND' });

    res.json({
      ...report,
      false_positives: report.false_positives ? JSON.parse(report.false_positives as string) : [],
      false_negatives: report.false_negatives ? JSON.parse(report.false_negatives as string) : [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch report', code: 'FETCH_ERROR' });
  }
});

router.post('/:id/disagreement-report/generate', (req: Request, res: Response) => {
  try {
    const ratings = sqlite.prepare('SELECT hr.*, tr.kpi_score, tr.pass_fail, tr.scenario_id FROM human_ratings hr JOIN trial_results tr ON hr.trial_result_id = tr.id WHERE hr.run_id = ?').all(req.params.id) as Array<Record<string, unknown>>;

    if (ratings.length === 0) {
      return res.status(400).json({ error: 'No ratings available', code: 'NO_RATINGS' });
    }

    let agreements = 0;
    const falsePositives: Array<Record<string, unknown>> = [];
    const falseNegatives: Array<Record<string, unknown>> = [];

    for (const rating of ratings) {
      const llmPass = rating.pass_fail === 1 || rating.pass_fail === true;
      const humanPass = rating.rating === 'pass';

      if (llmPass === humanPass) agreements++;
      else if (llmPass && !humanPass) {
        const scenario = sqlite.prepare('SELECT name FROM scenarios WHERE id = ?').get(rating.scenario_id as string) as Record<string, unknown>;
        falsePositives.push({
          trial_result_id: rating.trial_result_id,
          scenario_name: scenario?.name || 'Unknown',
          kpi_score: rating.kpi_score,
          human_comment: rating.comment || ''
        });
      } else {
        const scenario = sqlite.prepare('SELECT name FROM scenarios WHERE id = ?').get(rating.scenario_id as string) as Record<string, unknown>;
        falseNegatives.push({
          trial_result_id: rating.trial_result_id,
          scenario_name: scenario?.name || 'Unknown',
          kpi_score: rating.kpi_score,
          human_comment: rating.comment || ''
        });
      }
    }

    const po = agreements / ratings.length;
    const n = ratings.length;
    const llmPass = ratings.filter(r => r.pass_fail === 1 || r.pass_fail === true).length / n;
    const humanPass = ratings.filter(r => r.rating === 'pass').length / n;
    const pe = llmPass * humanPass + (1 - llmPass) * (1 - humanPass);
    const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);

    let kappaLabel = 'Slight';
    if (kappa > 0.8) kappaLabel = 'Almost Perfect';
    else if (kappa > 0.6) kappaLabel = 'Substantial';
    else if (kappa > 0.4) kappaLabel = 'Moderate';
    else if (kappa > 0.2) kappaLabel = 'Fair';

    const reportId = uuidv4();
    const summary = `${Math.round(po * 100)}% agreement with LLM judge (κ = ${kappa.toFixed(2)} — ${kappaLabel}). ${falsePositives.length} false positives and ${falseNegatives.length} false negatives identified.`;

    sqlite.prepare(`
      INSERT INTO disagreement_reports (id, run_id, disagreement_rate, kappa_score, false_positives, false_negatives, summary, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reportId, req.params.id, 1 - po, kappa, JSON.stringify(falsePositives), JSON.stringify(falseNegatives), summary, now());

    res.json({
      id: reportId,
      disagreement_rate: 1 - po,
      kappa_score: kappa,
      kappa_label: kappaLabel,
      agreement_rate: po,
      total_rated: n,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      summary
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report', code: 'GENERATE_ERROR' });
  }
});

export default router;
