import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

function now() { return new Date().toISOString(); }

router.get('/', (_req: Request, res: Response) => {
  try {
    const settings = sqlite.prepare('SELECT * FROM settings').all() as Array<Record<string, unknown>>;
    const settingsObj: Record<string, string | null> = {};
    for (const s of settings) {
      settingsObj[s.key as string] = s.value as string | null;
    }
    const teamMembers = sqlite.prepare('SELECT * FROM team_members ORDER BY name').all();
    res.json({ settings: settingsObj, team_members: teamMembers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings', code: 'FETCH_ERROR' });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object required', code: 'VALIDATION_ERROR' });
    }
    for (const [key, value] of Object.entries(settings)) {
      const existing = sqlite.prepare('SELECT id FROM settings WHERE key = ?').get(key);
      if (existing) {
        sqlite.prepare('UPDATE settings SET value=?, updated_at=? WHERE key=?').run(String(value), now(), key);
      } else {
        sqlite.prepare('INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(uuidv4(), key, String(value), now());
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings', code: 'UPDATE_ERROR' });
  }
});

router.post('/test-openai', async (req: Request, res: Response) => {
  try {
    const { api_key } = req.body;
    const key = api_key || process.env.OPENAI_API_KEY;
    if (!key) {
      return res.json({ success: false, message: 'No API key provided' });
    }
    try {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: key });
      await openai.models.list();
      res.json({ success: true, message: 'OpenAI connection successful' });
    } catch (e) {
      res.json({ success: false, message: `Connection failed: ${String(e)}` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to test connection', code: 'TEST_ERROR' });
  }
});

// Team members endpoints
router.post('/team-members', (req: Request, res: Response) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required', code: 'VALIDATION_ERROR' });
    const id = uuidv4();
    sqlite.prepare('INSERT INTO team_members (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, email, role || null, now());
    const member = sqlite.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create team member', code: 'CREATE_ERROR' });
  }
});

router.delete('/team-members/:id', (req: Request, res: Response) => {
  try {
    sqlite.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete team member', code: 'DELETE_ERROR' });
  }
});

export default router;
