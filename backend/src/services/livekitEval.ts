/**
 * ─── Voice Agent (LiveKit) Evaluation ───────────────────────────────────────
 * Public API for the LiveKit voice-eval flow. The actual call now runs in a
 * FORKED CHILD PROCESS (workers/livekitCallWorker.ts) managed by
 * services/livekitCallHost.ts — the fragile @livekit/rtc-node runtime no longer
 * runs in the Express process, so its teardown errors can't destabilize the API.
 *
 * This module stays thin: it builds the session state + worker params and
 * delegates to the host. Shared types + the `livekitCallStates` Map live in
 * ./livekitState and are re-exported here so routes need zero changes.
 */

import { randomUUID } from 'crypto';
import { buildCustomerContext, type TwilioCallState } from './voiceEval';
import {
  livekitCallStates,
  type LiveKitCallState,
  type LiveKitConfig,
  type WorkerInitParams,
} from './livekitState';
import { spawnLiveKitCall, cancelLiveKitCall } from './livekitCallHost';

// Re-export shared symbols so existing route imports (routes/livekit.ts,
// routes/evalRuns.ts) keep working unchanged.
export { livekitCallStates, isLiveKitConfigured } from './livekitState';
export type { LiveKitCallState, LiveKitConfig } from './livekitState';

export interface StartLiveKitEvalParams {
  config: LiveKitConfig;
  openaiApiKey: string;
  toNumber: string;
  scenario: TwilioCallState['scenario'];
  selectedMetrics: TwilioCallState['selectedMetrics'];
  sessionId?: string;
  maxTurns?: number;
  silenceTimeout?: number;
  ttsProvider?: string;
  ttsSpeed?: number;
  ttsVoice?: string;
  sttProvider?: string;
  /** Default true — agent-under-test greets first (inbound). */
  mainAgentSpeaksFirst?: boolean;
  /** When false, NO egress/recording is started (saves LiveKit transcode minutes). */
  recordCall?: boolean;
  /** Per-run customer LLM ("gpt-4o-mini" or "groq:<model>"); falls back to env. */
  customerSimulatorModel?: string;
}

export interface LiveKitTrialResult {
  turns: LiveKitCallState['turns'];
  duration_ms: number;
  sessionId: string;
}

// Build the customer-simulator prompt in the parent (buildCustomerContext lives
// in voiceEval) and package everything the worker needs into WorkerInitParams.
function buildWorkerParams(sessionId: string, roomName: string, p: StartLiveKitEvalParams): WorkerInitParams {
  const customerSystemPrompt =
    p.scenario.customer_context ||
    buildCustomerContext({
      name: p.scenario.name,
      description: p.scenario.description,
      seed_utterance: p.scenario.seed,
    });
  return {
    sessionId,
    roomName,
    config: p.config,
    toNumber: p.toNumber,
    scenario: p.scenario,
    customerSystemPrompt,
    seed: p.scenario.seed,
    maxTurns: p.maxTurns ?? 10,
    silenceTimeout: p.silenceTimeout ?? 3,
    ttsProvider: p.ttsProvider ?? 'deepgram',
    ttsSpeed: p.ttsSpeed,
    ttsVoice: p.ttsVoice,
    sttProvider: p.sttProvider ?? 'groq',
    mainAgentSpeaksFirst: p.mainAgentSpeaksFirst !== false,
    recordCall: p.recordCall !== false,
    customerLlm: p.customerSimulatorModel,
  };
}

function buildState(sessionId: string, roomName: string, p: StartLiveKitEvalParams, skipScoring: boolean): LiveKitCallState {
  return {
    sessionId,
    callSid: '',
    roomName,
    scenario: p.scenario,
    openaiApiKey: p.openaiApiKey,
    // Twilio creds are unused on the LiveKit path; blank to satisfy the shape.
    accountSid: '',
    authToken: '',
    webhookBaseUrl: '',
    selectedMetrics: p.selectedMetrics,
    turns: [],
    conversationHistory: [
      { role: 'user', content: '[Call started. You are the customer. Respond only as the customer.]' },
    ],
    startTime: Date.now(),
    status: 'calling',
    currentTurn: 0,
    skipScoring,
    maxTurns: p.maxTurns ?? 10,
    silenceTimeout: p.silenceTimeout ?? 3,
    ttsProvider: p.ttsProvider ?? 'deepgram',
    sttProvider: p.sttProvider ?? 'groq',
    config: p.config,
    mainAgentSpeaksFirst: p.mainAgentSpeaksFirst !== false,
  };
}

/**
 * Voice Simulation entry: register state, fork the worker (voice-sim mode — the
 * host scores via finalizeVoiceEval after the call), return the sessionId
 * immediately. Progress is observed via the /call-status poller.
 */
export async function startLiveKitEval(params: StartLiveKitEvalParams): Promise<{ sessionId: string }> {
  const sessionId = params.sessionId ?? randomUUID();
  const roomName = `eval-${sessionId}`;

  const state = buildState(sessionId, roomName, params, /* skipScoring */ false);
  livekitCallStates.set(sessionId, state);

  // Fire-and-forget; the host handles capacity, fork, bridge, and scoring.
  void spawnLiveKitCall(sessionId, buildWorkerParams(sessionId, roomName, params), 'voice-sim');

  return { sessionId };
}

/**
 * Eval-run trial runner: register state, fork the worker (eval-run mode — no
 * scoring in the worker or host; evalRuns.ts scores from the returned turns),
 * then BLOCK polling livekitCallStates until the call completes or fails, exactly
 * as before. Same signature + return shape.
 */
export async function runLiveKitTrial(params: {
  config: LiveKitConfig;
  openaiApiKey: string;
  toNumber: string;
  scenario: TwilioCallState['scenario'];
  sessionId?: string;
  maxTurns?: number;
  silenceTimeout?: number;
  ttsProvider?: string;
  ttsSpeed?: number;
  ttsVoice?: string;
  sttProvider?: string;
  mainAgentSpeaksFirst?: boolean;
  recordCall?: boolean;
  customerSimulatorModel?: string;
}): Promise<LiveKitTrialResult> {
  const sessionId = params.sessionId ?? randomUUID();
  const roomName = `eval-${sessionId}`;

  const startParams: StartLiveKitEvalParams = { ...params, selectedMetrics: [] };
  const state = buildState(sessionId, roomName, startParams, /* skipScoring */ true);
  livekitCallStates.set(sessionId, state);

  await spawnLiveKitCall(sessionId, buildWorkerParams(sessionId, roomName, startParams), 'eval-run');

  // Poll until the call completes or fails (max 10 minutes), mirroring runVoiceTrial.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const cur = livekitCallStates.get(sessionId);
    if (!cur) throw new Error('Session state lost');
    if (cur.status === 'completed') {
      return { turns: cur.turns, duration_ms: Date.now() - cur.startTime, sessionId };
    }
    if (cur.status === 'failed') {
      throw new Error(cur.error || 'LiveKit call failed');
    }
  }

  const timedOut = livekitCallStates.get(sessionId);
  if (timedOut && timedOut.status !== 'completed' && timedOut.status !== 'failed') {
    timedOut.status = 'failed';
    timedOut.error = 'LiveKit call did not complete within 10 minutes';
  }
  throw new Error('LiveKit call did not complete within 10 minutes');
}

/** End an in-flight LiveKit call (delegates to the host's cross-process cancel). */
export async function cancelLiveKitEval(sessionId: string): Promise<boolean> {
  return cancelLiveKitCall(sessionId);
}
