// Cartesia (Sonic) voices offered for the customer simulator. Single source of truth
// used by the run/voice dropdowns and the trace inspector's voice-pipeline display.
export interface CartesiaVoice {
  id: string;
  name: string;
}

export const CARTESIA_VOICES: CartesiaVoice[] = [
  { id: '5ee9feff-1265-424a-9d7f-8e4d431a12c7', name: 'Ronald' },
  { id: '630ed21c-2c5c-41cf-9d82-10a7fd668370', name: 'Corey' },
  { id: '30894953-bcce-41fe-892c-15ce19c843ff', name: 'Parker' },
  { id: '86e30c1d-714b-4074-a1f2-1cb6b552fb49', name: 'Carson' },
  { id: '3e39e9a5-585c-4f5f-bac6-5e4905c51095', name: 'Cole' },
];

/** Map a Cartesia voice ID to its friendly name (falls back to the raw id). */
export const cartesiaVoiceName = (id?: string | null): string =>
  CARTESIA_VOICES.find(v => v.id === id)?.name ?? (id || '—');
