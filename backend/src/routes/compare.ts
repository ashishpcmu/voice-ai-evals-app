import { Router, Request, Response } from 'express';
import { sqlite } from '../db';

const router = Router();

function parseRun(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    ...row,
    summary_metrics: row.summary_metrics ? JSON.parse(row.summary_metrics as string) : null,
    scenario_ids: row.scenario_ids ? JSON.parse(row.scenario_ids as string) : [],
  };
}

router.post('/', (req: Request, res: Response) => {
  try {
    const { baseline_run_id, new_run_id } = req.body;
    if (!baseline_run_id || !new_run_id) {
      return res.status(400).json({ error: 'baseline_run_id and new_run_id required', code: 'VALIDATION_ERROR' });
    }

    const baselineRun = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(baseline_run_id) as Record<string, unknown>;
    const newRun = sqlite.prepare('SELECT * FROM eval_runs WHERE id = ?').get(new_run_id) as Record<string, unknown>;

    if (!baselineRun || !newRun) {
      return res.status(404).json({ error: 'One or both runs not found', code: 'NOT_FOUND' });
    }

    const baseline = parseRun(baselineRun);
    const newRunParsed = parseRun(newRun);

    const baselineSummary = baseline?.summary_metrics || {};
    const newSummary = newRunParsed?.summary_metrics || {};

    function delta(newVal: number, baseVal: number) {
      const diff = newVal - baseVal;
      const pct = baseVal !== 0 ? (diff / baseVal) * 100 : 0;
      return { diff: Math.round(diff * 1000) / 1000, pct: Math.round(pct * 10) / 10 };
    }

    const summaryComparison = {
      kpi_score: {
        baseline: baselineSummary.avg_kpi || 0,
        new: newSummary.avg_kpi || 0,
        ...delta(newSummary.avg_kpi || 0, baselineSummary.avg_kpi || 0)
      },
      pass_rate: {
        baseline: baselineSummary.pass_rate || 0,
        new: newSummary.pass_rate || 0,
        ...delta(newSummary.pass_rate || 0, baselineSummary.pass_rate || 0)
      },
      avg_ttft: {
        baseline: baselineSummary.avg_ttft || 0,
        new: newSummary.avg_ttft || 0,
        ...delta(newSummary.avg_ttft || 0, baselineSummary.avg_ttft || 0)
      },
      avg_latency: {
        baseline: baselineSummary.avg_latency || 0,
        new: newSummary.avg_latency || 0,
        ...delta(newSummary.avg_latency || 0, baselineSummary.avg_latency || 0)
      },
      total_cost: {
        baseline: baselineSummary.total_cost || 0,
        new: newSummary.total_cost || 0,
        ...delta(newSummary.total_cost || 0, baselineSummary.total_cost || 0)
      }
    };

    // Per-scenario comparison
    const baselineScenarioIds = baseline?.scenario_ids as string[] || [];
    const newScenarioIds = newRunParsed?.scenario_ids as string[] || [];
    const allScenarioIds = [...new Set([...baselineScenarioIds, ...newScenarioIds])];

    const scenarioComparisons = [];
    const regressions = [];

    for (const scenarioId of allScenarioIds) {
      const scenario = sqlite.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId) as Record<string, unknown>;
      if (!scenario) continue;

      const baselineTrials = sqlite.prepare('SELECT * FROM trial_results WHERE run_id = ? AND scenario_id = ?').all(baseline_run_id, scenarioId) as Array<Record<string, unknown>>;
      const newTrials = sqlite.prepare('SELECT * FROM trial_results WHERE run_id = ? AND scenario_id = ?').all(new_run_id, scenarioId) as Array<Record<string, unknown>>;

      const baselineKpi = baselineTrials.reduce((s, t) => s + (t.kpi_score as number || 0), 0) / (baselineTrials.length || 1);
      const newKpi = newTrials.reduce((s, t) => s + (t.kpi_score as number || 0), 0) / (newTrials.length || 1);
      const kpiDelta = newKpi - baselineKpi;

      const baselineLatency = baselineTrials.reduce((s, t) => {
        const nfr = t.nfr_metrics ? JSON.parse(t.nfr_metrics as string) : {};
        return s + (nfr.avg_latency || 0);
      }, 0) / (baselineTrials.length || 1);
      const newLatency = newTrials.reduce((s, t) => {
        const nfr = t.nfr_metrics ? JSON.parse(t.nfr_metrics as string) : {};
        return s + (nfr.avg_latency || 0);
      }, 0) / (newTrials.length || 1);

      const comparison = {
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        baseline_kpi: Math.round(baselineKpi * 100) / 100,
        new_kpi: Math.round(newKpi * 100) / 100,
        kpi_delta: Math.round(kpiDelta * 100) / 100,
        direction: kpiDelta > 0.01 ? 'up' : kpiDelta < -0.01 ? 'down' : 'neutral',
        baseline_latency: Math.round(baselineLatency),
        new_latency: Math.round(newLatency),
        latency_delta: Math.round(newLatency - baselineLatency)
      };

      scenarioComparisons.push(comparison);

      // Flag regressions
      if (kpiDelta < -0.05 || (newLatency - baselineLatency) / (baselineLatency || 1) > 0.1) {
        regressions.push({
          ...comparison,
          reason: kpiDelta < -0.05 ? `KPI regressed by ${Math.abs(Math.round(kpiDelta * 100))}%` : `Latency increased by ${Math.round(((newLatency - baselineLatency) / baselineLatency) * 100)}%`
        });
      }
    }

    res.json({
      baseline_run: baseline,
      new_run: newRunParsed,
      summary_comparison: summaryComparison,
      scenario_comparisons: scenarioComparisons,
      regressions
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compare runs', code: 'COMPARE_ERROR' });
  }
});

export default router;
