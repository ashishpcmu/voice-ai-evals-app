import { useState, useEffect } from 'react';
import { Download, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

export interface RecordingState {
  status: 'pending' | 'ready' | 'error';
  downloadUrl: string | null;
  error?: string | null;
}

interface RecordingRowProps {
  /**
   * The recording state (pending/ready/error). Optional — if a sessionId is
   * provided but no state is given, the component renders a "Download/Delete"
   * row using `/api/voice/recording/{sessionId}` directly. Useful for views
   * (eg. eval run detail) that don't poll status but know a recording exists.
   */
  recording?: RecordingState;
  sessionId?: string;
  /** Compact rendering used inside a tight row (eg. eval run trial list). */
  compact?: boolean;
  /**
   * API base path for the recording endpoints. Defaults to `/voice` (Twilio/Vapi
   * recordings). The LiveKit tab passes `/livekit` so delete/inferred-download
   * hit the right route.
   */
  basePath?: string;
}

export function RecordingRow({ recording, sessionId, compact, basePath = '/voice' }: RecordingRowProps) {
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // When no explicit `recording` state is supplied but we have a sessionId, we
  // normally infer 'ready'. That's wrong for LiveKit eval-run trials, where the
  // recording may be pending or have failed (eg. "egress minutes exceeded").
  // For those, fetch the real status from the recording-status endpoint and poll
  // while it's still processing. This leaves the Twilio/voice path untouched.
  const shouldFetchStatus = !recording && !!sessionId && basePath === '/livekit';
  const [fetchedState, setFetchedState] = useState<RecordingState | null>(null);

  useEffect(() => {
    if (!shouldFetchStatus || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const data = await api.get(`${basePath}/recording-status/${sessionId}`).then(r => r.data as RecordingState);
        if (cancelled) return;
        setFetchedState(data);
        // Keep polling while the recording is still being finalized.
        if (data.status === 'pending') timer = setTimeout(poll, 4000);
      } catch {
        if (!cancelled) setFetchedState({ status: 'error', downloadUrl: null, error: 'Status unavailable' });
      }
    };
    poll();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [shouldFetchStatus, sessionId, basePath]);

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!sessionId) return;
    if (!confirm("Delete this recording from the server? It can't be recovered.")) return;
    setDeleting(true);
    try {
      await api.delete(`${basePath}/recording/${sessionId}`);
      setDeleted(true);
      toast.success('Recording deleted');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to delete recording');
    } finally {
      setDeleting(false);
    }
  };

  if (deleted) {
    return (
      <div className={`flex items-center gap-1.5 ${compact ? 'text-xs' : 'text-xs'} text-gray-text`}>
        <CheckCircle size={12} className="text-success-green" />
        <span>Deleted</span>
      </div>
    );
  }

  // While we're fetching the real LiveKit status, show a brief loading state
  // instead of optimistically rendering a (possibly broken) download link.
  if (shouldFetchStatus && !fetchedState) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-text">
        <div className="w-3 h-3 border-2 border-gray-300 border-t-primary-blue rounded-full animate-spin" />
        <span>{compact ? 'Recording…' : 'Checking recording status…'}</span>
      </div>
    );
  }

  // Resolve effective state: explicit `recording` prop wins; then the fetched
  // LiveKit status (eval-run trial rows); otherwise infer 'ready' from sessionId
  // presence (Twilio/voice trial rows, unchanged).
  const state: RecordingState =
    recording
    ?? fetchedState
    ?? (sessionId ? { status: 'ready', downloadUrl: `/api/${basePath.replace(/^\//, '')}/recording/${sessionId}` } : { status: 'error', downloadUrl: null });

  if (state.status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-text">
        <div className="w-3 h-3 border-2 border-gray-300 border-t-primary-blue rounded-full animate-spin" />
        <span>{compact ? 'Recording…' : 'Call recording is processing… (typically 5–15 seconds after the call ends)'}</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-start gap-2 text-xs text-amber-700">
        <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
        <span>Recording unavailable{state.error ? `: ${state.error}` : ''}</span>
      </div>
    );
  }
  if (state.status === 'ready' && state.downloadUrl) {
    if (compact) {
      return (
        <div className="flex items-center gap-1.5">
          <a
            href={state.downloadUrl}
            download
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-primary-blue hover:bg-primary-blue/90 rounded transition-colors"
            title="Download recording (available 30 min)"
          >
            <Download size={11} /> MP3
          </a>
          {sessionId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-text hover:text-red-600 hover:bg-red-50 rounded border border-brand-border transition-colors disabled:opacity-50"
              title="Delete recording"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-dark-text">
          <Download size={13} className="text-primary-blue" />
          <span className="font-medium">Call recording ready</span>
          <span className="text-gray-text">· available for 30 minutes</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={state.downloadUrl}
            download
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-blue hover:bg-primary-blue/90 rounded-lg transition-colors"
          >
            <Download size={12} /> Download MP3
          </a>
          {sessionId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-text hover:text-red-600 hover:bg-red-50 rounded-lg border border-brand-border transition-colors disabled:opacity-50"
              title="Delete recording from server"
            >
              <Trash2 size={12} /> {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    );
  }
  return null;
}
