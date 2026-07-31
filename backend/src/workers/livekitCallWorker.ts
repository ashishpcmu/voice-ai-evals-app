/**
 * ─── LiveKit call worker (forked child process) ─────────────────────────────
 * Runs ONE LiveKit call end-to-end, fully isolated from the Express process:
 * creates the room, starts egress (optional), dials the SIP agent-under-test,
 * runs the streaming customer-simulator AgentSession, tears down, and polls
 * egress completion. All state is streamed to the parent over IPC — the worker
 * never touches the shared Maps and never scores (the parent owns scoring).
 *
 * WHY a separate process: the @livekit/rtc-node FFI runtime throws async errors
 * during teardown ("engine is closed", AbortError from cleanupOnDisconnect). In
 * a child process those kill only this disposable worker, never the API server.
 */

import path from 'path';
import dotenv from 'dotenv';
import type {
  WorkerInitParams,
  HostToWorkerMsg,
  WorkerToHostMsg,
  WorkerTurn,
} from '../services/livekitState';

// Parent forwards its full env (incl. .env tuning) via fork; this is only a
// fallback. From backend/src/workers (or dist/workers) the repo root is ../../../.
dotenv.config({ path: path.join(__dirname, '../../../.env') });

function send(msg: WorkerToHostMsg) {
  process.send?.(msg);
}

// A fatal error in the fragile runtime becomes a clean terminal 'error' + exit,
// never a hung child. The parent marks the session 'failed' cleanly.
process.on('uncaughtException', (err) => {
  send({ type: 'error', message: `worker uncaughtException: ${(err as Error)?.message ?? err}` });
  setTimeout(() => process.exit(1), 50);
});
process.on('unhandledRejection', (reason) => {
  send({ type: 'error', message: `worker unhandledRejection: ${(reason as Error)?.message ?? reason}` });
  setTimeout(() => process.exit(1), 50);
});

// Cancellation: the parent sends {type:'cancel'}; we resolve the `ended` promise
// so the call finalizes on whatever was captured, then tears down.
let cancelRequested = false;
let requestFinish: (() => void) | undefined;

process.on('message', (msg: HostToWorkerMsg) => {
  if (msg.type === 'init') {
    void run(msg.params);
  } else if (msg.type === 'cancel') {
    cancelRequested = true;
    requestFinish?.();
  }
});

function s3Configured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    && process.env.AWS_BUCKET_NAME && process.env.AWS_REGION);
}

// Held in a variable so TS does not statically resolve the optional dependency.
const LIVEKIT_SDK_MODULE = 'livekit-server-sdk';

async function loadServerSdk(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await import(/* @vite-ignore */ LIVEKIT_SDK_MODULE);
  } catch {
    return null;
  }
}

function exit(code: number) {
  // Give IPC a tick to flush before exiting.
  setTimeout(() => process.exit(code), 50);
}

async function run(params: WorkerInitParams): Promise<void> {
  const startTime = Date.now();
  const turns: WorkerTurn[] = [];

  const sdk = await loadServerSdk();
  if (!sdk) {
    send({ type: 'error', message: 'LiveKit SDK not installed in worker (livekit-server-sdk).' });
    return exit(1);
  }

  const { config } = params;
  const roomService = new sdk.RoomServiceClient(config.url, config.apiKey, config.apiSecret);
  const sipClient = new sdk.SipClient(config.url, config.apiKey, config.apiSecret);

  let egressId: string | undefined;
  const recordingEnabled = params.recordCall !== false
    && (process.env.LIVEKIT_RECORDING ?? 'true').toLowerCase() !== 'false'
    && s3Configured();

  try {
    // 1. Create the room.
    await roomService.createRoom({ name: params.roomName, emptyTimeout: 300, maxParticipants: 5 });

    // 1b. Start audio-only recording → S3 (best-effort, fail-open).
    if (recordingEnabled) {
      try {
        const httpUrl = config.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
        const egressClient = new sdk.EgressClient(httpUrl, config.apiKey, config.apiSecret);
        const s3Key = `recordings/${params.sessionId}.ogg`;
        const output = new sdk.EncodedFileOutput({
          fileType: sdk.EncodedFileType.OGG,
          filepath: s3Key,
          output: {
            case: 's3',
            value: {
              accessKey: process.env.AWS_ACCESS_KEY_ID,
              secret: process.env.AWS_SECRET_ACCESS_KEY,
              bucket: process.env.AWS_BUCKET_NAME,
              region: process.env.AWS_REGION,
            },
          },
        });
        const info = await egressClient.startRoomCompositeEgress(params.roomName, output, { audioOnly: true });
        egressId = info?.egressId;
        send({ type: 'recording', op: 'pending', egressId });
        console.log(`[livekit-worker] recording started egressId=${egressId} → s3://${process.env.AWS_BUCKET_NAME}/${s3Key}`);
      } catch (err) {
        console.error('[livekit-worker] recording start failed (call continues):', (err as Error).message);
        send({ type: 'recording', op: 'error', error: 'Failed to start recording' });
      }
    }

    // 2. Dial the agent-under-test as a SIP participant through the outbound trunk.
    const sipParticipant = await sipClient.createSipParticipant(
      config.sipTrunkId,
      params.toNumber,
      params.roomName,
      {
        participantIdentity: `agent-under-test-${params.sessionId}`,
        participantName: 'Agent Under Test',
        waitUntilAnswered: true,
      },
    );
    send({ type: 'sipParticipant', id: sipParticipant?.participantId || sipParticipant?.sid || '' });
    send({ type: 'status', status: 'in-progress' });

    // 3. Run the customer-simulator agent loop.
    await runCustomerSimulatorAgent(params, startTime, turns);

    // 4. Tear down the room (also stops egress).
    try { await roomService.deleteRoom(params.roomName); } catch { /* best-effort */ }

    // 5. Signal call completion NOW (fast for the eval flow); egress finalizes after.
    send({ type: 'done', turns, duration_ms: Date.now() - startTime });

    // 6. Recording finalizes a few seconds after room close. Poll, then report.
    if (recordingEnabled && egressId) {
      await waitForEgressComplete(sdk, config, params.sessionId, egressId);
    }
    return exit(0);
  } catch (err) {
    send({ type: 'error', message: `LiveKit call error: ${(err as Error).message}` });
    try { await roomService.deleteRoom(params.roomName); } catch { /* best-effort */ }
    return exit(1);
  }
}

/** Poll egress until COMPLETE (uploaded to S3), then report ready; error/timeout otherwise. */
async function waitForEgressComplete(sdk: any, config: WorkerInitParams['config'], sessionId: string, egressId: string): Promise<void> {
  const httpUrl = config.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const egressClient = new sdk.EgressClient(httpUrl, config.apiKey, config.apiSecret);
  const s3Key = `recordings/${sessionId}.ogg`;
  const deadline = Date.now() + 120_000;

  const isComplete = (s: unknown) => s === 3 || s === 'EGRESS_COMPLETE';
  const isFailed = (s: unknown) =>
    s === 4 || s === 5 || s === 6 || s === 'EGRESS_FAILED' || s === 'EGRESS_ABORTED' || s === 'EGRESS_LIMIT_REACHED';

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    let info: any;
    try {
      const list = await egressClient.listEgress({ egressId });
      info = Array.isArray(list) ? list[0] : list;
    } catch {
      continue;
    }
    const status = info?.status;
    if (isComplete(status)) {
      const reported = info?.fileResults?.[0]?.filename;
      send({ type: 'recording', op: 'ready', s3Key: reported || s3Key });
      return;
    }
    if (isFailed(status)) {
      send({ type: 'recording', op: 'error', error: `Egress ended with status ${JSON.stringify(status)}` });
      return;
    }
  }
  send({ type: 'recording', op: 'error', error: 'Recording finalization timed out' });
}

/** Process-local guard: initialize the agents logger once per worker. */
let livekitLoggerInitialized = false;

/**
 * The streaming customer-simulator agent loop. Ported from the former in-process
 * implementation, except it accumulates turns into `turns` and streams each one
 * to the parent via IPC (instead of writing state.turns).
 */
async function runCustomerSimulatorAgent(
  params: WorkerInitParams,
  startTime: number,
  turns: WorkerTurn[],
): Promise<void> {
  let agents: any, rtc: any, openaiPlugin: any, deepgram: any, silero: any, serverSdk: any, cartesia: any;
  try {
    const m = (s: string) => s; // defeat static module resolution
    agents = await import(m('@livekit/agents'));
    rtc = await import(m('@livekit/rtc-node'));
    openaiPlugin = await import(m('@livekit/agents-plugin-openai'));
    deepgram = await import(m('@livekit/agents-plugin-deepgram'));
    silero = await import(m('@livekit/agents-plugin-silero'));
    serverSdk = await import(m('livekit-server-sdk'));
    // Cartesia is optional — only needed when ttsProvider=cartesia. Don't let its
    // absence break the whole worker.
    try { cartesia = await import(m('@livekit/agents-plugin-cartesia')); } catch { cartesia = null; }
  } catch (err) {
    throw new Error(
      'LiveKit Agents runtime is not fully installed. Run: npm install @livekit/agents ' +
      '@livekit/rtc-node @livekit/agents-plugin-openai @livekit/agents-plugin-deepgram ' +
      `@livekit/agents-plugin-silero. (${(err as Error).message})`,
    );
  }

  if (!livekitLoggerInitialized) {
    try {
      agents.initializeLogger({ pretty: false, level: process.env.LIVEKIT_LOG_LEVEL || 'info' });
    } catch { /* already initialized or unsupported */ }
    livekitLoggerInitialized = true;
  }

  const { config } = params;
  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const cartesiaKey = process.env.CARTESIA_API_KEY;
  const useDeepgramStt = !!deepgramKey;
  const useGroqStt = !useDeepgramStt && (process.env.STT_PROVIDER || '').toLowerCase() === 'groq' && !!groqKey;
  const useGroqLlm = (process.env.LLM_PROVIDER || '').toLowerCase() === 'groq' && !!groqKey;

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not set (required for LiveKit TTS, and Whisper STT when Deepgram/Groq are not configured).');
  }

  const agentIdentity = `customer-sim-${params.sessionId}`;
  const at = new serverSdk.AccessToken(config.apiKey, config.apiSecret, {
    identity: agentIdentity,
    name: 'Customer (Simulator)',
  });
  at.addGrant({ roomJoin: true, room: params.roomName, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  const room = new rtc.Room();
  let session: any;

  const pushTurn = (role: 'user' | 'agent', content: string) => {
    const text = (content || '').trim();
    if (!text) return;
    const turn: WorkerTurn = { role, content: text, timestamp_ms: Date.now() - startTime };
    turns.push(turn);
    send({ type: 'turn', turn });
  };

  try {
    await room.connect(config.url, token, { autoSubscribe: true, dynacast: false });

    // ── STT selection (Deepgram Flux via LiveKit Inference; fallbacks) ──
    const useFlux = useDeepgramStt
      && (process.env.LIVEKIT_FLUX_STT ?? 'true').toLowerCase() !== 'false';

    // Flux end-of-turn thresholds. eager_eot is a SPECULATIVE "preflight" turn-end
    // that only makes sense paired with preemptiveGeneration (draft early, commit on
    // final). With preemptive generation OFF (our default), a lower eager value fires
    // a second turn-end that spawns a DUPLICATE generation before the first finishes —
    // confirmed to cause overlapping speech handles, duplicate turns, and segment-
    // synchronizer errors. So eager defaults to == eot_threshold (single turn-end).
    // Only lower it if you ALSO set LIVEKIT_SIM_PREEMPTIVE_GENERATION=true.
    const fluxEotThreshold = Number(process.env.LIVEKIT_FLUX_EOT_THRESHOLD ?? 0.9);
    const fluxEagerEot = Number(process.env.LIVEKIT_FLUX_EAGER_EOT ?? fluxEotThreshold);
    const fluxEotTimeoutMs = Number(process.env.LIVEKIT_FLUX_EOT_TIMEOUT_MS ?? 5000);

    let stt: any;
    if (useFlux) {
      try {
        stt = new agents.inference.STT({
          model: process.env.LIVEKIT_FLUX_MODEL || 'deepgram/flux-general-en',
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
          modelOptions: {
            eot_threshold: fluxEotThreshold,
            eager_eot_threshold: fluxEagerEot,
            eot_timeout_ms: fluxEotTimeoutMs,
          },
        });
      } catch (err) {
        console.error('[livekit-worker] Flux STT init failed, falling back to nova-2:', err);
        stt = null;
      }
    }
    if (!stt) {
      stt = useDeepgramStt
        ? new deepgram.STT({
            apiKey: deepgramKey,
            model: process.env.DEEPGRAM_STT_MODEL || 'nova-2-phonecall',
            interimResults: true,
            smartFormat: true,
            punctuate: true,
            endpointing: 500,
          })
        : useGroqStt
        ? openaiPlugin.STT.withGroq({
            apiKey: groqKey,
            model: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
          })
        : new openaiPlugin.STT({
            apiKey: openaiKey,
            model: process.env.OPENAI_STT_MODEL || 'whisper-1',
          });
    }

    // Resolve the customer-simulator LLM. Priority: the per-run UI selection
    // (params.customerLlm, e.g. "gpt-4o-mini" or "groq:openai/gpt-oss-120b"),
    // else the server env (LLM_PROVIDER / *_LLM_MODEL).
    const perRun = (params.customerLlm || '').trim();
    const lc = perRun.toLowerCase();
    let llmProvider: 'groq' | 'openai';
    let llmModel: string;
    if (perRun) {
      if (lc.startsWith('groq:')) {
        llmProvider = groqKey ? 'groq' : 'openai';
        llmModel = groqKey ? perRun.slice(perRun.indexOf(':') + 1) : (process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini');
      } else {
        llmProvider = 'openai';
        llmModel = perRun;
      }
    } else {
      llmProvider = useGroqLlm ? 'groq' : 'openai';
      llmModel = useGroqLlm ? (process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b') : (process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini');
    }

    let llm: any;
    llm = new openaiPlugin.LLM({
      model: llmModel,
      apiKey: llmProvider === 'groq' ? groqKey : openaiKey,
      ...(llmProvider === 'groq' ? { baseURL: 'https://api.groq.com/openai/v1' } : {}),
      temperature: 0.7,
    });

    // (B) TTS provider: cartesia (most natural, supports natural speed), deepgram
    // Aura (lowest latency, default), or openai. Chosen via params.ttsProvider.
    // Per-run speed (params.ttsSpeed) overrides the env speed for the chosen provider;
    // each provider clamps to its own valid range.
    const ttsProvider = (params.ttsProvider ?? 'deepgram').toLowerCase();
    const runSpeed = typeof params.ttsSpeed === 'number' ? params.ttsSpeed : undefined;
    let tts: any;
    let ttsLabel: string;
    if (ttsProvider === 'cartesia' && cartesiaKey) {
      // Cartesia Sonic — natural voice; sonic-3 supports speed 0.6–2.0 (natural, not the
      // robotic time-stretch Aura does). Set CARTESIA_TTS_VOICE to a male voice ID.
      const cModel = process.env.CARTESIA_TTS_MODEL || 'sonic-3.5';
      const cVoice = params.ttsVoice || process.env.CARTESIA_TTS_VOICE;
      const rawSpeed = runSpeed ?? (process.env.CARTESIA_TTS_SPEED !== undefined ? Number(process.env.CARTESIA_TTS_SPEED) : undefined);
      const cSpeed = rawSpeed !== undefined ? Math.min(2.0, Math.max(0.6, rawSpeed)) : undefined;
      tts = new cartesia.TTS({
        apiKey: cartesiaKey,
        model: cModel,
        ...(cVoice ? { voice: cVoice } : {}),
        ...(cSpeed !== undefined ? { speed: cSpeed } : {}),
      });
      ttsLabel = `cartesia:${cModel}${cSpeed !== undefined ? '@' + cSpeed + 'x' : ''}`;
    } else if (ttsProvider !== 'openai' && deepgramKey) {
      // Deepgram Aura (default). NOTE: Aura-1 voices (aura-*-en) reject a `speed` param
      // with HTTP 400 (silent audio). So speed is ONLY applied on Aura-2 models.
      const dgTtsModel = process.env.DEEPGRAM_TTS_MODEL || 'aura-arcas-en';
      const isAura2 = dgTtsModel.toLowerCase().startsWith('aura-2');
      const rawSpeed = runSpeed ?? (process.env.DEEPGRAM_TTS_SPEED !== undefined ? Number(process.env.DEEPGRAM_TTS_SPEED) : undefined);
      const dgTtsSpeed = (isAura2 && rawSpeed !== undefined) ? Math.min(1.5, Math.max(0.7, rawSpeed)) : undefined;
      tts = new deepgram.TTS({ model: dgTtsModel, apiKey: deepgramKey, ...(dgTtsSpeed !== undefined ? { speed: dgTtsSpeed } : {}) });
      ttsLabel = `deepgram:${dgTtsModel}${dgTtsSpeed !== undefined ? '@' + dgTtsSpeed + 'x' : ''}`;
    } else {
      // OpenAI TTS supports speed 0.25–4.0.
      const oSpeed = runSpeed !== undefined ? Math.min(4.0, Math.max(0.25, runSpeed)) : undefined;
      tts = new openaiPlugin.TTS({ apiKey: openaiKey, model: 'gpt-4o-mini-tts', voice: 'alloy', ...(oSpeed !== undefined ? { speed: oSpeed } : {}) });
      ttsLabel = `openai:gpt-4o-mini-tts${oSpeed !== undefined ? '@' + oSpeed + 'x' : ''}`;
    }
    const vad = await silero.VAD.load();
    const agent = new agents.voice.Agent({ instructions: params.customerSystemPrompt });

    const turnDetectionMode = useDeepgramStt ? 'stt' : undefined;
    // Endpointing min delay = the silence the simulated caller waits after the
    // agent-under-test stops before deciding its turn is done and responding.
    // Raised from 400→650 because 400 made the sim grab the floor on the agent's
    // natural mid-utterance pauses (talk-over). The TTS+LLM speedups give us the
    // headroom to be a more patient listener while still feeling snappy. Overridable.
    const endpointingMinDelay = Number(
      process.env.LIVEKIT_SIM_ENDPOINT_MIN_DELAY_MS ?? (useDeepgramStt ? 650 : 750)
    );
    // maxDelay bounds the longest the caller will wait when turn-detection is
    // unsure SSA is finished (e.g. trailing/incomplete speech). Overridable.
    const endpointingMaxDelay = Number(process.env.LIVEKIT_SIM_ENDPOINT_MAX_DELAY_MS ?? 3000);
    // Preemptive generation lets the caller's LLM start drafting before the turn
    // is CONFIRMED complete — reduces latency but can fire against a pause+restart
    // ("umm... I'd like to..."). Kept OFF by default (correctness > latency);
    // opt in via env to A/B against those cases.
    const preemptiveGeneration = process.env.LIVEKIT_SIM_PREEMPTIVE_GENERATION === 'true';

    // Diagnostic: log the effective turn-taking tuning the child actually resolved
    // (confirms .env forwarding and helps tune interruptiveness/latency).
    console.log(
      `[livekit-worker] tuning: llm=${llmProvider}:${llmModel}${perRun ? ' (per-run)' : ' (env)'} ` +
      `flux=${useFlux} eot_threshold=${fluxEotThreshold} ` +
      `eager_eot=${fluxEagerEot} ` +
      `eot_timeout_ms=${fluxEotTimeoutMs} ` +
      `interrupt_minWords=${process.env.LIVEKIT_INTERRUPT_MIN_WORDS ?? 3} ` +
      `interrupt_minDuration=${process.env.LIVEKIT_INTERRUPT_MIN_DURATION_MS ?? 1000} ` +
      `endpointingMinDelay=${endpointingMinDelay} endpointingMaxDelay=${endpointingMaxDelay} ` +
      `preemptiveGeneration=${preemptiveGeneration} tts=${ttsLabel}`,
    );

    session = new agents.voice.AgentSession({
      stt, llm, tts, vad,
      turnHandling: {
        ...(turnDetectionMode ? { turnDetection: turnDetectionMode } : {}),
        preemptiveGeneration: { enabled: preemptiveGeneration },
        endpointing: { minDelay: endpointingMinDelay, maxDelay: endpointingMaxDelay },
        interruption: {
          minWords: Number(process.env.LIVEKIT_INTERRUPT_MIN_WORDS ?? 3),
          minDuration: Number(process.env.LIVEKIT_INTERRUPT_MIN_DURATION_MS ?? 1000),
          falseInterruptionTimeout: 3000,
          resumeFalseInterruption: true,
        },
      },
    });

    let resolveFirstAgentTurn: (() => void) | undefined;
    const firstAgentTurn = new Promise<void>(resolve => { resolveFirstAgentTurn = resolve; });

    // End-of-call detection. The simulated caller is an LLM and can't hang up, so when a
    // closing phrase ("goodbye", "that's all", ...) is heard, end the room after a short
    // grace (so the other side can say its final line). Otherwise the call ends normally
    // on agent disconnect / cancel / the hard ceiling.
    const CLOSING_GRACE_MS = Number(process.env.LIVEKIT_CLOSING_GRACE_MS ?? 4000);
    // Only clear farewells count — NOT ambiguous mid-flow phrases like the agent's
    // "that's all I need for verification" / "we're all set" (those caused false ends).
    const CLOSING_RE = /\b(good\s?bye|bye(?: now)?|talk to you later|have a (?:great|good|nice|wonderful) (?:day|one|evening)|take care|thanks?,? bye|no,? that'?s (?:all|it|everything)|that'?s everything,? (?:thanks|thank you))\b/i;
    let closingTimer: ReturnType<typeof setTimeout> | undefined;
    const endCall = (reason: string) => {
      console.log(`[livekit-worker] ending call — ${reason}`);
      requestFinish?.();
    };

    session.on(agents.voice.AgentSessionEventTypes?.ConversationItemAdded ?? 'conversation_item_added', (ev: any) => {
      const item = ev?.item;
      if (!item || typeof item.role !== 'string') return;
      const role: 'user' | 'agent' = item.role === 'assistant' ? 'user' : 'agent';
      const text = item.textContent ?? '';
      pushTurn(role, text);
      if (role === 'agent') resolveFirstAgentTurn?.();
      // End a short grace after the CUSTOMER (sim) gives a clear closing. Only the sim's
      // turns (role 'user' here) count — the agent-under-test's mid-flow phrases such as
      // "that's all I need for verification" are false positives.
      if (role === 'user' && !closingTimer && CLOSING_RE.test(text)) {
        closingTimer = setTimeout(() => endCall('closing phrase detected'), CLOSING_GRACE_MS);
      }
    });

    // Concurrency guard. Overlapping model replies (two active generate_reply handles at
    // once) corrupt the SegmentSynchronizer -> duplicate/empty turns and, worst case, a
    // wedged session ("speech scheduling is paused"). This is triggered by talkovers and
    // double end-of-turn signals. Enforce ONE active reply at a time: when a new reply is
    // created while a prior one is still playing, interrupt the prior one so their audio
    // segments never interleave. Guards only 'generate_reply' (not our seed say() / tools).
    let overlapGuardCount = 0;
    let activeReply: any = null;
    session.on(agents.voice.AgentSessionEventTypes?.SpeechCreated ?? 'speech_created', (ev: any) => {
      if (ev?.source !== 'generate_reply') return;
      const h = ev.speechHandle;
      if (!h) return;
      if (activeReply && activeReply !== h && !activeReply.interrupted && !(activeReply.done?.() === true)) {
        try {
          activeReply.interrupt();
          overlapGuardCount++;
          console.log('[livekit-worker] concurrency guard: interrupted overlapping reply');
        } catch { /* best-effort */ }
      }
      activeReply = h;
      const clear = () => { if (activeReply === h) activeReply = null; };
      try { (h.waitForPlayout?.() ?? Promise.resolve(h)).then(clear, clear); } catch { clear(); }
    });

    // (A) Per-turn latency attribution. The perceived "agent stops → sim speaks"
    // lag is EOU (endpointing/turn-end wait) + LLM ttft + TTS ttfb. Log each as
    // it's collected so we can see which component dominates the 2–3s gap.
    session.on(agents.voice.AgentSessionEventTypes?.MetricsCollected ?? 'metrics_collected', (ev: any) => {
      const m = ev?.metrics;
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'eou_metrics') {
        console.log(`[livekit-worker] latency eou: endOfUtteranceDelay=${Math.round(m.endOfUtteranceDelayMs ?? 0)}ms transcriptionDelay=${Math.round(m.transcriptionDelayMs ?? 0)}ms`);
      } else if (m.type === 'llm_metrics') {
        console.log(`[livekit-worker] latency llm: ttft=${Math.round(m.ttftMs ?? 0)}ms`);
      } else if (m.type === 'tts_metrics') {
        // audioDur shows how much audio was ACTUALLY synthesized. A turn that logs
        // "playout completed" but audioDur≈0 (or cancelled) = silent output — the
        // pipeline thinks it spoke but nothing reached the call.
        console.log(`[livekit-worker] latency tts: ttfb=${Math.round(m.ttfbMs ?? 0)}ms audioDur=${Math.round(m.audioDurationMs ?? 0)}ms chars=${m.charactersCount ?? 0}${m.cancelled ? ' CANCELLED' : ''}`);
      }
    });

    // Overlap (talk-over) detection. The library's OverlappingSpeech event only
    // fires with ADAPTIVE interruption (disabled here — see the log line), so we
    // track speech states manually. In this session the SIM is the "agent" and the
    // agent-under-test (remote) is the "user". When one starts speaking while the
    // other already is, we log the overlap AND which side initiated it — a direct
    // turn-taking quality signal (esp. "sim talked over agent").
    let simSpeaking = false;
    let autSpeaking = false; // agent-under-test (remote participant)
    let overlapCount = 0;
    session.on(agents.voice.AgentSessionEventTypes?.AgentStateChanged ?? 'agent_state_changed', (ev: any) => {
      const nowSpeaking = ev?.newState === 'speaking';
      if (nowSpeaking && !simSpeaking && autSpeaking) {
        overlapCount++;
        console.log(`[livekit-worker] overlap #${overlapCount}: SIM began speaking while agent-under-test was talking (sim talked over agent)`);
      }
      simSpeaking = nowSpeaking;
    });
    session.on(agents.voice.AgentSessionEventTypes?.UserStateChanged ?? 'user_state_changed', (ev: any) => {
      const nowSpeaking = ev?.newState === 'speaking';
      if (nowSpeaking && !autSpeaking && simSpeaking) {
        overlapCount++;
        console.log(`[livekit-worker] overlap #${overlapCount}: agent-under-test began speaking while SIM was talking (agent talked over sim)`);
      }
      autSpeaking = nowSpeaking;
    });

    // Resolve when the call ends: SIP agent disconnect, session close, room
    // disconnect, a cancel request from the parent, or the hard ceiling.
    const ended = new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; if (closingTimer) clearTimeout(closingTimer); resolve(); } };
      requestFinish = finish; // wired to the parent's {type:'cancel'}
      if (cancelRequested) finish();
      room.on(rtc.RoomEvent?.ParticipantDisconnected ?? 'participantDisconnected', (p: any) => {
        const id = p?.identity ?? '';
        if (typeof id === 'string' && id.startsWith('agent-under-test-')) finish();
      });
      session.on(agents.voice.AgentSessionEventTypes?.Close ?? 'close', finish);
      room.on(rtc.RoomEvent?.Disconnected ?? 'disconnected', finish);
      setTimeout(finish, 10 * 60 * 1000);
    });

    await session.start({ agent, room });

    // Seed logic (inbound = agent greets first; outbound = simulator speaks seed).
    if (params.seed) {
      if (params.mainAgentSpeaksFirst !== false) {
        const agentGreeted = await Promise.race([
          firstAgentTurn.then(() => true),
          new Promise<boolean>(r => setTimeout(() => r(false), 10_000)),
        ]);
        const simulatorAlreadySpoke = turns.some(t => t.role === 'user');
        if (!agentGreeted && !simulatorAlreadySpoke && !cancelRequested) {
          console.log(`[livekit-worker] agent silent for 10s — simulator speaking seed for ${params.sessionId}`);
          session.say(params.seed, { addToChatCtx: true });
        }
      } else {
        session.say(params.seed, { addToChatCtx: true });
      }
    }

    await ended;
    console.log(`[livekit-worker] turn-taking summary: ${overlapCount} talk-over event(s), ${overlapGuardCount} overlapping-reply interrupt(s) this call`);
  } finally {
    // Terminate the whole call. The agent-under-test (SIP leg) may never hang up on its own,
    // and session.close() only closes OUR session — so delete the room to disconnect ALL
    // participants (mirrors manual End Call). BOTH steps are time-bounded: on a corrupted or
    // already-closing session (e.g. after the agent disconnected first), deleteRoom/close can
    // hang, and a hung teardown here blocks the 'done' signal → the parent 10-min timeout kills
    // the worker. Bounding guarantees the worker reports completion promptly.
    const withTimeout = (p: unknown, ms: number) =>
      Promise.race([Promise.resolve(p).catch(() => {}), new Promise(r => setTimeout(r, ms))]);
    try {
      const rs = new serverSdk.RoomServiceClient(params.config.url, params.config.apiKey, params.config.apiSecret);
      await withTimeout(rs.deleteRoom(params.roomName), 5000);
    } catch { /* room already gone — best-effort */ }
    try { await withTimeout(session?.close?.(), 5000); } catch { /* ignore */ }
  }
}
