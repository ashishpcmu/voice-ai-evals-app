import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';

// Load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ── Crash guard ──────────────────────────────────────────────────────────────
// Historically the in-process LiveKit agent runtime (@livekit/rtc-node) threw
// async FFI errors during room teardown that could crash the whole backend. That
// runtime now runs in a forked child process (services/livekitCallHost.ts +
// workers/livekitCallWorker.ts), so these guards SHOULD no longer catch any
// LiveKit-origin error. We keep them as a safety net and COUNT hits: if the count
// stays 0 across real runs, a later PR can remove them. If it climbs, something
// still leaks into the parent event loop and needs investigating.
let suppressedFatalCount = 0;
process.on('uncaughtException', (err) => {
  suppressedFatalCount += 1;
  console.error(`[uncaughtException] (suppressed to keep server alive; count=${suppressedFatalCount}):`, err);
});
process.on('unhandledRejection', (reason) => {
  suppressedFatalCount += 1;
  console.error(`[unhandledRejection] (suppressed to keep server alive; count=${suppressedFatalCount}):`, reason);
});

// Kill any active LiveKit call worker children on shutdown so `tsx watch` reloads
// and process exits don't leak orphaned child processes.
async function cleanupLiveKitChildren() {
  try {
    const { killAllLiveKitChildren } = await import('./services/livekitCallHost');
    killAllLiveKitChildren();
  } catch { /* module not loaded / not applicable */ }
}
process.on('SIGINT', () => { void cleanupLiveKitChildren().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void cleanupLiveKitChildren().finally(() => process.exit(0)); });
process.on('beforeExit', () => { void cleanupLiveKitChildren(); });

const PORT = process.env.PORT || 3001;

async function startServer() {
  // Initialize database first (async with sql.js)
  const { initializeDatabase } = await import('./db');
  await initializeDatabase();
  console.log('Database initialized successfully');

  const agentsRouter = (await import('./routes/agents')).default;
  const scenariosRouter = (await import('./routes/scenarios')).default;
  const evalRunsRouter = (await import('./routes/evalRuns')).default;
  const trialResultsRouter = (await import('./routes/trialResults')).default;
  const metricsRouter = (await import('./routes/metrics')).default;
  const settingsRouter = (await import('./routes/settings')).default;
  const compareRouter = (await import('./routes/compare')).default;
  const uploadRouter = (await import('./routes/upload')).default;
  const personasRouter = (await import('./routes/personas')).default;
  const voiceRouter = (await import('./routes/voice')).default;
  const livekitRouter = (await import('./routes/livekit')).default;

  const app = express();

  // Middleware
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:5173'], credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
  });

  app.use('/api/agents', agentsRouter);
  app.use('/api/scenarios', scenariosRouter);
  app.use('/api/eval-runs', evalRunsRouter);
  app.use('/api/trial-results', trialResultsRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/compare', compareRouter);
  app.use('/api/upload', uploadRouter);
  app.use('/api/personas', personasRouter);
  app.use('/api/voice', voiceRouter); // Voice Agent (Twilio)
  app.use('/api/livekit', livekitRouter); // Voice Agent (LiveKit) — isolated

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message || 'Internal server error', code: 'SERVER_ERROR' });
  });

  app.listen(PORT, () => {
    console.log(`AI Eval Suite Backend running on http://localhost:${PORT}`);
    console.log(`API health check: http://localhost:${PORT}/api/health`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
