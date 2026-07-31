/**
 * Shared call-recording store used by both the Voice page (voice.ts) and
 * the Eval Run flow (voiceEval.ts). Lives outside both to avoid circular imports.
 *
 * Responsibility: track per-session call recordings in memory, manage the
 * 30-minute local retention window, and clean up files on schedule.
 */

import * as fs from 'fs';
import * as path from 'path';

export const RECORDINGS_DIR = path.join(process.cwd(), 'data', 'recordings');
export const RECORDING_TTL_MS = 30 * 60 * 1000;

export interface RecordingMeta {
  status: 'pending' | 'ready' | 'error';
  filePath?: string;
  error?: string;
  readyAt?: number;
  pendingSince: number;
  // Twilio creds stored here so the recording-ready handler can fetch + delete
  // even after the originating session state has been cleaned up (eval-run flow).
  accountSid?: string;
  authToken?: string;
}

export const recordingMeta = new Map<string, RecordingMeta>();

try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch { /* ignore */ }

export function markRecordingPending(sessionId: string, accountSid: string, authToken: string) {
  recordingMeta.set(sessionId, {
    status: 'pending',
    pendingSince: Date.now(),
    accountSid,
    authToken,
  });
}

function cleanupOldRecordings() {
  const now = Date.now();
  for (const [sid, meta] of recordingMeta.entries()) {
    if (meta.status === 'ready' && meta.readyAt && now - meta.readyAt > RECORDING_TTL_MS) {
      if (meta.filePath) { try { fs.unlinkSync(meta.filePath); } catch { /* ignore */ } }
      recordingMeta.delete(sid);
      continue;
    }
    if (meta.status === 'pending' && now - meta.pendingSince > RECORDING_TTL_MS) {
      recordingMeta.delete(sid);
      continue;
    }
    if (meta.status === 'error' && meta.readyAt && now - meta.readyAt > RECORDING_TTL_MS) {
      recordingMeta.delete(sid);
    }
  }
}

const _cleanupTimer = setInterval(cleanupOldRecordings, 5 * 60 * 1000);
if (typeof _cleanupTimer.unref === 'function') _cleanupTimer.unref();
