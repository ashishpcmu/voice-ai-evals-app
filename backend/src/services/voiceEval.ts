/**
 * Shared Twilio voice evaluation state and utilities.
 * Used by both voice.ts (webhook handlers) and evalRuns.ts (programmatic trial runner).
 */

import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { markRecordingPending } from './callRecordingStore';

export interface TwilioCallState {
  sessionId: string;
  callSid: string;
  scenario: { id: string; name: string; description: string; seed: string; customer_context: string };
  openaiApiKey: string;
  accountSid: string;
  authToken: string;
  webhookBaseUrl: string;
  selectedMetrics: Array<{ id: string; name: string; description: string }>;
  turns: Array<{ role: 'user' | 'agent'; content: string; timestamp_ms: number }>;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  startTime: number;
  status: 'calling' | 'in-progress' | 'scoring' | 'completed' | 'failed';
  currentTurn: number;
  result?: object;
  error?: string;
  /** When true, finalizeVoiceEval skips metric scoring (used by eval run integration) */
  skipScoring?: boolean;
  /** Vapi API key — set when this session was initiated via evaluate-vapi */
  vapiApiKey?: string;
  /** Vapi assistant ID — set when this session was initiated via evaluate-vapi */
  vapiAssistantId?: string;
  /** Epoch ms when the Twilio outbound call was initiated — used to match the Vapi call record */
  callInitiatedAt?: number;
  /** Maximum number of turns (agent+customer = 1 turn). Default 10. */
  maxTurns?: number;
  /** Seconds of silence before ending recording. Default 2. */
  silenceTimeout?: number;
  /** STT capture mode: 'record' uses <Record>, 'gather' uses <Gather input="speech">. Default 'record'. */
  sttMode?: 'record' | 'gather';
  /** OpenAI model to use for the customer simulator. Default 'gpt-3.5-turbo'. */
  customerSimulatorModel?: string;
  /** When true, the initial TwiML records the agent's greeting before saying the seed. */
  vapiSpeaksFirst?: boolean;
  /**
   * Plain Twilio voice agents: when true (default for inbound), the agent-under-test
   * greets first — Twilio records the greeting, then the simulator says the seed.
   * Same mechanism as vapiSpeaksFirst but driven by the agent-level
   * main_agent_speaks_first setting rather than the Vapi config.
   */
  mainAgentSpeaksFirst?: boolean;
  /** Vapi call ID — populated when Vapi fires a status-update webhook during the call */
  vapiCallId?: string;
  /** Full trace payload received via Vapi end-of-call-report webhook */
  vapiTraceData?: Record<string, unknown>;
}

export const twilioCallStates = new Map<string, TwilioCallState>();

/** Vapi trace cache — keyed by Vapi call ID. Populated by POST /vapi-webhook. */
export const vapiTraceCache = new Map<string, Record<string, unknown>>();

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function twilioRequest(
  accountSid: string, authToken: string, path: string,
  method: string, body?: URLSearchParams
) {
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body?.toString(),
  });
}

export async function finalizeVoiceEval(state: TwilioCallState) {
  if (state.status === 'completed' || state.status === 'scoring' || state.status === 'failed') return;
  if (state.turns.length === 0) {
    state.status = 'failed';
    state.error = 'No conversation was captured from the call';
    return;
  }

  // When called from an eval run, skip VAPI_METRICS scoring — scoreConversation handles it
  if (state.skipScoring) {
    state.status = 'completed';
    return;
  }

  state.status = 'scoring';
  console.log(`[finalize] scoring ${state.turns.length} turns for session ${state.sessionId}`);

  try {
    const openai = new OpenAI({ apiKey: state.openaiApiKey, timeout: 30_000 });
    const transcriptText = state.turns
      .map(t => `${t.role === 'user' ? 'CUSTOMER' : 'AGENT'}: ${t.content}`)
      .join('\n');

    const metricScores = await Promise.all(
      state.selectedMetrics.map(async metric => {
        try {
          const scoreRes = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are an expert evaluator for AI voice agents. Be objective and concise.' },
              {
                role: 'user',
                content: `Evaluate this voice call transcript for the metric below and return JSON only.\n\nMetric: "${metric.name}"\nDescription: ${metric.description}\nScenario: ${state.scenario.description}\n\nTranscript:\n${transcriptText}\n\nReturn: {"score": <0.0-1.0>, "rationale": "<2-3 sentences>"}`,
              },
            ],
            max_tokens: 200,
            temperature: 0.2,
            response_format: { type: 'json_object' },
          });
          const parsed = JSON.parse(scoreRes.choices[0]?.message?.content || '{}');
          return {
            ...metric,
            score: Math.min(1, Math.max(0, parseFloat(parsed.score) || 0)),
            rationale: parsed.rationale || 'No rationale provided.',
          };
        } catch (err) {
          console.error(`[finalize] metric scoring failed for "${metric.name}":`, err);
          return { ...metric, score: 0, rationale: 'Scoring failed.' };
        }
      })
    );

    state.result = {
      scenario: {
        id: state.scenario.id,
        name: state.scenario.name,
        description: state.scenario.description,
        seed: state.scenario.seed,
      },
      turns: state.turns,
      metrics: metricScores,
      duration_ms: Date.now() - state.startTime,
      turn_count: state.turns.length,
    };
    state.status = 'completed';
    console.log(`[finalize] completed session ${state.sessionId}`);
  } catch (err) {
    state.status = 'failed';
    state.error = `Scoring error: ${(err as Error).message}`;
    console.error('[finalize] unexpected error:', err);
  }
}

// Build a customer simulator prompt from a scenario record
export function buildCustomerContext(scenario: {
  name: string;
  description?: string | null;
  seed_utterance: string;
}): string {
  return `You are PLAYING THE ROLE OF A CUSTOMER on a support call. You are NOT the support agent.

YOUR SITUATION:
- Reason for calling: ${scenario.description || scenario.name}
- Opening message you will say: "${scenario.seed_utterance}"

CONVERSATION RULES:
- Respond ONLY as the customer. Never say anything a support agent would say.
- Keep every reply SHORT — 2-3 sentences maximum. Speak like a real person on a phone call, not in long paragraphs.
- Say ONE thing at a time. Do NOT restate details (account number, balance, date of birth, the whole backstory) you have already given unless the agent explicitly asks you to repeat them.
- Respond directly to what the agent just said. Stay engaged until your issue is resolved.
- If asked for your name, account number, date of birth, or any verification detail — make up a realistic response consistent with your situation.
- When stating a numeric identifier — account number, phone number, OTP, SSN, or card number — say each character individually (e.g. 'S, C, dash, one, zero, zero, zero, zero, one'), never as a whole number like 'one hundred thousand one.' Do NOT spell out dates, currency amounts, or ordinary numbers this way — say those naturally (e.g. date of birth as 'July fourteenth, nineteen eighty-five'; a balance as 'two thousand eight hundred forty dollars').
- Do NOT end the call yourself unless the agent has fully resolved your issue or explicitly wrapped up.`;
}

export interface VoiceTrialResult {
  turns: TwilioCallState['turns'];
  duration_ms: number;
  sessionId: string;
}

/**
 * Programmatically initiate a Twilio voice call for an eval trial.
 * Registers state in twilioCallStates so voice.ts webhook handlers can drive the conversation.
 * Returns a Promise that resolves when the call completes or rejects on failure/timeout.
 */
export async function runVoiceTrial(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  webhookBaseUrl: string;
  openaiApiKey: string;
  scenario: TwilioCallState['scenario'];
  /** Optional pre-generated session ID so the caller can track progress */
  sessionId?: string;
  /** Maximum turns (agent+customer = 1 turn). Default 10. */
  maxTurns?: number;
  /** Seconds of silence before ending recording. Default 2. */
  silenceTimeout?: number;
  /** STT capture mode. Default 'record'. */
  sttMode?: 'record' | 'gather';
  /** OpenAI model for customer simulator. Default 'gpt-3.5-turbo'. */
  customerSimulatorModel?: string;
  /** When true (default), the agent-under-test greets first (inbound). */
  mainAgentSpeaksFirst?: boolean;
  /** When false, the call is NOT recorded (no Twilio <Record>, no recording store entry). Default true. */
  recordCall?: boolean;
}): Promise<VoiceTrialResult> {
  const sessionId = params.sessionId ?? randomUUID();

  twilioCallStates.set(sessionId, {
    sessionId,
    callSid: '',
    scenario: params.scenario,
    openaiApiKey: params.openaiApiKey,
    accountSid: params.accountSid,
    authToken: params.authToken,
    webhookBaseUrl: params.webhookBaseUrl.replace(/\/$/, ''),
    selectedMetrics: [],
    turns: [],
    conversationHistory: [
      { role: 'user', content: '[Call started. You are the customer. Respond only as the customer.]' },
    ],
    startTime: Date.now(),
    status: 'calling',
    currentTurn: 0,
    skipScoring: true,
    maxTurns: params.maxTurns ?? 10,
    silenceTimeout: params.silenceTimeout ?? 5,
    sttMode: params.sttMode ?? 'record',
    customerSimulatorModel: params.customerSimulatorModel ?? 'gpt-3.5-turbo',
    mainAgentSpeaksFirst: params.mainAgentSpeaksFirst !== false,
  });

  const base = params.webhookBaseUrl.replace(/\/$/, '');
  const formData = new URLSearchParams();
  formData.append('To', params.toNumber);
  formData.append('From', params.fromNumber);
  formData.append('Url', `${base}/api/voice/twilio-voice-webhook/${sessionId}`);
  formData.append('Method', 'POST');
  formData.append('StatusCallback', `${base}/api/voice/twilio-call-ended/${sessionId}`);
  formData.append('StatusCallbackMethod', 'POST');
  formData.append('StatusCallbackEvent', 'completed');
  // Record the full call (for later download) only when the run opted in.
  const recordCall = params.recordCall !== false;
  if (recordCall) {
    formData.append('Record', 'true');
    formData.append('RecordingStatusCallback', `${base}/api/voice/twilio-recording-ready/${sessionId}`);
    formData.append('RecordingStatusCallbackEvent', 'completed');
    formData.append('RecordingStatusCallbackMethod', 'POST');
  }

  try {
    const twilioRes = await twilioRequest(params.accountSid, params.authToken, '/Calls.json', 'POST', formData);
    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      twilioCallStates.delete(sessionId);
      throw new Error(`Twilio error: ${errText}`);
    }
    const callData = await twilioRes.json() as { sid: string };
    twilioCallStates.get(sessionId)!.callSid = callData.sid;
    if (recordCall) markRecordingPending(sessionId, params.accountSid, params.authToken);
  } catch (err) {
    twilioCallStates.delete(sessionId);
    throw err;
  }

  // Poll every 3 seconds until call completes (max 10 minutes)
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const state = twilioCallStates.get(sessionId);
    if (!state) throw new Error('Session state lost');
    if (state.status === 'completed') {
      const result: VoiceTrialResult = {
        turns: state.turns,
        duration_ms: Date.now() - state.startTime,
        sessionId,
      };
      twilioCallStates.delete(sessionId);
      return result;
    }
    if (state.status === 'failed') {
      const error = state.error || 'Voice call failed';
      twilioCallStates.delete(sessionId);
      throw new Error(error);
    }
  }

  twilioCallStates.delete(sessionId);
  throw new Error('Voice call did not complete within 10 minutes');
}

export interface VapiTrialResult extends VoiceTrialResult {
  vapiTrace: Record<string, unknown> | null;
}

/**
 * Like runVoiceTrial but for Vapi agents — stores vapiApiKey/vapiAssistantId on
 * the session so the webhook handler can match the call, and fetches the Vapi
 * trace after the call completes (via webhook push or Vapi API fallback).
 */
export async function runVapiTrialForEvalRun(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  webhookBaseUrl: string;
  openaiApiKey: string;
  vapiApiKey: string;
  vapiAssistantId: string;
  vapiSpeaksFirst: boolean;
  scenario: TwilioCallState['scenario'];
  sessionId?: string;
  maxTurns?: number;
  silenceTimeout?: number;
  customerSimulatorModel?: string;
}): Promise<VapiTrialResult> {
  const sessionId = params.sessionId ?? randomUUID();
  const callInitiatedAt = Date.now();

  twilioCallStates.set(sessionId, {
    sessionId,
    callSid: '',
    scenario: params.scenario,
    openaiApiKey: params.openaiApiKey,
    accountSid: params.accountSid,
    authToken: params.authToken,
    webhookBaseUrl: params.webhookBaseUrl.replace(/\/$/, ''),
    selectedMetrics: [],
    turns: [],
    conversationHistory: [
      { role: 'user', content: '[Call started. You are the customer. Respond only as the customer.]' },
    ],
    startTime: Date.now(),
    status: 'calling',
    currentTurn: 0,
    skipScoring: true,
    maxTurns: params.maxTurns ?? 10,
    silenceTimeout: params.silenceTimeout ?? 10,
    sttMode: 'gather', // always use gather for Vapi (avoids Whisper delay)
    customerSimulatorModel: params.customerSimulatorModel ?? 'gpt-3.5-turbo',
    vapiApiKey: params.vapiApiKey,
    vapiAssistantId: params.vapiAssistantId,
    vapiSpeaksFirst: params.vapiSpeaksFirst,
    callInitiatedAt,
  });

  const base = params.webhookBaseUrl.replace(/\/$/, '');
  const formData = new URLSearchParams();
  formData.append('To', params.toNumber);
  formData.append('From', params.fromNumber);
  formData.append('Url', `${base}/api/voice/twilio-voice-webhook/${sessionId}`);
  formData.append('Method', 'POST');
  formData.append('StatusCallback', `${base}/api/voice/twilio-call-ended/${sessionId}`);
  formData.append('StatusCallbackMethod', 'POST');
  formData.append('StatusCallbackEvent', 'completed');
  // Record full call so the user can download it after the eval run.
  formData.append('Record', 'true');
  formData.append('RecordingStatusCallback', `${base}/api/voice/twilio-recording-ready/${sessionId}`);
  formData.append('RecordingStatusCallbackEvent', 'completed');
  formData.append('RecordingStatusCallbackMethod', 'POST');

  try {
    const twilioRes = await twilioRequest(params.accountSid, params.authToken, '/Calls.json', 'POST', formData);
    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      twilioCallStates.delete(sessionId);
      throw new Error(`Twilio error: ${errText}`);
    }
    const callData = await twilioRes.json() as { sid: string };
    twilioCallStates.get(sessionId)!.callSid = callData.sid;
    markRecordingPending(sessionId, params.accountSid, params.authToken);
  } catch (err) {
    twilioCallStates.delete(sessionId);
    throw err;
  }

  // Poll every 3s until the call completes (max 10 minutes)
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const state = twilioCallStates.get(sessionId);
    if (!state) throw new Error('Session state lost');
    if (state.status === 'completed') {
      const turns = state.turns;
      const duration_ms = Date.now() - state.startTime;

      // Try to get Vapi trace — already delivered via webhook, or fetch it
      let vapiTrace: Record<string, unknown> | null = state.vapiTraceData ?? null;

      if (!vapiTrace && state.vapiCallId) {
        // Check webhook cache keyed by call ID
        vapiTrace = vapiTraceCache.get(state.vapiCallId) ?? null;
      }

      if (!vapiTrace) {
        // Wait up to 20s more for webhook to deliver, then fall back to Vapi API
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise(r => setTimeout(r, 5000));
          const fresh = twilioCallStates.get(sessionId);
          if (fresh?.vapiTraceData) { vapiTrace = fresh.vapiTraceData; break; }
          if (fresh?.vapiCallId && vapiTraceCache.has(fresh.vapiCallId)) {
            vapiTrace = vapiTraceCache.get(fresh.vapiCallId)!;
            break;
          }
        }
      }

      if (!vapiTrace) {
        // Last resort: fetch directly from Vapi API
        const st = twilioCallStates.get(sessionId)!;
        try {
          vapiTrace = await fetchVapiTraceFromApi(st.vapiApiKey!, st.vapiCallId, callInitiatedAt);
        } catch (err) {
          console.warn('[vapi-trial] Vapi trace fetch failed:', (err as Error).message);
        }
      }

      twilioCallStates.delete(sessionId);
      return { turns, duration_ms, vapiTrace, sessionId };
    }
    if (state.status === 'failed') {
      const error = state.error || 'Voice call failed';
      twilioCallStates.delete(sessionId);
      throw new Error(error);
    }
  }

  twilioCallStates.delete(sessionId);
  throw new Error('Vapi voice call did not complete within 10 minutes');
}

type VapiRawMessage = {
  role?: string;
  message?: string;
  content?: string;
  time?: number;
  secondsFromStart?: number;
  toolCallList?: Array<{ id: string; function?: { name: string; arguments?: unknown }; result?: unknown }>;
  toolCalls?: Array<{ id: string; function?: { name: string; arguments?: unknown }; result?: unknown }>;
};

function parseVapiMessagesLocal(messages: VapiRawMessage[]) {
  const toolCallMessages = messages.filter(m =>
    (m.role === 'tool_calls' || m.role === 'tool_call') &&
    (m.toolCallList?.length || m.toolCalls?.length)
  );
  const toolCalls = toolCallMessages.flatMap(m => {
    const calls = m.toolCallList || m.toolCalls || [];
    return calls.map((tc) => ({
      id: tc.id || '',
      name: tc.function?.name || '',
      arguments: tc.function?.arguments ?? {},
      result: tc.result ?? null,
      timestamp_ms: (m.time ?? m.secondsFromStart ?? 0) * (m.time && m.time > 1000 ? 1 : 1000),
      status: tc.result != null ? 'success' : 'pending',
    }));
  });
  const vapiTranscript = messages
    .filter(m => m.role === 'bot' || m.role === 'assistant' || m.role === 'user')
    .map(m => ({
      role: (m.role === 'bot' || m.role === 'assistant') ? 'assistant' : 'user',
      content: m.message || m.content || '',
      timestamp_ms: (m.time ?? m.secondsFromStart ?? 0) * (m.time && m.time > 1000 ? 1 : 1000),
    }))
    .filter(m => m.content.trim().length > 0);
  return { toolCalls, vapiTranscript };
}

function buildStructuredTrace(call: Record<string, unknown>): Record<string, unknown> {
  const messages = (
    (call.messages as VapiRawMessage[]) ||
    ((call.artifact as Record<string, unknown>)?.messages as VapiRawMessage[]) ||
    []
  );
  const { toolCalls, vapiTranscript } = parseVapiMessagesLocal(messages);
  const artifact = call.artifact as Record<string, unknown> | undefined;
  return {
    callId: call.id,
    status: call.status,
    endedReason: call.endedReason,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    transcript: (call.transcript as string) || (artifact?.transcript as string),
    vapiTranscript,
    toolCalls,
    costBreakdown: call.costBreakdown,
    cost: call.cost,
    analysis: call.analysis,
    recordingUrl: (artifact?.recordingUrl as string) || (call.recordingUrl as string),
  };
}

async function fetchVapiTraceFromApi(
  vapiApiKey: string,
  vapiCallId: string | undefined,
  callInitiatedAt: number
): Promise<Record<string, unknown> | null> {
  if (!vapiApiKey) return null;
  const headers = { Authorization: `Bearer ${vapiApiKey}` };

  if (vapiCallId) {
    const res = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, { headers });
    if (res.ok) return buildStructuredTrace(await res.json() as Record<string, unknown>);
  }

  // Time-window fallback
  const since = new Date(callInitiatedAt - 120_000).toISOString();
  const until = new Date(callInitiatedAt + 600_000).toISOString();
  const listRes = await fetch(
    `https://api.vapi.ai/call?limit=10&createdAtGt=${encodeURIComponent(since)}&createdAtLt=${encodeURIComponent(until)}`,
    { headers }
  );
  if (!listRes.ok) return null;

  const listData = await listRes.json() as unknown[] | { data?: unknown[] };
  const calls = Array.isArray(listData) ? listData : (listData.data ?? []);
  if (calls.length === 0) return null;

  const matching = (calls as Array<{ id: string; createdAt: string }>).reduce((best, c) => {
    const dt = Math.abs(new Date(c.createdAt).getTime() - callInitiatedAt);
    const bestDt = Math.abs(new Date(best.createdAt).getTime() - callInitiatedAt);
    return dt < bestDt ? c : best;
  });

  const detailRes = await fetch(`https://api.vapi.ai/call/${matching.id}`, { headers });
  return detailRes.ok ? buildStructuredTrace(await detailRes.json() as Record<string, unknown>) : null;
}
