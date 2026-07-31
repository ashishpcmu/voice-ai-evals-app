import { v4 as uuidv4 } from 'uuid';
import { SimulationResult, TranscriptTurn, ToolCall, KBCall, NFRMetrics } from '../types';

interface SimulationInput {
  scenario_seed: string;
  expected_outcome_type: string;
  expected_outcome_value?: string;
  agent_name: string;
  agent_prompt?: string;
  agent_sop?: string;
  agent_system_prompt?: string; // user-supplied override; takes priority over agent_prompt/sop
  scenario_name: string;
  scenario_description?: string;
  mode: 'mock' | 'live' | 'agent';
  agent_type?: 'openai' | 'claude' | 'custom';
  max_turns?: number;
}

// ── Mock templates (unchanged) ─────────────────────────────────────────────

const TOOL_CALL_TEMPLATES: Record<string, { input: object; output: object }> = {
  verify_customer_identity: {
    input: { policy_id: 'POL-' + Math.floor(Math.random() * 9000 + 1000), dob: '1985-06-15', ssn_last4: '5678' },
    output: { verified: true, customer_name: 'Robert Williams', policy_id: 'POL-4567' }
  },
  get_policy_details: {
    input: { policy_id: 'POL-4567' },
    output: { policy_id: 'POL-4567', plan: 'Standard', premium: 98, coverage_limit: 250000, start_date: '2022-06-01', status: 'active', years_as_customer: 2 }
  },
  process_cancellation: {
    input: { policy_id: 'POL-4567', reason: 'customer_request', effective_date: 'immediate' },
    output: { success: true, confirmation_number: 'CAN-' + Date.now(), refund_amount: 89, refund_eta_days: 5 }
  },
  offer_discount: {
    input: { policy_id: 'POL-4567', discount_type: 'loyalty', discount_percent: 15 },
    output: { success: true, new_premium: 83, savings_annual: 180 }
  },
  check_refund_eligibility: {
    input: { policy_id: 'POL-4567' },
    output: { eligible: true, refund_amount: 89, calculation: 'pro-rated for 27 remaining days' }
  },
  create_ticket: {
    input: { customer_id: 'CUST-9876', type: 'cancellation_request', priority: 'normal' },
    output: { ticket_id: 'TKT-' + Math.floor(Math.random() * 9000 + 1000), status: 'created', estimated_resolution: '24 hours' }
  }
};

const KB_TEMPLATES: Record<string, { query: string; chunks: object[] }> = {
  policy_cancellation_faq: {
    query: 'What are the steps to cancel an insurance policy?',
    chunks: [
      { title: 'Policy Cancellation Guide', snippet: 'To cancel your policy, we require identity verification and a stated reason. Cancellations take effect immediately.', score: 0.95 },
      { title: 'Cancellation Fees', snippet: 'No early termination fees apply to standard policies. Premium plan holders may incur a $25 admin fee in first 6 months.', score: 0.88 },
      { title: 'Notice Period', snippet: 'No notice period required. Same-day cancellations are processed immediately.', score: 0.79 }
    ]
  },
  retention_offers: {
    query: 'What retention options can I offer to customers wanting to cancel?',
    chunks: [
      { title: 'Loyalty Discount', snippet: 'Customers with 2+ years may qualify for 15-20% loyalty discount. No coverage changes required.', score: 0.97 },
      { title: 'Plan Alternatives', snippet: 'Consider offering Standard plan ($89/mo) as alternative to Premium ($145/mo) for cost-sensitive customers.', score: 0.91 },
      { title: 'Bundle Savings', snippet: 'Multi-product bundles offer 10-15% additional discount. Consider if customer has home/auto/life needs.', score: 0.84 }
    ]
  },
  refund_policy: {
    query: 'How are policy refunds calculated and processed?',
    chunks: [
      { title: 'Refund Calculation', snippet: 'Pro-rated refund = (Remaining days / Period days) × Monthly premium. Processed within 3-7 business days.', score: 0.93 },
      { title: 'Refund Methods', snippet: 'Refunds go to the original payment method. Credit card refunds: 3-5 days. Bank transfers: 5-7 days.', score: 0.87 }
    ]
  }
};

function generateMockConversation(input: SimulationInput) {
  const seed = input.scenario_seed.toLowerCase();
  const isPriceObjection = seed.includes('too high') || seed.includes('expensive') || seed.includes('cheaper') || seed.includes('price');
  const isUrgent = seed.includes('immediately') || seed.includes('urgent') || seed.includes('right now');
  const isConfused = seed.includes('not sure') || seed.includes('maybe') || seed.includes('thinking');
  const isVerificationIssue = seed.includes("don't have") || seed.includes("can't find") || seed.includes('handy');

  if (isPriceObjection) {
    return { turns: [
      { role: 'user', content: input.scenario_seed, delay: 0 },
      { role: 'agent', content: "I completely understand your concern about pricing. Let me pull up your account and see what options we have available for you.", delay: 850 },
      { role: 'tool', content: 'verify_customer_identity', delay: 1800 },
      { role: 'tool', content: 'get_policy_details', delay: 2700 },
      { role: 'kb', content: 'retention_offers', delay: 3200 },
      { role: 'agent', content: "I can see you're on our Standard plan at $98/month. I have a few options that could reduce your premium: 1) A 15% loyalty discount bringing it to $83/month, 2) Switching to our Essential plan at $65/month, or 3) A bundle discount if you add another policy. What sounds most interesting?", delay: 4100 },
      { role: 'user', content: "Tell me more about the loyalty discount.", delay: 5200 },
      { role: 'agent', content: "The loyalty discount is available because you've been with us for over 2 years. It's a 15% reduction applied directly to your current premium — no changes to your coverage. You'd save $180 annually. I can apply it right now if you'd like.", delay: 6100 },
      { role: 'user', content: "That sounds good. Let's do that.", delay: 7300 },
      { role: 'tool', content: 'offer_discount', delay: 8000 },
      { role: 'agent', content: "Done! I've applied the 15% loyalty discount. Your new monthly premium is $83, starting from your next billing cycle. You'll receive a confirmation email shortly. Is there anything else I can help you with?", delay: 8900 },
      { role: 'user', content: "No, that's great. Thank you!", delay: 9800 },
    ]};
  } else if (isUrgent) {
    return { turns: [
      { role: 'user', content: input.scenario_seed, delay: 0 },
      { role: 'agent', content: "I understand you need this handled quickly. Let me verify your identity right away so we can proceed.", delay: 780 },
      { role: 'tool', content: 'verify_customer_identity', delay: 1700 },
      { role: 'tool', content: 'check_refund_eligibility', delay: 2600 },
      { role: 'agent', content: "Identity verified. I can process your cancellation immediately. You're eligible for a pro-rated refund of $89. Shall I proceed?", delay: 3400 },
      { role: 'user', content: "Yes, please go ahead.", delay: 4500 },
      { role: 'tool', content: 'process_cancellation', delay: 5400 },
      { role: 'kb', content: 'refund_policy', delay: 5700 },
      { role: 'agent', content: "Your policy has been cancelled. Confirmation: CAN-" + Date.now() + ". Refund of $89 will be processed within 3-5 business days to your original payment method.", delay: 6500 },
      { role: 'user', content: "Perfect, thank you.", delay: 7400 },
    ]};
  } else if (isConfused) {
    return { turns: [
      { role: 'user', content: input.scenario_seed, delay: 0 },
      { role: 'agent', content: "It sounds like you're evaluating your options — that's completely understandable. Could you share more about what's prompting this? Is it mainly cost, coverage, or a life change?", delay: 920 },
      { role: 'user', content: "Mainly cost, but I also want to make sure I still have good coverage.", delay: 2100 },
      { role: 'tool', content: 'verify_customer_identity', delay: 2900 },
      { role: 'tool', content: 'get_policy_details', delay: 3800 },
      { role: 'kb', content: 'retention_offers', delay: 4200 },
      { role: 'agent', content: "Looking at your current policy, you're on Standard at $98/month with $250k coverage. I have two suggestions: 1) A loyalty discount reducing to $83/month with identical coverage, or 2) Our Essential plan at $65/month with $100k coverage.", delay: 5200 },
      { role: 'user', content: "I think the loyalty discount makes sense. Can you apply it?", delay: 9000 },
      { role: 'tool', content: 'offer_discount', delay: 9700 },
      { role: 'agent', content: "Done! Loyalty discount applied. Your new premium is $83/month. Good choice — you keep all your current coverage at a lower price. Is there anything else you'd like to review?", delay: 10600 },
      { role: 'user', content: "No, that's all. Thanks for explaining everything.", delay: 11500 },
    ]};
  } else if (isVerificationIssue) {
    return { turns: [
      { role: 'user', content: input.scenario_seed, delay: 0 },
      { role: 'agent', content: "Not a problem! I can verify you through other means. Could you provide your full name, date of birth, and the email address on your account?", delay: 880 },
      { role: 'user', content: "My name is Robert Williams, born June 15, 1985. Email is robert.williams@email.com", delay: 2200 },
      { role: 'tool', content: 'verify_customer_identity', delay: 3100 },
      { role: 'agent', content: "I found a partial match, but for security, I need one more piece of information: either your SSN last 4 digits or the phone number on file.", delay: 3900 },
      { role: 'user', content: "I don't have that either. Is there another way?", delay: 5100 },
      { role: 'kb', content: 'policy_cancellation_faq', delay: 5400 },
      { role: 'agent', content: "I understand this is frustrating. For security, I cannot process this without proper verification. Options: 1) I can email you a secure cancellation link, 2) You can complete this through our online portal once you log in, 3) Call back when you have your policy number available.", delay: 6300 },
      { role: 'user', content: "Please send the email link.", delay: 7600 },
      { role: 'tool', content: 'create_ticket', delay: 8400 },
      { role: 'agent', content: "I've sent a secure cancellation link to robert.williams@email.com. It's valid for 48 hours. Once you click it and complete verification, the cancellation will process immediately. Is there anything else I can help with?", delay: 9400 },
      { role: 'user', content: "No, I'll look for the email.", delay: 10300 },
    ]};
  } else {
    return { turns: [
      { role: 'user', content: input.scenario_seed, delay: 0 },
      { role: 'agent', content: "I can help you with your cancellation request. I'll need to verify your identity first. Could you provide your policy number and date of birth?", delay: 800 },
      { role: 'user', content: "Sure. My policy number is POL-4567 and I was born June 15, 1985.", delay: 2000 },
      { role: 'tool', content: 'verify_customer_identity', delay: 2900 },
      { role: 'agent', content: "Identity verified. Before I proceed, may I ask the reason for cancellation? I want to ensure we've addressed any concerns and explored all options.", delay: 3700 },
      { role: 'user', content: "I'm moving abroad and won't need domestic coverage.", delay: 4900 },
      { role: 'kb', content: 'policy_cancellation_faq', delay: 5200 },
      { role: 'tool', content: 'check_refund_eligibility', delay: 5600 },
      { role: 'agent', content: "I understand. For international relocations, cancellation definitely makes sense. You're eligible for a pro-rated refund of $89 for the remaining 27 days of your billing period. Shall I proceed with the cancellation?", delay: 6500 },
      { role: 'user', content: "Yes, please.", delay: 7600 },
      { role: 'tool', content: 'process_cancellation', delay: 8400 },
      { role: 'agent', content: "Your policy has been cancelled effective today. Confirmation: CAN-" + Date.now() + ". Refund of $89 processing within 5-7 business days. Safe travels!", delay: 9200 },
      { role: 'user', content: "Thank you so much!", delay: 10000 },
    ]};
  }
}

// ── Agent mode: real LLM simulation ───────────────────────────────────────

const DEFAULT_MAX_TURNS = 20;

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

function agentSystemPrompt(input: SimulationInput): string {
  // User-supplied prompt takes full priority
  if (input.agent_system_prompt?.trim()) {
    return input.agent_system_prompt.trim();
  }
  // Fallback: build from agent config
  return [
    `You are ${input.agent_name}, a professional contact center AI assistant.`,
    input.agent_prompt ? `Your instructions: ${input.agent_prompt}` : '',
    input.agent_sop ? `Your SOP: ${input.agent_sop}` : '',
    `You are handling a customer contact. Be professional, empathetic, and concise.`,
    `When the customer's issue is fully resolved, end with "Is there anything else I can help you with?" or a closing statement.`,
    `Keep responses under 80 words. Do not repeat yourself.`,
  ].filter(Boolean).join('\n');
}

function userSimulatorSystemPrompt(input: SimulationInput): string {
  // Infer persona tone from scenario name/seed for richer simulation
  const seed = input.scenario_seed.toLowerCase();
  const isFrustrated = seed.includes('too high') || seed.includes('immediately') || seed.includes('urgent');
  const isConfused = seed.includes('not sure') || seed.includes('maybe') || seed.includes('thinking');
  const tone = isFrustrated ? 'frustrated and impatient' : isConfused ? 'uncertain and looking for guidance' : 'polite but firm';
  const goal = isFrustrated
    ? 'get your issue resolved as quickly as possible'
    : isConfused
    ? 'understand your options before making a decision'
    : 'complete your request efficiently';

  return [
    `You are roleplaying as a real customer in a conversation with a contact center agent.`,
    ``,
    `YOUR OPENING MESSAGE (already sent): "${input.scenario_seed}"`,
    input.scenario_description ? `SCENARIO CONTEXT: ${input.scenario_description}` : '',
    `YOUR TONE: ${tone}`,
    `YOUR GOAL: ${goal}`,
    ``,
    `STRICT RULES:`,
    `- You are the CUSTOMER. The messages you receive are from the AGENT.`,
    `- Read the agent's latest message carefully and respond specifically to what they said.`,
    `- Remember everything discussed so far — do NOT ask for something already provided.`,
    `- Do NOT repeat your opening message verbatim. Build on the conversation.`,
    `- Stay in character and pursue your goal naturally.`,
    `- Keep responses short and realistic (under 40 words).`,
    `- If the agent fully resolves your issue, say a brief thank you and that you're done.`,
    `- If the agent is unhelpful or repeating themselves, express mild frustration.`,
    `- NEVER respond as the agent. Only ever speak as the customer.`,
  ].filter(Boolean).join('\n');
}

function isAgentDone(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes('anything else') || t.includes('have a great') || t.includes('take care') ||
    t.includes('goodbye') || t.includes('safe travels') || t.includes('thank you for calling') ||
    t.includes('is there anything else');
}

function isCustomerDone(text: string): boolean {
  const t = text.toLowerCase();
  return (t.includes('thank') && (t.includes('bye') || t.includes("that's all") || t.includes("that's great") || t.includes("no,") || t.includes("no that"))) ||
    t.includes("goodbye") || t.includes("that's everything") || t.includes("i'm done") ||
    (t.includes("no") && t.includes("thank"));
}

async function callAgentOpenAI(messages: ChatMessage[]): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages,
    max_tokens: 256,
    temperature: 0.7,
  });
  return {
    content: response.choices[0].message.content || '',
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  };
}

async function callAgentClaude(messages: ChatMessage[]): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: systemMsg,
    messages: chatMsgs,
  });

  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function callUserSimulatorOpenAI(messages: ChatMessage[]): Promise<{ content: string }> {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages,
    max_tokens: 128,
    temperature: 0.8,
  });
  return { content: response.choices[0].message.content || '' };
}

async function runAgentSimulation(input: SimulationInput): Promise<SimulationResult> {
  const simStart = Date.now();
  const turns: TranscriptTurn[] = [];
  let turnIndex = 0;
  let totalTurns = 0;
  let firstAgentTs = 0;
  const agentLatencies: number[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let agentWordCount = 0;
  let userWordCount = 0;

  // Agent history: model plays agent (assistant), customer is user
  const agentHistory: ChatMessage[] = [{ role: 'system', content: agentSystemPrompt(input) }];

  // Simulator history: model plays CUSTOMER (assistant), agent messages are user.
  // Roles are intentionally swapped here — the LLM always generates 'assistant' turns,
  // so to simulate the customer we treat agent messages as 'user' inputs.
  const simHistory: ChatMessage[] = [{ role: 'system', content: userSimulatorSystemPrompt(input) }];

  // First turn: customer opens with the scenario seed
  const seedContent = input.scenario_seed;
  userWordCount += seedContent.split(/\s+/).filter(Boolean).length;
  turns.push({
    id: uuidv4(), trial_result_id: '', turn_index: turnIndex++,
    role: 'user', content: seedContent, timestamp_ms: 0, metadata: {}
  });
  agentHistory.push({ role: 'user', content: seedContent });
  // simHistory does NOT include the seed as a message — the system prompt already
  // tells the model "your opening message was: '...'" so it knows what it said.
  // The first entry in simHistory will be the agent's opening reply (as 'user').
  totalTurns++;
  const maxTurns = input.max_turns ?? DEFAULT_MAX_TURNS;

  while (totalTurns < maxTurns) {
    // ── Agent turn ──────────────────────────────────────────────────────
    const agentCallStart = Date.now();
    let agentContent: string;
    let inTok = 0, outTok = 0;

    try {
      if (input.agent_type === 'claude') {
        const r = await callAgentClaude(agentHistory);
        agentContent = r.content; inTok = r.inputTokens; outTok = r.outputTokens;
      } else {
        const r = await callAgentOpenAI(agentHistory);
        agentContent = r.content; inTok = r.inputTokens; outTok = r.outputTokens;
      }
    } catch (err) {
      console.error('Agent LLM call failed:', err);
      agentContent = "I apologize, I'm experiencing technical difficulties. Let me transfer you to a human agent.";
      inTok = 50; outTok = 20;
    }

    const agentCallEnd = Date.now();
    const agentTs = agentCallEnd - simStart;
    if (firstAgentTs === 0) firstAgentTs = agentTs;
    agentLatencies.push(agentCallEnd - agentCallStart);
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    agentWordCount += agentContent.split(/\s+/).filter(Boolean).length;

    turns.push({
      id: uuidv4(), trial_result_id: '', turn_index: turnIndex++,
      role: 'agent', content: agentContent, timestamp_ms: agentTs, metadata: {}
    });
    agentHistory.push({ role: 'assistant', content: agentContent });
    // Agent's reply is the 'user' prompt for the customer simulator
    simHistory.push({ role: 'user', content: agentContent });
    totalTurns++;

    if (isAgentDone(agentContent) || totalTurns >= maxTurns) break;

    // ── User simulator turn ─────────────────────────────────────────────
    let userContent: string;
    try {
      const r = await callUserSimulatorOpenAI(simHistory);
      userContent = r.content;
    } catch (err) {
      console.error('User simulator LLM call failed:', err);
      userContent = "Thank you, that resolves my issue.";
    }

    const userTs = Date.now() - simStart;
    userWordCount += userContent.split(/\s+/).filter(Boolean).length;

    turns.push({
      id: uuidv4(), trial_result_id: '', turn_index: turnIndex++,
      role: 'user', content: userContent, timestamp_ms: userTs, metadata: {}
    });
    agentHistory.push({ role: 'user', content: userContent });
    // Customer's reply is 'assistant' in simHistory (what the model generated)
    simHistory.push({ role: 'assistant', content: userContent });
    totalTurns++;

    if (isCustomerDone(userContent)) break;
  }

  const avgLatency = agentLatencies.length > 0
    ? Math.round(agentLatencies.reduce((a, b) => a + b, 0) / agentLatencies.length)
    : 0;
  const e2eLatency = Date.now() - simStart;
  const costPerToken = 0.002 / 1000;
  const cost = Math.round((totalInputTokens + totalOutputTokens) * costPerToken * 10000) / 10000;
  const talkRatio = userWordCount > 0 ? Math.round((agentWordCount / userWordCount) * 100) / 100 : 1.5;

  return {
    turns,
    tool_calls: [] as ToolCall[],
    kb_calls: [] as KBCall[],
    nfr_metrics: {
      ttft: firstAgentTs,
      avg_latency: avgLatency,
      e2e_latency: e2eLatency,
      cost,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      model_calls: agentLatencies.length,
    } as NFRMetrics,
    talk_ratio: talkRatio,
  };
}

// ── Mock simulation (from pre-scripted templates) ─────────────────────────

async function runMockSimulation(input: SimulationInput): Promise<SimulationResult> {
  const template = generateMockConversation(input);
  const turns: TranscriptTurn[] = [];
  const toolCallsResult: ToolCall[] = [];
  const kbCallsResult: KBCall[] = [];

  let agentWordCount = 0, userWordCount = 0;
  let firstAgentResponseTime = 0;
  const agentTurnTimes: number[] = [];
  let modelCalls = 0, totalInputTokens = 0, totalOutputTokens = 0, lastTurnTime = 0;

  for (let i = 0; i < template.turns.length; i++) {
    const t = template.turns[i];
    const turnId = uuidv4();
    const timestamp = (t as { delay?: number }).delay || 0;

    if (t.role === 'tool') {
      const toolName = t.content;
      const tmpl = TOOL_CALL_TEMPLATES[toolName] || { input: {}, output: { success: true } };
      const latency = Math.floor(Math.random() * 150) + 80;
      turns.push({ id: turnId, trial_result_id: '', turn_index: i, role: 'tool', content: `Tool call: ${toolName}`, timestamp_ms: timestamp, metadata: { tool_name: toolName } });
      toolCallsResult.push({ id: uuidv4(), turn_id: turnId, tool_name: toolName, input_args: tmpl.input as Record<string, unknown>, response: tmpl.output as Record<string, unknown>, latency_ms: latency, status: 'success' });
      modelCalls++;
      totalInputTokens += Math.floor(Math.random() * 100) + 50;
      totalOutputTokens += Math.floor(Math.random() * 80) + 30;
    } else if (t.role === 'kb') {
      const kbName = t.content;
      const tmpl = KB_TEMPLATES[kbName] || { query: `Query for ${kbName}`, chunks: [{ title: 'General Info', snippet: 'Retrieved information from knowledge base.', score: 0.75 }] };
      const latency = Math.floor(Math.random() * 80) + 50;
      turns.push({ id: turnId, trial_result_id: '', turn_index: i, role: 'kb', content: `KB lookup: ${kbName}`, timestamp_ms: timestamp, metadata: { kb_source: kbName } });
      kbCallsResult.push({ id: uuidv4(), turn_id: turnId, query: tmpl.query, chunks: tmpl.chunks as Array<{ title: string; snippet: string; score: number }>, latency_ms: latency, kb_source: kbName });
    } else {
      turns.push({ id: turnId, trial_result_id: '', turn_index: i, role: t.role as 'user' | 'agent', content: t.content, timestamp_ms: timestamp, metadata: {} });
      const wc = t.content.split(/\s+/).length;
      if (t.role === 'agent') {
        agentWordCount += wc;
        if (firstAgentResponseTime === 0) firstAgentResponseTime = timestamp;
        if (i > 0) {
          const prevTs = turns.filter(x => x.role === 'user' && (x.timestamp_ms || 0) < timestamp).pop()?.timestamp_ms || 0;
          agentTurnTimes.push(timestamp - prevTs);
        }
        modelCalls++;
        totalInputTokens += Math.floor(wc * 1.3 + Math.random() * 50);
        totalOutputTokens += Math.floor(wc * 1.3 + Math.random() * 30);
      } else if (t.role === 'user') {
        userWordCount += wc;
      }
      lastTurnTime = Math.max(lastTurnTime, timestamp);
    }
  }

  const avgLatency = agentTurnTimes.length > 0
    ? Math.round(agentTurnTimes.reduce((a, b) => a + b, 0) / agentTurnTimes.length)
    : 1200;
  const cost = Math.round((totalInputTokens + totalOutputTokens) * 0.002 / 1000 * 10000) / 10000;

  return {
    turns, tool_calls: toolCallsResult, kb_calls: kbCallsResult,
    nfr_metrics: { ttft: firstAgentResponseTime || 800, avg_latency: avgLatency, e2e_latency: lastTurnTime || 10000, cost, input_tokens: totalInputTokens, output_tokens: totalOutputTokens, model_calls: modelCalls } as NFRMetrics,
    talk_ratio: userWordCount > 0 ? Math.round((agentWordCount / userWordCount) * 100) / 100 : 1.5,
  };
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function runSimulation(input: SimulationInput): Promise<SimulationResult> {
  const isAgentMode = input.mode === 'agent' && input.agent_type !== 'custom';
  if (isAgentMode) {
    return runAgentSimulation(input);
  }
  return runMockSimulation(input);
}
