import { Router, Request, Response } from 'express';
import { sqlite } from '../db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

function now() { return new Date().toISOString(); }

function parseTrialResult(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    ...row,
    nfr_metrics: row.nfr_metrics ? JSON.parse(row.nfr_metrics as string) : null,
    pass_fail: row.pass_fail === 1 || row.pass_fail === true,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    metric_scores: row.metric_scores ? JSON.parse(row.metric_scores as string) : [],
    kpi_components: row.kpi_components ? JSON.parse(row.kpi_components as string) : [],
    vapi_trace: row.vapi_trace ? JSON.parse(row.vapi_trace as string) : null,
  };
}

router.get('/:id', (req: Request, res: Response) => {
  try {
    const trial = sqlite.prepare('SELECT * FROM trial_results WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    if (!trial) return res.status(404).json({ error: 'Trial result not found', code: 'NOT_FOUND' });

    const turns = sqlite.prepare('SELECT * FROM transcript_turns WHERE trial_result_id = ? ORDER BY turn_index').all(req.params.id) as Array<Record<string, unknown>>;
    const turnsWithMeta = turns.map(t => ({
      ...t,
      metadata: t.metadata ? JSON.parse(t.metadata as string) : {}
    }));

    const toolCalls: Record<string, unknown>[] = [];
    const kbCalls: Record<string, unknown>[] = [];

    for (const turn of turns) {
      const tcs = sqlite.prepare('SELECT * FROM tool_calls WHERE turn_id = ?').all(turn.id as string) as Array<Record<string, unknown>>;
      for (const tc of tcs) {
        toolCalls.push({
          ...tc,
          input_args: tc.input_args ? JSON.parse(tc.input_args as string) : {},
          response: tc.response ? JSON.parse(tc.response as string) : {},
          turn_id: turn.id
        });
      }

      const kbs = sqlite.prepare('SELECT * FROM kb_calls WHERE turn_id = ?').all(turn.id as string) as Array<Record<string, unknown>>;
      for (const kb of kbs) {
        kbCalls.push({
          ...kb,
          chunks: kb.chunks ? JSON.parse(kb.chunks as string) : [],
          turn_id: turn.id
        });
      }
    }

    const annotations = sqlite.prepare('SELECT * FROM annotations WHERE trial_result_id = ? ORDER BY created_at').all(req.params.id) as Array<Record<string, unknown>>;
    const assignment = sqlite.prepare('SELECT * FROM assignments WHERE trial_result_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.id) as Record<string, unknown>;

    res.json({
      ...parseTrialResult(trial),
      turns: turnsWithMeta,
      tool_calls: toolCalls,
      kb_calls: kbCalls,
      annotations: annotations.map(a => ({
        ...a,
        tags: a.tags ? JSON.parse(a.tags as string) : []
      })),
      assignment: assignment ? {
        ...assignment,
        history: assignment.history ? JSON.parse(assignment.history as string) : []
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trial result', code: 'FETCH_ERROR' });
  }
});

router.post('/:id/annotations', (req: Request, res: Response) => {
  try {
    const { note_text, tags, turn_id, author_id, author_name } = req.body;
    if (!note_text) return res.status(400).json({ error: 'note_text is required', code: 'VALIDATION_ERROR' });

    const trial = sqlite.prepare('SELECT id FROM trial_results WHERE id = ?').get(req.params.id);
    if (!trial) return res.status(404).json({ error: 'Trial result not found', code: 'NOT_FOUND' });

    const annotationId = uuidv4();
    sqlite.prepare(`
      INSERT INTO annotations (id, trial_result_id, turn_id, note_text, tags, author_id, author_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(annotationId, req.params.id, turn_id || null, note_text,
      JSON.stringify(tags || []), author_id || null, author_name || 'Anonymous', now());

    const annotation = sqlite.prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId) as Record<string, unknown>;
    res.status(201).json({
      ...annotation,
      tags: annotation.tags ? JSON.parse(annotation.tags as string) : []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create annotation', code: 'CREATE_ERROR' });
  }
});

router.get('/:id/annotations', (req: Request, res: Response) => {
  try {
    const annotations = sqlite.prepare('SELECT * FROM annotations WHERE trial_result_id = ? ORDER BY created_at DESC').all(req.params.id) as Array<Record<string, unknown>>;
    res.json(annotations.map(a => ({
      ...a,
      tags: a.tags ? JSON.parse(a.tags as string) : []
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch annotations', code: 'FETCH_ERROR' });
  }
});

router.post('/:id/assign', (req: Request, res: Response) => {
  try {
    const { assignee_id, assignee_name, due_date } = req.body;

    const existing = sqlite.prepare('SELECT * FROM assignments WHERE trial_result_id = ?').get(req.params.id) as Record<string, unknown>;

    if (existing) {
      const history = existing.history ? JSON.parse(existing.history as string) : [];
      history.push({ status: 'in_review', assignee: assignee_name, changed_at: now() });
      sqlite.prepare(`
        UPDATE assignments SET assignee_id=?, assignee_name=?, status=?, due_date=?, history=?, updated_at=?
        WHERE trial_result_id=?
      `).run(assignee_id || null, assignee_name || null, 'in_review',
        due_date || null, JSON.stringify(history), now(), req.params.id);
    } else {
      const history = [{ status: 'in_review', assignee: assignee_name, changed_at: now() }];
      sqlite.prepare(`
        INSERT INTO assignments (id, trial_result_id, assignee_id, assignee_name, status, due_date, history, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), req.params.id, assignee_id || null, assignee_name || null,
        'in_review', due_date || null, JSON.stringify(history), now(), now());
    }

    const assignment = sqlite.prepare('SELECT * FROM assignments WHERE trial_result_id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({
      ...assignment,
      history: assignment.history ? JSON.parse(assignment.history as string) : []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign trial', code: 'ASSIGN_ERROR' });
  }
});

router.put('/:id/tags', (req: Request, res: Response) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array', code: 'VALIDATION_ERROR' });

    const trial = sqlite.prepare('SELECT id FROM trial_results WHERE id = ?').get(req.params.id);
    if (!trial) return res.status(404).json({ error: 'Trial result not found', code: 'NOT_FOUND' });

    sqlite.prepare('UPDATE trial_results SET tags = ? WHERE id = ?').run(JSON.stringify(tags), req.params.id);
    const updated = sqlite.prepare('SELECT * FROM trial_results WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json(parseTrialResult(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tags', code: 'UPDATE_ERROR' });
  }
});

router.put('/:id/status', (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['unassigned', 'in_review', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status', code: 'VALIDATION_ERROR' });
    }

    const existing = sqlite.prepare('SELECT * FROM assignments WHERE trial_result_id = ?').get(req.params.id) as Record<string, unknown>;
    if (!existing) return res.status(404).json({ error: 'Assignment not found', code: 'NOT_FOUND' });

    const history = existing.history ? JSON.parse(existing.history as string) : [];
    history.push({ status, changed_at: now() });
    sqlite.prepare('UPDATE assignments SET status=?, history=?, updated_at=? WHERE trial_result_id=?')
      .run(status, JSON.stringify(history), now(), req.params.id);

    const updated = sqlite.prepare('SELECT * FROM assignments WHERE trial_result_id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({
      ...updated,
      history: updated.history ? JSON.parse(updated.history as string) : []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status', code: 'UPDATE_ERROR' });
  }
});

export default router;
