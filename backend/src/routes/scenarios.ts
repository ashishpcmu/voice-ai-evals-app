import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

function now() { return new Date().toISOString(); }

function parseScenario(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    metric_ids: row.metric_ids ? JSON.parse(row.metric_ids as string) : [],
  };
}

// GET /api/scenarios/export/template - must come before /:id routes
router.get('/export/template', (_req: Request, res: Response) => {
  const csv = 'name,seed_utterance,expected_outcome_type,expected_outcome_value,persona_hint,tags\n' +
    '"Example Scenario","Hi I need help with my policy","natural_language","Agent should help customer resolve their issue","frustrated customer","test,example"\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="scenarios-template.csv"');
  res.send(csv);
});

router.get('/', (req: Request, res: Response) => {
  try {
    const { agent_id, status, tags } = req.query;
    let query = 'SELECT * FROM scenarios WHERE 1=1';
    const params: unknown[] = [];
    if (agent_id) { query += ' AND agent_id = ?'; params.push(agent_id); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC';
    const scenarios = sqlite.prepare(query).all(...params);
    let result = scenarios.map(s => parseScenario(s as Record<string, unknown>));
    if (tags) {
      const tagList = (tags as string).split(',');
      result = result.filter(s => s && tagList.some(tag => (s.tags as string[])?.includes(tag)));
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scenarios', code: 'FETCH_ERROR' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { agent_id, name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, metric_ids, status, created_by } = req.body;
    if (!agent_id || !name || !seed_utterance || !expected_outcome_type) {
      return res.status(400).json({ error: 'agent_id, name, seed_utterance, and expected_outcome_type are required', code: 'VALIDATION_ERROR' });
    }
    const id = uuidv4();
    sqlite.prepare(`
      INSERT INTO scenarios (id, agent_id, name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, metric_ids, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_id, name, description || null, seed_utterance, expected_outcome_type,
      expected_outcome_value || null, persona_id || null, JSON.stringify(tags || []),
      JSON.stringify(metric_ids || []), status || 'draft', created_by || null, now(), now());
    const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(parseScenario(scenario));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create scenario', code: 'CREATE_ERROR' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!scenario) return res.status(404).json({ error: 'Scenario not found', code: 'NOT_FOUND' });
    res.json(parseScenario(scenario));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scenario', code: 'FETCH_ERROR' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, metric_ids, status } = req.body;
    const existing = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Scenario not found', code: 'NOT_FOUND' });
    sqlite.prepare(`
      UPDATE scenarios SET name=?, description=?, seed_utterance=?, expected_outcome_type=?,
      expected_outcome_value=?, persona_id=?, tags=?, metric_ids=?, status=?, updated_at=?
      WHERE id=?
    `).run(name, description || null, seed_utterance, expected_outcome_type,
      expected_outcome_value || null, persona_id || null, JSON.stringify(tags || []),
      JSON.stringify(metric_ids || []), status, now(), req.params.id);
    const updated = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(parseScenario(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update scenario', code: 'UPDATE_ERROR' });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existing = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Scenario not found', code: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM scenarios WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete scenario', code: 'DELETE_ERROR' });
  }
});

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, count = 5, persona_hint, agent_id } = req.body;

    if (process.env.OPENAI_API_KEY) {
      try {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        let agentContext = '';
        if (agent_id) {
          const agent = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id) as Record<string, unknown>;
          if (agent) {
            agentContext = `Agent: ${agent.name}\nAgent Prompt: ${agent.prompt || 'Not specified'}\nTools: ${agent.tools || '[]'}`;
          }
        }

        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a QA engineer generating test scenarios for AI agent evaluation. You MUST respond with a JSON object containing a "scenarios" key with an array of scenario objects. Do not return a bare array — always wrap it in {"scenarios": [...]}.'
            },
            {
              role: 'user',
              content: `Generate exactly ${count} evaluation scenarios for an AI agent.

${agentContext}

Request: ${prompt}
${persona_hint ? `Persona hint: ${persona_hint}` : ''}

Each scenario must follow this structure exactly:
{
  "name": "short descriptive scenario name",
  "description": "one sentence description of the scenario",
  "seed_utterance": "the exact first message the customer sends",
  "expected_outcome_type": "natural_language",
  "expected_outcome_value": "description of what a successful outcome looks like",
  "tags": ["relevant-tag", "ai-generated"]
}

Respond with: {"scenarios": [<${count} scenario objects>]}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.8,
        });

        const raw = response.choices[0].message.content || '{}';
        const result = JSON.parse(raw);

        // Try all common keys the model might use
        const scenarios =
          result.scenarios ||
          result.data ||
          result.items ||
          result.results ||
          result.evaluation_scenarios ||
          // If the object has exactly one key and its value is an array, use that
          (Object.keys(result).length === 1 && Array.isArray(Object.values(result)[0])
            ? Object.values(result)[0]
            : null);

        if (Array.isArray(scenarios) && scenarios.length > 0) {
          return res.json(scenarios);
        }

        // If we still got nothing, log and fall through to mock
        console.warn('[generate] OpenAI returned unexpected structure:', JSON.stringify(result).slice(0, 200));
      } catch (err) {
        console.error('[generate] OpenAI call failed:', err);
        // Fall through to mock
      }
    }

    // Mock scenarios
    const mockScenarios = [
      {
        name: 'Late Payment Dispute',
        description: 'Customer disputes a late payment fee and wants it waived',
        seed_utterance: "I was charged a late fee but I set up autopay. This is your system's fault.",
        expected_outcome_type: 'natural_language',
        expected_outcome_value: 'Agent investigates the autopay issue, acknowledges the system problem if applicable, and resolves the fee dispute appropriately',
        tags: ['billing', 'dispute', 'ai-generated']
      },
      {
        name: 'Coverage Clarification',
        description: 'Customer is confused about what their policy covers',
        seed_utterance: "I need to understand exactly what my policy covers. I had an incident and I\'m not sure if it\'s covered.",
        expected_outcome_type: 'natural_language',
        expected_outcome_value: 'Agent clearly explains the relevant coverage details and guides customer on next steps for their incident',
        tags: ['coverage', 'inquiry', 'ai-generated']
      },
      {
        name: 'Policy Upgrade Request',
        description: 'Customer wants to upgrade their coverage',
        seed_utterance: "I want to upgrade my policy to include more coverage. What options do I have?",
        expected_outcome_type: 'natural_language',
        expected_outcome_value: 'Agent presents upgrade options, explains benefits and costs, and either completes upgrade or schedules follow-up',
        tags: ['upgrade', 'upsell', 'ai-generated']
      },
      {
        name: 'Address Change',
        description: 'Customer needs to update their address',
        seed_utterance: "I moved recently and need to update my address on my policy.",
        expected_outcome_type: 'tool_call',
        expected_outcome_value: 'update_customer_address',
        tags: ['account', 'update', 'ai-generated']
      },
      {
        name: 'Claim Status Inquiry',
        description: 'Customer wants to know the status of an existing claim',
        seed_utterance: "I filed a claim 2 weeks ago and haven\'t heard anything. What\'s the status?",
        expected_outcome_type: 'natural_language',
        expected_outcome_value: 'Agent retrieves claim status and provides clear timeline and next steps to customer',
        tags: ['claims', 'status', 'ai-generated']
      },
    ];

    res.json(mockScenarios.slice(0, count));
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate scenarios', code: 'GENERATION_ERROR' });
  }
});

router.post('/import', (req: Request, res: Response) => {
  try {
    const { scenarios, agent_id } = req.body;
    if (!Array.isArray(scenarios) || !agent_id) {
      return res.status(400).json({ error: 'scenarios array and agent_id required', code: 'VALIDATION_ERROR' });
    }

    const results: Array<{ row: number; status: 'success' | 'error'; error?: string; scenario?: unknown }> = [];

    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      if (!s.name || !s.seed_utterance) {
        results.push({ row: i + 1, status: 'error', error: 'Missing required fields: name, seed_utterance' });
        continue;
      }
      try {
        const id = uuidv4();
        sqlite.prepare(`
          INSERT INTO scenarios (id, agent_id, name, description, seed_utterance, expected_outcome_type, expected_outcome_value, persona_id, tags, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, agent_id, s.name, s.description || null, s.seed_utterance,
          s.expected_outcome_type || 'natural_language', s.expected_outcome_value || null,
          null, JSON.stringify(s.tags ? (Array.isArray(s.tags) ? s.tags : s.tags.split(',').map((t: string) => t.trim())) : []),
          'draft', 'import', now(), now());
        const created = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as Record<string, unknown>;
        results.push({ row: i + 1, status: 'success', scenario: parseScenario(created) });
      } catch (e) {
        results.push({ row: i + 1, status: 'error', error: String(e) });
      }
    }

    res.json({ results, total: scenarios.length, success: results.filter(r => r.status === 'success').length, errors: results.filter(r => r.status === 'error').length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to import scenarios', code: 'IMPORT_ERROR' });
  }
});

export default router;
