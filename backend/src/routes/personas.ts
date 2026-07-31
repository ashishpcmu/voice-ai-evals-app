import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

function now() { return new Date().toISOString(); }

function parsePersona(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    ...row,
    additional_attributes: row.additional_attributes ? JSON.parse(row.additional_attributes as string) : {},
    is_synthetic: row.is_synthetic === 1
  };
}

router.get('/', (req: Request, res: Response) => {
  try {
    const { agent_id } = req.query;
    let query = 'SELECT * FROM personas WHERE 1=1';
    const params: unknown[] = [];
    if (agent_id) { query += ' AND agent_id = ?'; params.push(agent_id); }
    query += ' ORDER BY name';
    const personas = sqlite.prepare(query).all(...params);
    res.json(personas.map(p => parsePersona(p as Record<string, unknown>)));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch personas', code: 'FETCH_ERROR' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { agent_id, name, description, tone, goal, frustration_level, language, interruption_level, speed, additional_attributes, is_synthetic } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required', code: 'VALIDATION_ERROR' });
    const id = uuidv4();
    sqlite.prepare(`
      INSERT INTO personas (id, agent_id, name, description, tone, goal, frustration_level, language, interruption_level, speed, additional_attributes, is_synthetic, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_id, name, description || null, tone || null, goal || null,
      frustration_level != null ? frustration_level : null,
      language || 'English',
      interruption_level != null ? interruption_level : 3,
      speed != null ? speed : 3,
      JSON.stringify(additional_attributes || {}), is_synthetic ? 1 : 0, now());
    const persona = sqlite.prepare('SELECT * FROM personas WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(parsePersona(persona));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create persona', code: 'CREATE_ERROR' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const persona = sqlite.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!persona) return res.status(404).json({ error: 'Persona not found', code: 'NOT_FOUND' });
    res.json(parsePersona(persona));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch persona', code: 'FETCH_ERROR' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, description, tone, goal, frustration_level, language, interruption_level, speed, additional_attributes } = req.body;
    const existing = sqlite.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Persona not found', code: 'NOT_FOUND' });
    sqlite.prepare(`
      UPDATE personas SET name=?, description=?, tone=?, goal=?, frustration_level=?, language=?, interruption_level=?, speed=?, additional_attributes=?
      WHERE id=?
    `).run(name, description || null, tone || null, goal || null,
      frustration_level != null ? frustration_level : null,
      language || 'English',
      interruption_level != null ? interruption_level : 3,
      speed != null ? speed : 3,
      JSON.stringify(additional_attributes || {}), req.params.id);
    const updated = sqlite.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(parsePersona(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update persona', code: 'UPDATE_ERROR' });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existing = sqlite.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Persona not found', code: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM personas WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete persona', code: 'DELETE_ERROR' });
  }
});

export default router;
