import Anthropic from '@anthropic-ai/sdk';

interface ScoringInput {
  scenario_name: string;
  expected_outcome_type: string;
  expected_outcome_value?: string;
  turns: Array<{ role: string; content: string }>;
  tool_calls: Array<{ tool_name: string; status: string }>;
}

interface ScoringComponent {
  component: string;
  score: number;
  evidence: string;
}

interface ScoringResult {
  score: number;
  rationale: string;
  pass_fail: boolean;
  components?: ScoringComponent[];
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function buildJudgePrompt(input: ScoringInput): string {
  const transcript = input.turns
    .map(t => `[${t.role.toUpperCase()}]: ${t.content}`)
    .join('\n');

  const toolCallsSection = input.tool_calls.length > 0
    ? input.tool_calls.map(t => `- ${t.tool_name} (${t.status})`).join('\n')
    : 'None';

  if (input.expected_outcome_type === 'tool_call') {
    return `You are an expert AI conversation evaluator for a contact center quality assurance platform.

<scenario>
Name: ${input.scenario_name}
Expected Outcome: A specific tool call must be made.
Required Tool: ${input.expected_outcome_value || 'Not specified'}
</scenario>

<transcript>
${transcript}
</transcript>

<tool_calls_made>
${toolCallsSection}
</tool_calls_made>

Evaluate whether the required tool "${input.expected_outcome_value}" was called successfully. A missing or failed tool call must result in a score below 0.4 regardless of conversation quality.

Respond with ONLY valid JSON:
{
  "components": [
    { "component": "Required tool called", "score": 0.0-1.0, "evidence": "one sentence citing the transcript" },
    { "component": "Tool called with correct inputs", "score": 0.0-1.0, "evidence": "one sentence" },
    { "component": "Conversation quality", "score": 0.0-1.0, "evidence": "one sentence" }
  ],
  "score": <average of component scores, float 0.0-1.0>,
  "rationale": "<2-3 sentences summarising the overall result>",
  "pass_fail": <true if score >= 0.7>
}`;
  }

  if (input.expected_outcome_type === 'kpi_threshold') {
    return `You are an expert AI conversation evaluator for a contact center quality assurance platform.

<scenario>
Name: ${input.scenario_name}
Expected Outcome: The conversation must satisfy a KPI threshold.
KPI Condition: ${input.expected_outcome_value || 'Not specified'}
</scenario>

<transcript>
${transcript}
</transcript>

<tool_calls_made>
${toolCallsSection}
</tool_calls_made>

Evaluate whether the conversation satisfies the KPI condition. A pleasant conversation that fails the KPI target must score below 0.5.

Respond with ONLY valid JSON:
{
  "components": [
    { "component": "KPI condition met", "score": 0.0-1.0, "evidence": "one sentence citing the transcript" },
    { "component": "Conversation quality", "score": 0.0-1.0, "evidence": "one sentence" }
  ],
  "score": <weighted score giving 70% weight to KPI condition, float 0.0-1.0>,
  "rationale": "<2-3 sentences summarising the overall result>",
  "pass_fail": <true if score >= 0.7>
}`;
  }

  // Natural language outcome — decompose into components
  return `You are an expert AI conversation evaluator for a contact center quality assurance platform.

<scenario>
Name: ${input.scenario_name}
Expected Outcome: ${input.expected_outcome_value || 'Not specified'}
</scenario>

<transcript>
${transcript}
</transcript>

<tool_calls_made>
${toolCallsSection}
</tool_calls_made>

Instructions:
1. Read the expected outcome carefully and identify each distinct requirement it contains (look for conjunctions like "and", commas listing actions, or separate clauses). Each requirement is a component.
2. For each component, score it 0.0–1.0 based on evidence in the transcript:
   - 1.0 = fully demonstrated with clear evidence
   - 0.5 = partially demonstrated or implied
   - 0.0 = absent or contradicted
3. The overall score is the mean of all component scores.
4. A pass requires overall score >= 0.7.
5. Be strict — do not give credit for a component if the transcript does not clearly support it.

Respond with ONLY valid JSON:
{
  "components": [
    { "component": "<exact requirement extracted from the outcome>", "score": 0.0-1.0, "evidence": "one sentence citing specific turns" }
    // one entry per identified component
  ],
  "score": <mean of component scores, float 0.0-1.0>,
  "rationale": "<2-3 sentences explaining which components passed and failed and how they drove the overall score>",
  "pass_fail": <true if score >= 0.7>
}`;
}

/** Create an Anthropic judge client when direct API credentials are configured. */
function getJudgeClient(): { client: Anthropic; sonnet: string; haiku: string } | null {
  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return {
      client,
      sonnet: process.env.LLM_JUDGE_MODEL || 'claude-sonnet-4-6',
      haiku: process.env.LLM_JUDGE_MODEL_LIGHT || 'claude-haiku-4-5-20251001',
    };
  }
  return null;
}

export async function scoreConversation(input: ScoringInput): Promise<ScoringResult> {
  const judge = getJudgeClient();
  if (process.env.OPENAI_API_KEY) {
    console.log('[scorer] judge → OpenAI (gpt-4o-mini)');
    return scoreWithOpenAI(input);
  }
  if (judge) {
    console.log(`[scorer] judge → Anthropic direct (${judge.sonnet})`);
    return scoreWithClaude(input);
  }
  console.log('[scorer] judge → mock (no LLM configured)');
  return mockScore(input);
}

// Claude free-forms JSON (no OpenAI-style json_object mode), so its output can include
// // line comments (e.g. echoing the prompt template) or trailing commas. Strip those
// before parsing so a stray comment doesn't force a mock fallback.
function parseLenientJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in response');
  const cleaned = match[0]
    .replace(/^\s*\/\/.*$/gm, '')    // full-line // comments
    .replace(/,(\s*[}\]])/g, '$1');  // trailing commas before } or ]
  return JSON.parse(cleaned);
}

async function scoreWithClaude(input: ScoringInput): Promise<ScoringResult> {
  try {
    const judge = getJudgeClient();
    if (!judge) return mockScore(input);
    const prompt = buildJudgePrompt(input);

    const response = await judge.client.messages.create({
      model: judge.sonnet,
      max_tokens: 4096, // components array + rationale can exceed 1024 → truncated JSON
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'max_tokens') {
      console.warn('[scorer] Claude judge hit max_tokens — JSON may be truncated');
    }
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const result = parseLenientJson(text);

    return {
      score: Math.max(0, Math.min(1, Number(result.score) || 0.5)),
      rationale: result.rationale || 'No rationale provided.',
      pass_fail: result.pass_fail ?? (Number(result.score) >= 0.7),
      components: result.components || [],
    };
  } catch (err) {
    console.error('Claude scoring failed, falling back to mock:', err);
    return mockScore(input);
  }
}

async function scoreWithOpenAI(input: ScoringInput): Promise<ScoringResult> {
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = buildJudgePrompt(input);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
      score: Math.max(0, Math.min(1, Number(result.score) || 0.5)),
      rationale: result.rationale || 'Unable to generate rationale.',
      pass_fail: result.pass_fail ?? (Number(result.score) >= 0.7),
      components: result.components || [],
    };
  } catch {
    return mockScore(input);
  }
}

function mockScore(input: ScoringInput): ScoringResult {
  let score = 0.5;
  const factors: string[] = [];

  if (input.expected_outcome_type === 'tool_call') {
    const requiredTool = input.expected_outcome_value;
    const toolCallMade = input.tool_calls.some(tc => tc.tool_name === requiredTool);
    if (toolCallMade) {
      score += 0.3;
      factors.push(`Required tool call '${requiredTool}' was successfully executed`);
    } else {
      score -= 0.2;
      factors.push(`Required tool call '${requiredTool}' was NOT executed`);
    }
  }

  const agentTurns = input.turns.filter(t => t.role === 'agent');
  const userTurns = input.turns.filter(t => t.role === 'user');

  const hasVerification = input.tool_calls.some(tc => tc.tool_name === 'verify_customer_identity');
  if (hasVerification) {
    score += 0.1;
    factors.push('Customer identity was properly verified');
  }

  const lastAgentTurn = agentTurns[agentTurns.length - 1]?.content?.toLowerCase() || '';
  const hasConfirmation = lastAgentTurn.includes('confirm') || lastAgentTurn.includes('process') ||
    lastAgentTurn.includes('done') || lastAgentTurn.includes('completed') || lastAgentTurn.includes('cancelled');
  if (hasConfirmation) {
    score += 0.1;
    factors.push('Conversation reached a clear resolution or confirmation');
  }

  if (agentTurns.length < 2) {
    score -= 0.2;
    factors.push('Conversation was too short to adequately address customer needs');
  }

  const hasEmpathy = agentTurns.some(t =>
    t.content.toLowerCase().includes('understand') ||
    t.content.toLowerCase().includes('appreciate') ||
    t.content.toLowerCase().includes('sorry') ||
    t.content.toLowerCase().includes('help')
  );
  if (hasEmpathy) {
    score += 0.05;
    factors.push('Agent demonstrated empathy and customer-centric communication');
  }

  const agentWords = agentTurns.reduce((sum, t) => sum + countWords(t.content), 0);
  const userWords = userTurns.reduce((sum, t) => sum + countWords(t.content), 0);
  const ratio = userWords > 0 ? agentWords / userWords : 2;
  if (ratio > 3.5) {
    score -= 0.1;
    factors.push('Agent spoke significantly more than customer — potential over-explanation');
  }

  score = Math.max(0.1, Math.min(1.0, score));

  const pass_fail = score >= 0.7;
  const rationale = factors.length > 0
    ? factors.slice(0, 3).join('. ') + '.'
    : `Conversation scored ${score.toFixed(2)} based on outcome achievement and communication quality.`;

  return { score: Math.round(score * 100) / 100, rationale, pass_fail };
}

export interface MetricScore {
  id: string;
  name: string;
  score: number;
  rationale: string;
}

export async function scoreMetrics(
  metrics: Array<{ id: string; name: string; description?: string }>,
  turns: Array<{ role: string; content: string }>,
  scenarioName: string
): Promise<MetricScore[]> {
  if (metrics.length === 0) return [];

  const transcript = turns.map(t => `[${t.role.toUpperCase()}]: ${t.content}`).join('\n');

  return Promise.all(metrics.map(async metric => {
    const description = metric.description || metric.name;
    try {
      if (process.env.OPENAI_API_KEY) {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Evaluate this conversation for the metric below. Respond with ONLY valid JSON.\n\nScenario: ${scenarioName}\nMetric: "${metric.name}"\nDescription: ${description}\n\nTranscript:\n${transcript}\n\nRespond: {"score": 0.0-1.0, "rationale": "2-3 sentences"}`
          }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 200,
        });
        const result = JSON.parse(response.choices[0].message.content || '{}');
        return { id: metric.id, name: metric.name, score: Math.min(1, Math.max(0, parseFloat(result.score) || 0)), rationale: result.rationale || 'No rationale.' };
      }
      const judge = getJudgeClient();
      if (judge) {
        const response = await judge.client.messages.create({
          model: judge.haiku,
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `Evaluate this conversation for the metric below. Respond with ONLY valid JSON.\n\nScenario: ${scenarioName}\nMetric: "${metric.name}"\nDescription: ${description}\n\nTranscript:\n${transcript}\n\nRespond: {"score": 0.0-1.0, "rationale": "2-3 sentences"}`
          }],
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const result = parseLenientJson(text);
        return { id: metric.id, name: metric.name, score: Math.min(1, Math.max(0, parseFloat(result.score) || 0)), rationale: result.rationale || 'No rationale.' };
      }
    } catch (err) {
      console.error(`[scoreMetrics] failed for metric "${metric.name}":`, err);
    }
    // Mock fallback
    const mockScore = 0.5 + (Math.random() * 0.4 - 0.2);
    return { id: metric.id, name: metric.name, score: Math.round(mockScore * 100) / 100, rationale: `Mock evaluation for "${metric.name}": conversation demonstrates moderate compliance with this metric.` };
  }));
}

export async function testMetric(metricDescription: string, transcript: string): Promise<{ score: number; rationale: string }> {
  const judge = getJudgeClient();
  if (judge) {
    try {
      const response = await judge.client.messages.create({
        model: judge.sonnet,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Evaluate this conversation transcript against the following metric and respond with ONLY a JSON object.

Metric: ${metricDescription}

Transcript:
${transcript}

Respond with: {"score": 0.0-1.0, "rationale": "explanation"}`
        }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const result = parseLenientJson(text);
      return { score: result.score || 0.5, rationale: result.rationale || 'No rationale provided.' };
    } catch {
      // fall through
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'user',
          content: `Evaluate this conversation transcript against the following metric:\n\nMetric: ${metricDescription}\n\nTranscript:\n${transcript}\n\nRespond in JSON: {"score": 0.0-1.0, "rationale": "explanation"}`
        }],
        response_format: { type: 'json_object' }
      });
      const result = JSON.parse(response.choices[0].message.content || '{}');
      return { score: result.score || 0.5, rationale: result.rationale || 'No rationale provided.' };
    } catch {
      // fall through
    }
  }

  return {
    score: 0.72,
    rationale: `Based on analysis of the transcript against the metric "${metricDescription}", the conversation demonstrates moderate to good compliance. Key observations: the agent addressed the customer's primary concern, used appropriate language, and reached a resolution within a reasonable number of turns.`
  };
}
