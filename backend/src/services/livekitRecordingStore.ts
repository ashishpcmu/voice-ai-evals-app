/**
 * ─── LiveKit recording store (S3-backed) ─────────────────────────────────────
 * Isolated store for LiveKit-tab call recordings. Mirrors the shape of
 * callRecordingStore.ts (the Twilio one) so the frontend RecordingRow + the
 * /call-status `recording` field work identically — but the file lives in S3
 * (LiveKit Egress writes it there) rather than on local disk.
 *
 * Nothing here touches the Twilio recording store, the DB, or any other flow.
 */

import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface LiveKitRecordingMeta {
  status: 'pending' | 'ready' | 'error';
  /** S3 object key, set once egress completes. */
  s3Key?: string;
  /** LiveKit egress id, used to poll completion. */
  egressId?: string;
  error?: string;
  createdAt: number;
}

export const livekitRecordingMeta = new Map<string, LiveKitRecordingMeta>();

// Same 30-min retention window as the Twilio store — drop stale entries so the
// Map can't grow unbounded. (S3 objects are governed by an S3 lifecycle rule,
// not this timer; this only forgets the in-memory pointer.)
const RECORDING_TTL_MS = 30 * 60 * 1000;

export function markLiveKitRecordingPending(sessionId: string, egressId?: string) {
  livekitRecordingMeta.set(sessionId, { status: 'pending', egressId, createdAt: Date.now() });
}

export function markLiveKitRecordingReady(sessionId: string, s3Key: string) {
  const meta = livekitRecordingMeta.get(sessionId);
  if (meta) { meta.status = 'ready'; meta.s3Key = s3Key; }
  else livekitRecordingMeta.set(sessionId, { status: 'ready', s3Key, createdAt: Date.now() });
}

export function markLiveKitRecordingError(sessionId: string, error: string) {
  const meta = livekitRecordingMeta.get(sessionId);
  if (meta) { meta.status = 'error'; meta.error = error; }
  else livekitRecordingMeta.set(sessionId, { status: 'error', error, createdAt: Date.now() });
}

/** True when AWS S3 creds are present in the environment. */
export function s3Configured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    && process.env.AWS_BUCKET_NAME && process.env.AWS_REGION);
}

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
}

/** The deterministic S3 key a session's recording is written to. */
export function recordingS3Key(sessionId: string): string {
  return `recordings/${sessionId}.ogg`;
}

/**
 * True when the recording object actually exists in S3. Used as a fallback for
 * persisted eval-run recordings whose in-memory pointer has expired (30-min TTL)
 * but whose S3 object still exists. Returns false on any error (missing creds,
 * 404, network) so callers degrade gracefully.
 */
export async function recordingExistsInS3(sessionId: string): Promise<boolean> {
  if (!s3Configured()) return false;
  try {
    await s3Client().send(new HeadObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME, Key: recordingS3Key(sessionId),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Presigned GET URL for a recording, valid for `expiresIn` seconds (default 1h). */
export async function presignRecording(s3Key: string, expiresIn = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key });
  return getSignedUrl(s3Client(), cmd, { expiresIn });
}

/** Best-effort delete of the S3 object + the in-memory pointer. Idempotent.
 *  Falls back to the deterministic key when the in-memory pointer has expired,
 *  so saved eval-run recordings can still be deleted later. */
export async function deleteRecording(sessionId: string): Promise<void> {
  const meta = livekitRecordingMeta.get(sessionId);
  const s3Key = meta?.s3Key ?? recordingS3Key(sessionId);
  if (s3Configured()) {
    try {
      await s3Client().send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key,
      }));
    } catch (err) {
      console.warn(`[livekit-recording] S3 delete failed for ${s3Key}:`, (err as Error).message);
    }
  }
  livekitRecordingMeta.delete(sessionId);
}

// Periodic cleanup of stale in-memory pointers (the S3 lifecycle rule handles
// the actual objects). unref so it never holds the process open.
const _cleanup = setInterval(() => {
  const now = Date.now();
  for (const [sid, meta] of livekitRecordingMeta.entries()) {
    if (now - meta.createdAt > RECORDING_TTL_MS) livekitRecordingMeta.delete(sid);
  }
}, 5 * 60 * 1000);
if (typeof _cleanup.unref === 'function') _cleanup.unref();
