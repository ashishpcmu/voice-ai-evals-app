import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

function now() { return new Date().toISOString(); }

function parseAgent(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    ...row,
    tools: row.tools ? JSON.parse(row.tools as string) : [],
    knowledge_bases: row.knowledge_bases ? JSON.parse(row.knowledge_bases as string) : [],
  };
}

router.get('/', (_req: Request, res: Response) => {
  try {
    const agents = sqlite.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
    res.json(agents.map(a => parseAgent(a as Record<string, unknown>)));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agents', code: 'FETCH_ERROR' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, version, description, prompt, sop, llm_type, tools, knowledge_bases, agent_type, phone_number, silence_timeout, stt_mode, vapi_api_key, vapi_assistant_id, vapi_speaks_first, main_agent_speaks_first } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required', code: 'VALIDATION_ERROR' });
    }
    const id = uuidv4();
    sqlite.prepare(`
      INSERT INTO agents (id, name, version, description, prompt, sop, llm_type, tools, knowledge_bases, agent_type, phone_number, silence_timeout, stt_mode, vapi_api_key, vapi_assistant_id, vapi_speaks_first, main_agent_speaks_first, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, version || 'v1', description || null, prompt || null, sop || null,
      llm_type || 'openai',
      JSON.stringify(tools || []), JSON.stringify(knowledge_bases || []),
      agent_type || 'chat', phone_number || null,
      silence_timeout != null ? Number(silence_timeout) : 2, stt_mode || 'record',
      vapi_api_key || null, vapi_assistant_id || null,
      vapi_speaks_first !== false ? 1 : 0,
      main_agent_speaks_first !== false ? 1 : 0,
      now(), now());
    const agent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(parseAgent(agent));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create agent', code: 'CREATE_ERROR' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const agent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });
    res.json(parseAgent(agent));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent', code: 'FETCH_ERROR' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, version, description, prompt, sop, llm_type, tools, knowledge_bases, agent_type, phone_number, silence_timeout, stt_mode, vapi_api_key, vapi_assistant_id, vapi_speaks_first, main_agent_speaks_first } = req.body;
    const existing = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });
    sqlite.prepare(`
      UPDATE agents SET name=?, version=?, description=?, prompt=?, sop=?, llm_type=?, tools=?, knowledge_bases=?, agent_type=?, phone_number=?, silence_timeout=?, stt_mode=?, vapi_api_key=?, vapi_assistant_id=?, vapi_speaks_first=?, main_agent_speaks_first=?, updated_at=?
      WHERE id=?
    `).run(name, version || 'v1', description || null, prompt || null, sop || null,
      llm_type || 'openai',
      JSON.stringify(tools || []), JSON.stringify(knowledge_bases || []),
      agent_type || 'chat', phone_number || null,
      silence_timeout != null ? Number(silence_timeout) : 2, stt_mode || 'record',
      vapi_api_key || null, vapi_assistant_id || null,
      vapi_speaks_first !== false ? 1 : 0,
      main_agent_speaks_first !== false ? 1 : 0,
      now(), req.params.id);
    const updated = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(parseAgent(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update agent', code: 'UPDATE_ERROR' });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existing = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete agent', code: 'DELETE_ERROR' });
  }
});

export default router;
