/**
 * ─── LiveKit shared state + worker IPC protocol ─────────────────────────────
 * Extracted so both the parent (livekitEval.ts / livekitCallHost.ts) and the
 * forked call worker (workers/livekitCallWorker.ts) can share types WITHOUT a
 * circular import. The `livekitCallStates` Map remains the single source of
 * truth the HTTP layer reads; the worker never touches it (it streams updates
 * over IPC and the host applies them here).
 */

import type { TwilioCallState } from './voiceEval';

// ── LiveKit config (read from the Settings DB by the route, passed in here) ─────
export interface LiveKitConfig {
  url: string;          // wss://your-project.livekit.cloud
  apiKey: string;
  apiSecret: string;
  sipTrunkId: string;   // outbound SIP trunk that routes through your Twilio number
}

// ── Session state ─────────────────────────────────────────────────────────────
// Reuses the TwilioCallState shape so finalizeVoiceEval() and /call-status
// serialization stay 100% compatible. LiveKit-specific fields are additive.
export interface LiveKitCallState extends TwilioCallState {
  /** LiveKit room name created for this eval. */
  roomName?: string;
  /** SIP participant identity of the dialed agent-under-test. */
  sipParticipantId?: string;
  /** TTS provider selected for this run (default 'deepgram'). */
  ttsProvider?: string;
  /** STT provider selected for this run (default 'groq'). */
  sttProvider?: string;
  /** LiveKit config retained so cancel() can delete the room out-of-band. */
  config?: LiveKitConfig;
  /** Egress id for the S3 recording (set when recording is enabled). */
  egressId?: string;
  /**
   * When true (default), the agent-under-test greets first (inbound use case):
   * the simulator waits for the agent's first turn, then speaks the seed.
   */
  mainAgentSpeaksFirst?: boolean;
}

/** The single source of truth the HTTP layer reads. Populated by the host from
 *  IPC messages streamed by the per-call worker process. */
export const livekitCallStates = new Map<string, LiveKitCallState>();

export function isLiveKitConfigured(cfg: Partial<LiveKitConfig> | null | undefined): cfg is LiveKitConfig {
  return !!(cfg && cfg.url && cfg.apiKey && cfg.apiSecret && cfg.sipTrunkId);
}

// ── Worker IPC protocol ─────────────────────────────────────────────────────
export type WorkerMode = 'voice-sim' | 'eval-run';

export type WorkerTurn = { role: 'user' | 'agent'; content: string; timestamp_ms: number };

/** Everything the worker needs to run one call. Built by the parent before fork
 *  and sent as the first IPC message. No secrets here — API keys are forwarded
 *  via the child's env. */
export interface WorkerInitParams {
  sessionId: string;
  roomName: string;
  config: LiveKitConfig;
  toNumber: string;
  scenario: TwilioCallState['scenario'];
  /** Pre-built customer-simulator system prompt (parent builds via buildCustomerContext). */
  customerSystemPrompt: string;
  seed: string;
  maxTurns: number;
  silenceTimeout: number;
  ttsProvider: string;
  /** Per-run TTS speaking speed for the chosen provider; clamped per provider in the worker. */
  ttsSpeed?: number;
  /** Per-run TTS voice ID (Cartesia); overrides CARTESIA_TTS_VOICE. */
  ttsVoice?: string;
  sttProvider: string;
  mainAgentSpeaksFirst: boolean;
  recordCall: boolean;
  /**
   * Per-run customer-simulator LLM selection from the UI dropdown. Values are a
   * plain OpenAI model ("gpt-4o-mini") or a "groq:<model>" string. When omitted,
   * the worker falls back to the server env (LLM_PROVIDER / *_LLM_MODEL).
   */
  customerLlm?: string;
}

export type HostToWorkerMsg =
  | { type: 'init'; params: WorkerInitParams }
  | { type: 'cancel' };

export type WorkerToHostMsg =
  | { type: 'status'; status: LiveKitCallState['status'] }
  | { type: 'turn'; turn: WorkerTurn }
  | { type: 'sipParticipant'; id: string }
  | { type: 'recording'; op: 'pending' | 'ready' | 'error'; egressId?: string; s3Key?: string; error?: string }
  | { type: 'done'; turns: WorkerTurn[]; duration_ms: number }
  | { type: 'error'; message: string };
