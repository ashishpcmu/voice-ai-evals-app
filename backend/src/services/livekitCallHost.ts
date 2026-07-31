/**
 * ─── LiveKit call host (parent-side fork manager + IPC bridge) ───────────────
 * Forks one `livekitCallWorker` child per call, bridges the child's IPC stream
 * into the shared `livekitCallStates` / recording Maps (so all HTTP endpoints and
 * pollers keep working unchanged), enforces a concurrency cap + hard timeout, and
 * handles cross-process cancellation. The fragile @livekit/rtc-node runtime now
 * lives only in the child, so a fatal FFI error can never destabilize the API.
 */

import { fork, type ChildProcess } from 'child_process';
import path from 'path';
import { finalizeVoiceEval } from './voiceEval';
import {
  livekitCallStates,
  type WorkerInitParams,
  type WorkerMode,
  type WorkerToHostMsg,
  type WorkerTurn,
} from './livekitState';
import {
  markLiveKitRecordingReady,
  markLiveKitRecordingError,
  markLiveKitRecordingPending,
  livekitRecordingMeta,
} from './livekitRecordingStore';

// ── Concurrency + timeout config ────────────────────────────────────────────
const MAX_CONCURRENT = Math.max(1, Number(process.env.LIVEKIT_MAX_CONCURRENT_CALLS ?? 3));
// Hard ceiling per call. The worker also has its own 10-min internal cap; this is
// the parent backstop that force-kills a wedged child.
const CHILD_TIMEOUT_MS = Math.max(60_000, Number(process.env.LIVEKIT_CHILD_TIMEOUT_MS ?? 11 * 60_000));
const CANCEL_GRACE_MS = 10_000;

interface CallHandle {
  sessionId: string;
  mode: WorkerMode;
  child: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  slotReleased: boolean;
  finalized: boolean;
  cancelled: boolean;
  release: () => void;
}

const activeChildren = new Map<string, CallHandle>();

// ── Minimal async semaphore ───────────────────────────────────────────────────
let available = MAX_CONCURRENT;
const waiters: Array<() => void> = [];

function tryAcquire(): boolean {
  if (available > 0) { available -= 1; return true; }
  return false;
}
function acquire(): Promise<void> {
  if (available > 0) { available -= 1; return Promise.resolve(); }
  return new Promise<void>(resolve => waiters.push(resolve));
}
function releaseSlot(): void {
  const next = waiters.shift();
  if (next) { next(); return; } // hand the slot directly to the next waiter
  available = Math.min(MAX_CONCURRENT, available + 1);
}

// ── Worker path (tsx .ts in dev, compiled .js in prod) ────────────────────────
const isTs = __filename.endsWith('.ts');
function resolveWorkerPath(): string {
  const ext = isTs ? 'ts' : 'js';
  return path.join(__dirname, '..', 'workers', `livekitCallWorker.${ext}`);
}

/** True when tsx can be resolved (required to fork a .ts worker in dev). */
function tsxAvailable(): boolean {
  try { require.resolve('tsx'); return true; } catch { return false; }
}

/**
 * Fork a worker for one call and bridge its IPC into the shared Maps. The state
 * for `sessionId` MUST already be registered in `livekitCallStates` by the caller
 * (so /call-status never 404s during the fork window).
 *
 * Returns after the child is forked (not after the call completes). For eval-run
 * mode the caller polls livekitCallStates for the terminal status, as before.
 * For voice-sim mode this host calls finalizeVoiceEval() on the parent after the
 * child reports `done` (scoring stays in the parent; the child never scores).
 *
 * On capacity/fork failure the session is marked `failed` with an actionable
 * message (never throws for voice-sim). For eval-run, capacity waits for a slot.
 */
export async function spawnLiveKitCall(
  sessionId: string,
  initParams: WorkerInitParams,
  mode: WorkerMode,
): Promise<void> {
  const state = livekitCallStates.get(sessionId);
  if (!state) return; // caller must register state first

  // Capacity: eval-run waits for a slot; voice-sim fails fast.
  if (mode === 'eval-run') {
    await acquire();
  } else if (!tryAcquire()) {
    state.status = 'failed';
    state.error = 'Too many concurrent voice calls right now. Please try again in a moment.';
    return;
  }

  // Pre-flight: in dev we need tsx to run the .ts worker.
  if (isTs && !tsxAvailable()) {
    releaseSlot();
    state.status = 'failed';
    state.error = 'tsx is not installed in the backend workspace (required to run the LiveKit call worker in dev).';
    return;
  }

  let child: ChildProcess;
  try {
    child = fork(resolveWorkerPath(), [], {
      execArgv: isTs ? ['--import', 'tsx'] : [],
      serialization: 'advanced',
      env: { ...process.env },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
  } catch (err) {
    releaseSlot();
    state.status = 'failed';
    state.error = `Failed to start LiveKit call worker: ${(err as Error).message}`;
    return;
  }

  const handle: CallHandle = {
    sessionId,
    mode,
    child,
    slotReleased: false,
    finalized: false,
    cancelled: false,
    release: () => {
      if (handle.slotReleased) return;
      handle.slotReleased = true;
      releaseSlot();
    },
    timeout: setTimeout(() => {
      console.error(`[livekit-host] call ${sessionId} exceeded ${CHILD_TIMEOUT_MS}ms — killing worker`);
      killChild(handle);
    }, CHILD_TIMEOUT_MS),
  };
  activeChildren.set(sessionId, handle);

  child.on('message', (msg: WorkerToHostMsg) => handleWorkerMessage(handle, msg));
  child.on('exit', (code) => handleWorkerExit(handle, code));
  child.on('error', (err) => {
    console.error(`[livekit-host] worker ${sessionId} process error:`, err);
  });

  // Kick off the call.
  child.send({ type: 'init', params: initParams });
}

function handleWorkerMessage(handle: CallHandle, msg: WorkerToHostMsg): void {
  const state = livekitCallStates.get(handle.sessionId);
  if (!state) return;

  switch (msg.type) {
    case 'status':
      // Never regress a terminal status.
      if (state.status !== 'completed' && state.status !== 'failed') state.status = msg.status;
      break;
    case 'turn': {
      const t = msg.turn;
      const dup = state.turns.some(x => x.role === t.role && x.content === t.content && x.timestamp_ms === t.timestamp_ms);
      if (!dup) state.turns.push(t);
      break;
    }
    case 'sipParticipant':
      state.sipParticipantId = msg.id;
      break;
    case 'recording':
      if (msg.op === 'pending') { state.egressId = msg.egressId; markLiveKitRecordingPending(handle.sessionId, msg.egressId); }
      else if (msg.op === 'ready') markLiveKitRecordingReady(handle.sessionId, msg.s3Key || `recordings/${handle.sessionId}.ogg`);
      else markLiveKitRecordingError(handle.sessionId, msg.error || 'Recording failed');
      break;
    case 'done':
      finalizeHandle(handle, msg.turns);
      // The call is over for eval purposes; free the slot even though the child
      // may live a few more seconds polling egress.
      handle.release();
      break;
    case 'error':
      if (state.status !== 'completed') {
        state.status = 'failed';
        state.error = msg.message;
      }
      handle.finalized = true;
      handle.release();
      break;
  }
}

/** Apply the terminal 'done' result to state: score (voice-sim) or just complete. */
function finalizeHandle(handle: CallHandle, turns: WorkerTurn[]): void {
  if (handle.finalized) return;
  handle.finalized = true;
  const state = livekitCallStates.get(handle.sessionId);
  if (!state) return;
  // Authoritative final turns from the worker.
  if (Array.isArray(turns) && turns.length) state.turns = turns;

  if (handle.mode === 'voice-sim') {
    // Parent scores (child never touches OpenAI). finalizeVoiceEval sets
    // state.result + status='completed'; its own guard prevents double-scoring.
    void finalizeVoiceEval(state).catch(() => {
      state.status = 'failed';
      state.error = state.error || 'Scoring failed';
    });
  } else {
    // eval-run: scoring happens later in evalRuns.ts from state.turns.
    if (state.status !== 'failed') state.status = 'completed';
  }
}

function handleWorkerExit(handle: CallHandle, code: number | null): void {
  clearTimeout(handle.timeout);
  handle.release();
  activeChildren.delete(handle.sessionId);

  // Whenever the worker exits (natural end, End Call, crash, or forced kill), if
  // a recording is still 'pending' the worker didn't get to finalize its egress
  // poll — finalize it from the parent so the download link resolves instead of
  // spinning forever. No-op when there's no recording or it already resolved.
  void finalizeEgressFromParent(handle.sessionId);

  const state = livekitCallStates.get(handle.sessionId);
  if (!state) return;

  if (handle.finalized || state.status === 'completed' || state.status === 'failed') return;

  // Child exited without a terminal message.
  if (handle.cancelled) {
    // Cancelled: finalize on whatever was captured (matches old cancel semantics).
    if (handle.mode === 'voice-sim') {
      void finalizeVoiceEval(state).catch(() => { state.status = 'failed'; state.error = state.error || 'Cancelled before completion'; });
    } else {
      state.status = 'completed';
    }
  } else {
    state.status = 'failed';
    state.error = `LiveKit call worker exited unexpectedly (code ${code ?? 'null'})`;
  }
}

/**
 * Parent-side egress finalizer. Runs when the worker exits with a recording still
 * 'pending' (e.g. the worker was killed before its own egress poll completed).
 * Polls LiveKit egress and marks the recording store ready/error so the UI stops
 * spinning. Best-effort; never throws.
 */
async function finalizeEgressFromParent(sessionId: string): Promise<void> {
  const state = livekitCallStates.get(sessionId);
  const meta = livekitRecordingMeta.get(sessionId);
  // Only act when a recording was started and hasn't resolved yet.
  if (!state?.config || !state.egressId || !meta || meta.status !== 'pending') return;

  try {
    const mod = 'livekit-server-sdk';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk: any = await import(/* @vite-ignore */ mod);
    const httpUrl = state.config.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    const egressClient = new sdk.EgressClient(httpUrl, state.config.apiKey, state.config.apiSecret);
    const s3Key = `recordings/${sessionId}.ogg`;
    const deadline = Date.now() + 120_000;
    const isComplete = (s: unknown) => s === 3 || s === 'EGRESS_COMPLETE';
    const isFailed = (s: unknown) =>
      s === 4 || s === 5 || s === 6 || s === 'EGRESS_FAILED' || s === 'EGRESS_ABORTED' || s === 'EGRESS_LIMIT_REACHED';

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      // Bail if the worker's own poll resolved it in the meantime.
      if (livekitRecordingMeta.get(sessionId)?.status !== 'pending') return;
      let info: any;
      try {
        const list = await egressClient.listEgress({ egressId: state.egressId });
        info = Array.isArray(list) ? list[0] : list;
      } catch { continue; }
      const status = info?.status;
      if (isComplete(status)) {
        markLiveKitRecordingReady(sessionId, info?.fileResults?.[0]?.filename || s3Key);
        console.log(`[livekit-host] recording READY (parent finalize) for ${sessionId}`);
        return;
      }
      if (isFailed(status)) {
        markLiveKitRecordingError(sessionId, `Egress ended with status ${JSON.stringify(status)}`);
        return;
      }
    }
    markLiveKitRecordingError(sessionId, 'Recording finalization timed out');
  } catch (err) {
    markLiveKitRecordingError(sessionId, `Recording did not finalize: ${(err as Error).message}`);
  }
}

function killChild(handle: CallHandle): void {
  try { handle.child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => {
    if (!handle.child.killed && activeChildren.has(handle.sessionId)) {
      try { handle.child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }, 3000);
}

/**
 * Cancel an in-flight call across the process boundary. Sends {type:'cancel'} to
 * the worker (which finalizes on captured turns), and — belt-and-suspenders —
 * also deletes the room from the parent via the stable server SDK to force-eject
 * participants. Force-kills the child if it doesn't exit within the grace window.
 */
export async function cancelLiveKitCall(sessionId: string): Promise<boolean> {
  const state = livekitCallStates.get(sessionId);
  if (!state) return false;

  const handle = activeChildren.get(sessionId);
  if (handle) {
    handle.cancelled = true;
    try { handle.child.send({ type: 'cancel' }); } catch { /* ignore */ }
    setTimeout(() => { if (activeChildren.has(sessionId)) killChild(handle); }, CANCEL_GRACE_MS);
  }

  // Parent-side room delete via the stable server SDK (never the fragile runtime).
  if (state.roomName && state.config) {
    try {
      const mod = 'livekit-server-sdk';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk: any = await import(/* @vite-ignore */ mod);
      const roomService = new sdk.RoomServiceClient(state.config.url, state.config.apiKey, state.config.apiSecret);
      await roomService.deleteRoom(state.roomName);
    } catch { /* best-effort */ }
  }

  // If there is no live child (already exited) but the session never finalized,
  // finalize now from captured turns.
  if (!handle && state.status !== 'completed' && state.status !== 'failed') {
    await finalizeVoiceEval(state).catch(() => {
      state.status = 'failed';
      state.error = state.error || 'Cancelled before completion';
    });
  }
  return true;
}

/** Kill any active worker children (called on parent shutdown). */
export function killAllLiveKitChildren(): void {
  for (const handle of activeChildren.values()) {
    try { handle.child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  activeChildren.clear();
}
