/**
 * ─── Voice Agent (LiveKit) routes ───────────────────────────────────────────
 * COMPLETELY ISOLATED. Mounted at /api/livekit. Does not touch the main DB
 * tables, the eval-run flow, or routes/voice.ts. Mirrors the voice route's
 * request/response contracts so the frontend can reuse its existing poller and
 * ResultsPanel.
 *
 * Reads LiveKit + SIP-trunk config from the generic settings key/value store
 * (same pattern routes/voice.ts uses for Twilio/Vapi creds).
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { sqlite } from '../db';
import {
  startLiveKitEval,
  cancelLiveKitEval,
  livekitCallStates,
  isLiveKitConfigured,
  type LiveKitConfig,
} from '../services/livekitEval';
import { VOICE_SCENARIOS, VOICE_METRICS } from '../services/voiceScenarios';
import {
  livekitRecordingMeta,
  presignRecording,
  deleteRecording,
  recordingExistsInS3,
  recordingS3Key,
} from '../services/livekitRecordingStore';

const router = Router();

/** Build the RecordingRow-compatible `recording` field for /call-status. */
function recordingField(sessionId: string) {
  const meta = livekitRecordingMeta.get(sessionId);
  if (!meta) return null;
  return {
    status: meta.status,
    downloadUrl: meta.status === 'ready' ? `/api/livekit/recording/${sessionId}` : null,
    error: meta.error ?? null,
  };
}

// Held in a variable so TS does not statically resolve the optional dependency.
const LIVEKIT_SDK_MODULE = 'livekit-server-sdk';

function getSetting(key: string): string {
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

function readLiveKitConfig(): Partial<LiveKitConfig> {
  return {
    url: getSetting('livekit_url'),
    apiKey: getSetting('livekit_api_key'),
    apiSecret: getSetting('livekit_api_secret'),
    sipTrunkId: getSetting('livekit_sip_trunk_id'),
  };
}

// ── GET /scenarios, /metrics ──────────────────────────────────────────────────
// Provided for parity; the frontend may also reuse /api/voice/scenarios.
router.get('/scenarios', (_req: Request, res: Response) => {
  res.json(VOICE_SCENARIOS.map(s => ({ id: s.id, name: s.name, description: s.description, seed: s.seed })));
});

router.get('/metrics', (_req: Request, res: Response) => {
  res.json(VOICE_METRICS);
});

// ── POST /test-connection ─────────────────────────────────────────────────────
router.post('/test-connection', async (_req: Request, res: Response) => {
  const cfg = readLiveKitConfig();
  if (!isLiveKitConfigured(cfg)) {
    return res.status(400).json({
      ok: false,
      error: 'LiveKit not fully configured. Set livekit_url, livekit_api_key, livekit_api_secret, and livekit_sip_trunk_id in Settings → Voice Simulation.',
    });
  }
  // Lightweight validation: confirm the SDK is installed and a client can be built.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk: any = await import(LIVEKIT_SDK_MODULE);
    // Constructing the client does not make a network call, but it validates the
    // URL/key shape and that the package is present.
    // eslint-disable-next-line no-new
    new sdk.RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
    return res.json({ ok: true, message: 'LiveKit SDK present and config looks valid.' });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: 'LiveKit SDK not installed. Run `npm install livekit-server-sdk @livekit/agents @livekit/rtc-node` in the backend workspace.',
      detail: (err as Error).message,
    });
  }
});

// Normalize a phone number to E.164 (Twilio rejects anything else with error
// 32101). Strips spaces/dashes/parens; prepends +1 for a bare 10-digit US number;
// prepends + for an 11-digit number starting with 1. Leaves already-+ numbers as-is.
function toE164(raw: string): string {
  const trimmed = (raw || '').trim();
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/[^\d]/g, '');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`; // best-effort for other country lengths
}

// ── POST /evaluate ────────────────────────────────────────────────────────────
router.post('/evaluate', async (req: Request, res: Response) => {
  const { toNumber, scenarioId, metricIds, silenceTimeout, ttsProvider, ttsSpeed, ttsVoice, sttProvider, mainAgentSpeaksFirst, recordCall, customerSimulatorModel } = req.body;

  if (!toNumber || !scenarioId) {
    return res.status(400).json({ error: 'toNumber and scenarioId are required' });
  }

  const normalizedToNumber = toE164(toNumber);
  if (!/^\+\d{8,15}$/.test(normalizedToNumber)) {
    return res.status(400).json({
      error: `Phone number "${toNumber}" is not a valid E.164 number. Use international format, e.g. +13472288705.`,
    });
  }

  const cfg = readLiveKitConfig();
  if (!isLiveKitConfigured(cfg)) {
    return res.status(400).json({
      error: 'LiveKit not configured. Go to Settings → Voice Simulation → Voice Agent (LiveKit).',
    });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured on the server (used for metric scoring).' });
  }

  const found = VOICE_SCENARIOS.find(s => s.id === scenarioId);
  if (!found) return res.status(404).json({ error: 'Scenario not found' });

  const selectedMetrics = Array.isArray(metricIds) && metricIds.length
    ? VOICE_METRICS.filter(m => metricIds.includes(m.id))
    : VOICE_METRICS;

  const sessionId = randomUUID();

  try {
    await startLiveKitEval({
      config: cfg,
      openaiApiKey,
      toNumber: normalizedToNumber,
      scenario: {
        id: found.id,
        name: found.name,
        description: found.description,
        seed: found.seed,
        customer_context: found.customer_context,
      },
      selectedMetrics: selectedMetrics.map(m => ({ id: m.id, name: m.name, description: m.description })),
      sessionId,
      silenceTimeout: typeof silenceTimeout === 'number' && silenceTimeout >= 1 && silenceTimeout <= 15 ? silenceTimeout : 3,
      ttsProvider: ttsProvider || getSetting('livekit_tts_provider') || 'deepgram',
      ttsSpeed: typeof ttsSpeed === 'number' && ttsSpeed > 0 ? ttsSpeed : undefined,
      ttsVoice: typeof ttsVoice === 'string' && ttsVoice.trim() ? ttsVoice.trim() : undefined,
      sttProvider: sttProvider || getSetting('livekit_stt_provider') || 'groq',
      // Default true (inbound): agent greets first, simulator replies after.
      mainAgentSpeaksFirst: mainAgentSpeaksFirst !== false,
      // Only record when the UI toggle is explicitly on — saves egress minutes.
      recordCall: recordCall === true,
      // Per-run customer simulator LLM (e.g. "gpt-4o-mini" or "groq:<model>");
      // falls back to the worker env default when omitted.
      customerSimulatorModel: typeof customerSimulatorModel === 'string' && customerSimulatorModel.trim()
        ? customerSimulatorModel.trim()
        : undefined,
    });
    return res.json({ sessionId, callSid: '' });
  } catch (err) {
    return res.status(500).json({ error: `Failed to start LiveKit eval: ${(err as Error).message}` });
  }
});

// ── GET /call-status/:sessionId ───────────────────────────────────────────────
// Same JSON shape as /api/voice/call-status so the frontend poller is reused.
router.get('/call-status/:sessionId', (req: Request, res: Response) => {
  const state = livekitCallStates.get(req.params.sessionId);
  if (!state) return res.status(404).json({ error: 'Session not found' });

  res.json({
    status: state.status,
    callSid: state.callSid,
    turnCount: state.turns.length,
    turns: state.turns,
    result: state.result ?? null,
    error: state.error ?? null,
    recording: recordingField(req.params.sessionId),
  });
});

// ── GET /recording-status/:sessionId ──────────────────────────────────────────
// Returns the RecordingRow-compatible {status, downloadUrl, error} JSON WITHOUT
// redirecting. Used by views that show a recording for a known session but don't
// poll /call-status (eg. the eval-run trial rows), so the UI reflects the real
// pending/ready/error state instead of assuming a recording exists.
router.get('/recording-status/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const field = recordingField(sessionId);
  if (field) return res.json(field);

  // No in-memory pointer (eg. expired 30-min TTL on a saved eval run). Fall back
  // to checking S3 directly — if the object exists, the recording is still
  // downloadable via the deterministic key.
  if (await recordingExistsInS3(sessionId)) {
    return res.json({ status: 'ready', downloadUrl: `/api/livekit/recording/${sessionId}`, error: null });
  }
  return res.json({ status: 'error', downloadUrl: null, error: 'No recording for this session' });
});

// ── GET /recording/:sessionId ──────────────────────────────────────────────────
// Returns a presigned S3 URL (302 redirect) for the call recording. Mirrors the
// status semantics of /api/voice/recording/:sessionId.
router.get('/recording/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const meta = livekitRecordingMeta.get(sessionId);

  // No in-memory pointer — either it expired (saved eval run viewed later) or
  // this session predates the store. Fall back to the deterministic S3 key.
  if (!meta) {
    if (await recordingExistsInS3(sessionId)) {
      try {
        const url = await presignRecording(recordingS3Key(sessionId));
        return res.redirect(302, url);
      } catch (err) {
        return res.status(500).json({ error: `Failed to presign recording: ${(err as Error).message}` });
      }
    }
    return res.status(404).json({ error: 'Recording not found or expired' });
  }

  if (meta.status === 'pending') return res.status(202).json({ error: 'Recording still processing' });
  if (meta.status === 'error' || !meta.s3Key) {
    return res.status(500).json({ error: meta.error || 'Recording failed' });
  }
  try {
    const url = await presignRecording(meta.s3Key);
    return res.redirect(302, url);
  } catch (err) {
    return res.status(500).json({ error: `Failed to presign recording: ${(err as Error).message}` });
  }
});

// ── DELETE /recording/:sessionId ──────────────────────────────────────────────
router.delete('/recording/:sessionId', async (req: Request, res: Response) => {
  await deleteRecording(req.params.sessionId);
  res.json({ ok: true });
});

// ── POST /cancel/:sessionId ───────────────────────────────────────────────────
router.post('/cancel/:sessionId', async (req: Request, res: Response) => {
  const ok = await cancelLiveKitEval(req.params.sessionId);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

export default router;
