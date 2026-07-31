import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { testMetric } from '../services/scorer';

const router = Router();

function now() { return new Date().toISOString(); }

router.get('/', (_req: Request, res: Response) => {
  try {
    const metrics = sqlite.prepare("SELECT * FROM metrics WHERE status = 'active' ORDER BY created_at DESC").all();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics', code: 'FETCH_ERROR' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required', code: 'VALIDATION_ERROR' });
    const id = uuidv4();
    sqlite.prepare(`
      INSERT INTO metrics (id, name, description, type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, type || 'conversation', 'active', now(), now());
    const metric = sqlite.prepare('SELECT * FROM metrics WHERE id = ?').get(id);
    res.status(201).json(metric);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create metric', code: 'CREATE_ERROR' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const metric = sqlite.prepare('SELECT * FROM metrics WHERE id = ?').get(req.params.id);
    if (!metric) return res.status(404).json({ error: 'Metric not found', code: 'NOT_FOUND' });
    res.json(metric);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metric', code: 'FETCH_ERROR' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, description, type, status } = req.body;
    const existing = sqlite.prepare('SELECT * FROM metrics WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Metric not found', code: 'NOT_FOUND' });
    sqlite.prepare('UPDATE metrics SET name=?, description=?, type=?, status=?, updated_at=? WHERE id=?')
      .run(name, description || null, type, status, now(), req.params.id);
    const updated = sqlite.prepare('SELECT * FROM metrics WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update metric', code: 'UPDATE_ERROR' });
  }
});

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const metric = sqlite.prepare('SELECT * FROM metrics WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!metric) return res.status(404).json({ error: 'Metric not found', code: 'NOT_FOUND' });

    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript is required', code: 'VALIDATION_ERROR' });

    const result = await testMetric(metric.description as string || metric.name as string, transcript);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to test metric', code: 'TEST_ERROR' });
  }
});

export default router;
