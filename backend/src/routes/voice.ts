// ─── Vapi Agent Evaluation (Beta) ───────────────────────────────────────────
// This is a completely isolated feature for testing Vapi agent evaluation.
// It does not touch the main database or any existing routes/services.

import { Router, Request, Response } from 'express';
import OpenAI, { toFile } from 'openai';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { sqlite } from '../db';
import {
  TwilioCallState,
  twilioCallStates,
  vapiTraceCache,
  escapeXml,
  twilioRequest,
  finalizeVoiceEval,
} from '../services/voiceEval';

// ── Vapi API types ────────────────────────────────────────────────────────────

interface VapiMessage {
  // Vapi API returns 'assistant' in call records but 'bot' in webhook payloads
  role: 'system' | 'user' | 'bot' | 'assistant' | 'tool_calls' | 'tool_call_result' | 'tool_call' | 'tool_result';
  message?: string;   // used in webhook payloads
  content?: string;   // used in API call records
  toolCallList?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCallId?: string;
  name?: string;
  result?: string;
  time?: number;
  secondsFromStart?: number;
}

interface VapiCallRecord {
  id: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  transcript?: string;
  messages?: VapiMessage[];
  artifact?: { transcript?: string; recordingUrl?: string; messages?: VapiMessage[] };
  costBreakdown?: Record<string, number>;
}

const router = Router();

// ── STT provider selection ────────────────────────────────────────────────────
// Switch providers via .env: STT_PROVIDER=groq | openai (default: openai)
//   - groq:   whisper-large-v3-turbo (fast, ~10x cheaper). Requires GROQ_API_KEY.
//   - openai: whisper-1 (original). Requires OPENAI_API_KEY.
// Override the model with GROQ_STT_MODEL or OPENAI_STT_MODEL if needed.

function getSttClient(fallbackOpenAIKey?: string): { client: OpenAI; model: string; provider: string } {
  const provider = (process.env.STT_PROVIDER || 'openai').toLowerCase();
  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('STT_PROVIDER=groq but GROQ_API_KEY is not set in .env');
    return {
      client: new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
      model: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
      provider: 'groq',
    };
  }
  const apiKey = process.env.OPENAI_API_KEY || fallbackOpenAIKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return {
    client: new OpenAI({ apiKey }),
    model: process.env.OPENAI_STT_MODEL || 'whisper-1',
    provider: 'openai',
  };
}

// ── LLM provider selection (customer simulator) ──────────────────────────────
// Switch via .env: LLM_PROVIDER=groq | openai (default: openai)
//   - groq:   openai/gpt-oss-120b via OpenAI-compatible API. Requires GROQ_API_KEY.
//   - openai: gpt-4o-mini.
// Override the model with GROQ_LLM_MODEL or OPENAI_LLM_MODEL.
//
// Per-call overrides: pass `provider` and/or `model` to override the env default.
// Used by eval runs where the user picks a customer-simulator LLM in NewRunModal.

function getLlmClient(opts?: {
  fallbackOpenAIKey?: string;
  provider?: string;
  model?: string;
}): { client: OpenAI; model: string; provider: string } {
  const provider = (opts?.provider || process.env.LLM_PROVIDER || 'openai').toLowerCase();
  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('LLM provider=groq but GROQ_API_KEY is not set in .env');
    return {
      client: new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
      model: opts?.model || process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b',
      provider: 'groq',
    };
  }
  const apiKey = process.env.OPENAI_API_KEY || opts?.fallbackOpenAIKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return {
    client: new OpenAI({ apiKey }),
    model: opts?.model || process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
    provider: 'openai',
  };
}

// Parses a "provider:model" or bare-model string from `state.customerSimulatorModel`.
// Bare model strings default to OpenAI (backwards compatibility with existing eval runs).
function resolveCustomerSimulator(raw: string | undefined): { provider?: string; model?: string } {
  if (!raw) return {};
  const idx = raw.indexOf(':');
  if (idx === -1) return { provider: 'openai', model: raw };
  return { provider: raw.slice(0, idx), model: raw.slice(idx + 1) };
}

// ── Call recording storage (30-min local retention, deleted from Twilio after fetch) ──
// We enable Twilio's full-call recording (Record=true) on the outbound call.
// When Twilio fires the RecordingStatusCallback, we download the MP3, save it
// to disk, and delete the Twilio-side recording so storage cost stays at ~0.
// Files are kept for 30 minutes locally, then auto-cleaned.
//
// The Map and helpers live in services/callRecordingStore.ts so the Eval Run
// flow can populate them without creating a circular import.

import {
  RECORDINGS_DIR,
  recordingMeta,
  markRecordingPending,
} from '../services/callRecordingStore';

// ── Hardcoded scenarios ──────────────────────────────────────────────────────

// NOTE: These scenarios are designed for a SaaS Support agent that:
// - Asks for work email to look up the caller in Salesforce
// - Verifies identity via email + company name, OR last 4 digits of invoice/contract ID
// - Creates/updates Salesforce cases
// - Handles: account access, billing, troubleshooting, plan changes

const VAPI_SCENARIOS = [
  {
    id: 'voice-s1',
    name: 'Account Login Issue',
    description: 'User cannot log in to the SaaS product after a password reset.',
    seed: "Hi, I'm unable to log in to my account. I've already tried resetting my password but it's still not working.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS product support line. You are NOT the support agent — you are the customer who needs help.

ABOUT THE SUPPORT AGENT YOU ARE CALLING:
- This is a SaaS product support line.
- The agent will ask for your work email to look you up.
- The agent will verify your identity by confirming your email + company name, or the last 4 digits of your invoice/contract ID.
- The agent may create a support case for you.

YOUR IDENTITY (provide these naturally when asked — do not volunteer everything upfront):
- Name: Sarah Mitchell
- Work email: sarah.mitchell@brightwave.io
- Company: Brightwave Inc.
- Job title: Operations Manager
- Plan: Professional (billed annually)
- Contract ID last 4 digits: 7743
- Invoice ID last 4 digits: 2291
- Browser: Chrome 124 on macOS
- Error message you see: "Invalid credentials. Please try again." after entering the new password

YOUR SITUATION:
You have been unable to log in since this morning. You reset your password via the email link, set a new one, but when you try to log in it still shows "Invalid credentials." You have tried twice and also cleared your browser cache. You need access urgently because you have a client presentation at 2pm today that relies on data in the product.

CONVERSATION RULES:
- Respond ONLY as the customer. Never respond as the agent or offer support.
- When the agent asks for your email, give: sarah.mitchell@brightwave.io
- When asked to verify identity, confirm your company name (Brightwave Inc.) or offer invoice last 4 (2291).
- Describe what you've already tried when asked about troubleshooting steps.
- Express urgency about your 2pm presentation if the agent is slow.
- Keep each reply to 1–3 short sentences.
- Do NOT say "how can I help you", "I can assist", or anything an agent would say.`,
  },
  {
    id: 'voice-s2',
    name: 'Policy Cancellation — Undisclosed Charges',
    description: 'Frustrated customer wants to cancel Safeguard Insurance policy due to charges not disclosed at purchase. Will stay only if agent proactively offers ≥15% discount.',
    seed: "Hi, I'm calling because I want to cancel my Safeguard Insurance policy. I've been charged fees that nobody told me about when I signed up, and I'm not happy about it.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling Safeguard Insurance customer support to cancel your policy. You are NOT the support agent.

ABOUT THE SUPPORT AGENT YOU ARE CALLING:
- This is a Safeguard Insurance support line.
- The agent will ask for your policy number and date of birth to verify your identity.
- The agent handles policy cancellations, billing disputes, and retention offers.

YOUR IDENTITY (provide naturally when asked):
- Name: James Hartley
- Date of Birth: 12 March 1985
- Policy Number: SFG-2291-7743
- Policy Type: Comprehensive Home Insurance
- Monthly Premium: $148/month
- Policy Start Date: 8 months ago

YOUR SITUATION:
You signed up 8 months ago. At the time of purchase, you were NOT told about a $25/month "Policy Administration Fee" and a $15/month "Emergency Response Surcharge" that have been appearing on your statements since month 3. You only noticed them when you reviewed your bank statements last week. You are genuinely frustrated — you feel misled. You want to cancel the policy immediately.

RETENTION RULE — CRITICAL:
- You are willing to stay ONLY if the agent proactively offers you a discount of at least 15% off your monthly premium without you asking for it first.
- If the agent offers a discount of 15% or more unprompted: accept it, express relief, and agree to stay.
- If the agent offers a discount less than 15%, or only offers it after you ask: decline it and insist on cancellation.
- If the agent does NOT offer any discount at all: proceed with cancellation.
- Do NOT hint that a discount would change your mind. Do NOT ask for a discount yourself. Let the agent figure that out.

CONVERSATION RULES:
- Respond ONLY as the customer. Never say anything an agent would say.
- When asked for policy number, give: SFG-2291-7743
- When asked for DOB, give: 12 March 1985
- Express frustration clearly — you feel deceived about the hidden fees.
- If the agent tries to explain the fees without offering resolution, say "I understand but I wasn't told about these charges upfront."
- Keep each reply to 1–3 short sentences.
- Do NOT end the call yourself until the outcome is clear (cancellation confirmed or retention offer accepted).`,
  },
  {
    id: 'voice-s3',
    name: 'Feature Not Working',
    description: 'Customer reports that the data export feature is broken and blocking their workflow.',
    seed: "The data export feature in your product has stopped working for us. Every time I try to export, it just spins and then times out. This is blocking our end-of-month reporting.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS product support line about a broken feature. You are NOT the support agent.

ABOUT THE SUPPORT AGENT YOU ARE CALLING:
- This is a SaaS product support line.
- The agent will ask for your work email to find your account.
- The agent will verify your identity via email + company name, or last 4 digits of your contract/invoice.
- The agent will likely create a support case and may escalate.

YOUR IDENTITY (provide naturally when asked):
- Name: Priya Anand
- Work email: priya.anand@nexusmedia.co
- Company: Nexus Media Co.
- Job title: Data Analyst
- Plan: Business Plan
- Contract ID last 4 digits: 6612
- Invoice last 4 digits: 0847
- Browser: Firefox 125 on Windows 10
- Issue started: 2 days ago
- Export format you are trying: CSV, dataset size ~50,000 rows

YOUR SITUATION:
The CSV data export has been broken for 2 days. It starts processing, spins for about 90 seconds, then shows a generic "Export failed. Please try again." error. You have tried smaller datasets (5,000 rows) and it still fails. Your end-of-month report is due tomorrow and you cannot complete it without this export. You need this escalated as high priority.

CONVERSATION RULES:
- Respond ONLY as the customer.
- When asked for email, give: priya.anand@nexusmedia.co
- When asked to verify, confirm company (Nexus Media Co.) or contract last 4 (6612).
- Describe the error clearly: 90 seconds of spinning then "Export failed."
- Emphasize the business impact — report is due tomorrow.
- If the agent suggests basic troubleshooting you've already tried, tell them you've already done that.
- Keep each reply to 1–3 short sentences.
- Do NOT say anything an agent would say.`,
  },
  {
    id: 'voice-s4',
    name: 'Plan Upgrade Inquiry',
    description: 'Customer wants to understand what is included in the Business plan before upgrading.',
    seed: "Hi, we're currently on the Professional plan and we're considering upgrading to Business. I just want to make sure I understand what we'd be getting before I commit.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS product support line to ask about a plan upgrade. You are NOT the support agent.

ABOUT THE SUPPORT AGENT YOU ARE CALLING:
- This is a SaaS product support line.
- The agent will ask for your work email to pull up your account.
- The agent will verify your identity via email + company name, or last 4 digits of invoice/contract ID.

YOUR IDENTITY (provide naturally when asked):
- Name: Jordan Lee
- Work email: jordan.lee@stratapulse.com
- Company: StrataPulse
- Job title: VP of Product
- Current plan: Professional ($299/month), on it for 8 months
- Team size: 22 users
- Contract ID last 4 digits: 4490
- Invoice last 4 digits: 7723

YOUR SITUATION:
You are evaluating an upgrade from Professional to Business. Your team has grown to 22 users and you're hitting the user seat limit on Professional (which you believe is 15 seats). You want to know: exact user seat limits on Business, any additional features vs Professional, the price difference, and whether there is an annual discount. You are ready to upgrade today if the value is clear.

CONVERSATION RULES:
- Respond ONLY as the customer.
- When asked for email, give: jordan.lee@stratapulse.com
- When asked to verify, confirm company (StrataPulse) or invoice last 4 (7723).
- Ask specific questions about seat limits, feature differences, and pricing.
- If the agent offers to connect you to sales, ask if they can give you a rough price estimate first.
- Keep each reply to 1–3 short sentences.
- Do NOT say anything an agent would say.`,
  },
];

// ── Hardcoded metrics ────────────────────────────────────────────────────────

const VAPI_METRICS = [
  {
    id: 'voice-m1',
    name: 'Goal Completion',
    description: 'Did the agent successfully help the customer achieve their stated goal or resolve their issue?',
  },
  {
    id: 'voice-m2',
    name: 'Response Quality',
    description: 'Were the agent responses accurate, relevant, helpful, and professional throughout the conversation?',
  },
  {
    id: 'voice-m3',
    name: 'Conversation Flow',
    description: 'Was the conversation natural, coherent, and well-structured? Did the agent maintain context across turns?',
  },
  {
    id: 'voice-m4',
    name: 'Resolution Rate',
    description: 'Was the customer issue fully resolved by the end of the conversation without unnecessary escalation?',
  },
];

// ── Twilio voice eval state store ────────────────────────────────────────────

// Note: TwilioCallState, twilioCallStates, escapeXml, twilioRequest, finalizeVoiceEval
// are all imported from services/voiceEval.ts above.

// ── GET /scenarios ───────────────────────────────────────────────────────────

router.get('/scenarios', (_req: Request, res: Response) => {
  res.json(VAPI_SCENARIOS);
});

// ── GET /metrics ─────────────────────────────────────────────────────────────

router.get('/metrics', (_req: Request, res: Response) => {
  res.json(VAPI_METRICS);
});

// ── POST /test-connection ────────────────────────────────────────────────────

router.post('/test-connection', async (req: Request, res: Response) => {
  const { apiKey, assistantId } = req.body;
  if (!apiKey || !assistantId) {
    return res.status(400).json({ error: 'apiKey and assistantId are required' });
  }
  try {
    const response = await fetch('https://api.vapi.ai/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assistantId, input: 'Hello' }),
    });
    if (response.status === 401) {
      return res.status(401).json({ error: 'Invalid Vapi API key' });
    }
    if (response.status === 404) {
      return res.status(404).json({ error: 'Assistant ID not found' });
    }
    if (!response.ok) {
      const text = await response.text();
      return res.status(400).json({ error: `Vapi error: ${text}` });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Could not reach Vapi: ${(err as Error).message}` });
  }
});

// ── POST /evaluate ───────────────────────────────────────────────────────────

router.post('/evaluate', async (req: Request, res: Response) => {
  const { apiKey, assistantId, scenarioId, metricIds } = req.body;

  if (!apiKey || !assistantId || !scenarioId) {
    return res.status(400).json({ error: 'apiKey, assistantId, and scenarioId are required' });
  }

  const scenario = VAPI_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const selectedMetrics = metricIds?.length
    ? VAPI_METRICS.filter(m => metricIds.includes(m.id))
    : VAPI_METRICS;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured on the server' });
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  interface Turn {
    role: 'user' | 'agent';
    content: string;
    timestamp_ms: number;
  }

  const turns: Turn[] = [];
  const startTime = Date.now();
  let previousChatId: string | undefined;
  let currentUserMessage = scenario.seed;
  // Roles are from the simulator's perspective:
  //   'assistant' = customer messages (what the model generates)
  //   'user'      = Vapi agent messages (what the model responds to)
  // This ensures OpenAI always generates customer-role content, preventing role drift.
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: '[Conversation started. You are the customer. Respond as the customer.]' },
  ];

  try {
    for (let turn = 0; turn < 20; turn++) {
      // Record user turn
      turns.push({ role: 'user', content: currentUserMessage, timestamp_ms: Date.now() - startTime });

      // Send to Vapi chat API
      const vapiBody: Record<string, string> = {
        assistantId,
        input: currentUserMessage,
      };
      if (previousChatId) vapiBody.previousChatId = previousChatId;

      const vapiRes = await fetch('https://api.vapi.ai/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiBody),
      });

      if (!vapiRes.ok) {
        const errText = await vapiRes.text();
        throw new Error(`Vapi API error (${vapiRes.status}): ${errText}`);
      }

      const vapiData = await vapiRes.json() as {
        id: string;
        output: Array<{ role: string; content: string }>;
      };

      previousChatId = vapiData.id;

      // Extract agent response — take the last non-empty assistant/agent message.
      // Vapi may include intermediate tool-call assistant messages with empty content;
      // we want only the final spoken response.
      const assistantMessages = (vapiData.output ?? [])
        .filter((m: { role: string; content?: string }) =>
          (m.role === 'assistant' || m.role === 'agent') && m.content?.trim()
        );
      const agentText = assistantMessages[assistantMessages.length - 1]?.content?.trim() ?? '';

      if (!agentText) {
        console.log(`[voice-eval] turn ${turn}: empty agentText, raw output:`, JSON.stringify(vapiData.output));
        break;
      }

      turns.push({ role: 'agent', content: agentText, timestamp_ms: Date.now() - startTime });
      // customer message → 'assistant' (what the model generates)
      // agent message    → 'user' (what the model responds to)
      conversationHistory.push({ role: 'assistant', content: currentUserMessage });
      conversationHistory.push({ role: 'user', content: agentText });

      // Only end on explicit farewell phrases, and only after at least 6 turns
      const endPhrases = ['goodbye', 'have a great day', 'have a great rest', 'take care', 'thank you for calling', 'thanks for calling'];
      if (turn >= 5 && endPhrases.some(p => agentText.toLowerCase().includes(p))) break;

      // Generate next customer message using OpenAI
      const simRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `${scenario.customer_context}

CURRENT INSTRUCTION: The agent just sent the message above. Write ONLY the customer's next reply — a single short response of 1–3 sentences.

CRITICAL RULES — follow every one of them:
- You ARE the customer. You are NOT the support agent. Never say "How can I help you?" or anything an agent would say.
- If the agent asks for your email address → immediately say your work email from YOUR IDENTITY above.
- If the agent asks for your name → give your name.
- If the agent asks for your company → give your company name.
- If the agent asks for the last 4 digits of your invoice or contract → give the exact digits from YOUR IDENTITY above.
- Answer every question with the details from YOUR IDENTITY. Never deflect or ask the agent to confirm.
- Do NOT end the conversation yourself. Keep engaging until the agent explicitly wraps up with a farewell.
- Never output "[END]" or any meta-instruction. Only write what the customer would actually say.`,
          },
          ...conversationHistory,
        ],
        max_tokens: 150,
        temperature: 0.4,
      });

      const nextMsg = simRes.choices[0]?.message?.content?.trim() || '';
      if (!nextMsg) break;
      currentUserMessage = nextMsg;
    }

    // Score each metric using OpenAI
    const transcriptText = turns
      .map(t => `${t.role === 'user' ? 'CUSTOMER' : 'AGENT'}: ${t.content}`)
      .join('\n');

    const metricScores = await Promise.all(
      selectedMetrics.map(async metric => {
        try {
          const scoreRes = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: 'You are an expert evaluator for AI conversational agents. Be objective and concise.',
              },
              {
                role: 'user',
                content: `Evaluate this conversation for the metric below and return JSON only.\n\nMetric: "${metric.name}"\nDescription: ${metric.description}\nScenario: ${scenario.description}\n\nTranscript:\n${transcriptText}\n\nReturn: {"score": <0.0-1.0>, "rationale": "<2-3 sentences>"}`,
              },
            ],
            max_tokens: 200,
            temperature: 0.2,
            response_format: { type: 'json_object' },
          });
          const parsed = JSON.parse(scoreRes.choices[0]?.message?.content || '{}');
          return {
            ...metric,
            score: Math.min(1, Math.max(0, parseFloat(parsed.score) || 0)),
            rationale: parsed.rationale || 'No rationale provided.',
          };
        } catch {
          return { ...metric, score: 0, rationale: 'Scoring failed.' };
        }
      })
    );

    res.json({
      scenario: { id: scenario.id, name: scenario.name, description: scenario.description, seed: scenario.seed },
      turns,
      metrics: metricScores,
      duration_ms: Date.now() - startTime,
      turn_count: turns.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'EVALUATION_ERROR' });
  }
});

// ── POST /evaluate-voice ─────────────────────────────────────────────────────
// Makes a real outbound Vapi call using a persona + scenario to build the
// customer simulator assistant inline.

interface VoicePersona {
  name: string;
  age: string;
  account_type: string;
  account_number: string;
  emotional_state: string;
  otp: string;
  dob: string;
  voice?: string;
}

interface VoiceScenario {
  reason: string;
  details: string;
  goal: string;
  opening_line: string;
}

router.post('/evaluate-voice', async (req: Request, res: Response) => {
  const { apiKey, phoneNumber, phoneNumberId, persona, scenario, metricIds } = req.body as {
    apiKey: string;
    phoneNumber: string;
    phoneNumberId: string;
    persona: VoicePersona;
    scenario: VoiceScenario;
    metricIds?: string[];
  };

  if (!apiKey || !phoneNumber || !phoneNumberId || !persona || !scenario) {
    return res.status(400).json({
      error: 'apiKey, phoneNumber, phoneNumberId, persona, and scenario are required',
    });
  }

  const selectedMetrics = metricIds?.length
    ? VAPI_METRICS.filter(m => metricIds.includes(m.id))
    : VAPI_METRICS;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured on the server' });
  }

  const openai = new OpenAI({ apiKey: openaiApiKey, timeout: 30_000 });

  // Build simulation prompt from persona + scenario (mirrors the Python reference impl)
  const simulationPrompt = `You are simulating a real customer calling a bank's AI voice agent.

## Your Persona
- Name: ${persona.name}
- Age: ${persona.age}
- Account Type: ${persona.account_type}
- Account Number: ${persona.account_number}
- Emotional State: ${persona.emotional_state}

## Your Scenario
- Reason for calling: ${scenario.reason}
- Key details: ${scenario.details}
- Goal: ${scenario.goal}
- If agent asks for OTP: respond with ${persona.otp}
- If agent asks for DOB: respond with ${persona.dob}

## Behavior Rules
- Speak naturally, like a real customer
- Don't reveal you are an AI
- If the agent doesn't understand, rephrase
- If agent resolves your issue, say thank you and end call
- If agent fails 3 times, get frustrated`;

  try {
    const callRes = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: phoneNumber },
        assistant: {
          firstMessage: scenario.opening_line,
          model: {
            provider: 'openai',
            model: 'gpt-4o',
            messages: [{ role: 'system', content: simulationPrompt }],
          },
          voice: {
            provider: 'playht',
            voiceId: persona.voice || 'jennifer',
          },
          endCallPhrases: [
            'goodbye',
            'have a great day',
            'have a great rest',
            'take care',
            'thanks for calling',
            'thank you for calling',
          ],
          maxDurationSeconds: 300,
          artifactPlan: {
            recordingEnabled: false,
            loggingEnabled: true,
            transcriptPlan: { enabled: true },
          },
        },
      }),
    });

    if (!callRes.ok) {
      const errText = await callRes.text();
      throw new Error(`Failed to create Vapi call (${callRes.status}): ${errText}`);
    }

    const callData = await callRes.json() as { id: string; status: string };
    const callId = callData.id;

    // Poll until call ends (max 10 minutes, check every 5 s)
    const deadline = Date.now() + 10 * 60 * 1000;
    let callResult: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const pollRes = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as Record<string, unknown>;
      if (pollData.status === 'ended') { callResult = pollData; break; }
    }

    if (!callResult) throw new Error('Voice call did not complete within the 10-minute timeout');

    // Extract transcript turns
    interface VapiMsg { role: string; message?: string; content?: string; secondsFromStart?: number; }
    interface Turn { role: 'user' | 'agent'; content: string; timestamp_ms: number; }

    const rawMessages: VapiMsg[] =
      (callResult.messages as VapiMsg[]) ||
      ((callResult.artifact as Record<string, unknown>)?.messages as VapiMsg[]) || [];

    const turns: Turn[] = rawMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant' || m.role === 'bot') && (m.message || m.content))
      .map(m => ({
        role: (m.role === 'assistant' || m.role === 'bot') ? 'agent' : 'user',
        content: (m.message ?? m.content ?? '').trim(),
        timestamp_ms: Math.round((m.secondsFromStart ?? 0) * 1000),
      }));

    if (turns.length === 0) {
      const transcript =
        (callResult.artifact as Record<string, unknown>)?.transcript as string | undefined ||
        callResult.transcript as string | undefined;
      if (transcript) {
        transcript.split('\n').forEach(line => {
          const agentMatch = line.match(/^(?:AI|Agent|Assistant):\s*(.+)/i);
          const userMatch = line.match(/^(?:User|Customer|Human):\s*(.+)/i);
          if (agentMatch) turns.push({ role: 'agent', content: agentMatch[1].trim(), timestamp_ms: 0 });
          else if (userMatch) turns.push({ role: 'user', content: userMatch[1].trim(), timestamp_ms: 0 });
        });
      }
    }

    if (turns.length === 0) throw new Error('No transcript was captured from the voice call');

    // Score metrics
    const transcriptText = turns.map(t => `${t.role === 'user' ? 'CUSTOMER' : 'AGENT'}: ${t.content}`).join('\n');
    const scenarioDesc = `${scenario.reason} — ${scenario.details}`;

    const metricScores = await Promise.all(
      selectedMetrics.map(async metric => {
        try {
          const scoreRes = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are an expert evaluator for AI voice agents. Be objective and concise.' },
              { role: 'user', content: `Evaluate this voice call transcript for the metric below and return JSON only.\n\nMetric: "${metric.name}"\nDescription: ${metric.description}\nScenario: ${scenarioDesc}\n\nTranscript:\n${transcriptText}\n\nReturn: {"score": <0.0-1.0>, "rationale": "<2-3 sentences>"}` },
            ],
            max_tokens: 200,
            temperature: 0.2,
            response_format: { type: 'json_object' },
          });
          const parsed = JSON.parse(scoreRes.choices[0]?.message?.content || '{}');
          return { ...metric, score: Math.min(1, Math.max(0, parseFloat(parsed.score) || 0)), rationale: parsed.rationale || 'No rationale provided.' };
        } catch {
          return { ...metric, score: 0, rationale: 'Scoring failed.' };
        }
      })
    );

    const endedAt = callResult.endedAt as string | undefined;
    const startedAt = (callResult.startedAt ?? callResult.createdAt) as string | undefined;

    res.json({
      scenario: { name: scenario.reason, description: scenarioDesc, seed: scenario.opening_line },
      persona: { name: persona.name, emotional_state: persona.emotional_state },
      turns,
      metrics: metricScores,
      duration_ms: endedAt && startedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0,
      turn_count: turns.length,
      call_id: callId,
      ended_reason: callResult.endedReason as string | undefined,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, code: 'VOICE_EVALUATION_ERROR' });
  }
});

// ── GET /twilio-ping ─────────────────────────────────────────────────────────
// Returns valid TwiML. Hit this URL from a browser to confirm Twilio can reach
// your backend: GET <webhookBaseUrl>/api/voice/twilio-ping

router.get('/twilio-ping', (_req: Request, res: Response) => {
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Webhook reachable.</Say><Hangup/></Response>');
});

// ── POST /evaluate-voice-twilio ──────────────────────────────────────────────
// Initiates a Twilio outbound call. Requires a publicly accessible webhook URL
// (e.g. via ngrok) so Twilio can call back to control the conversation.

router.post('/evaluate-voice-twilio', async (req: Request, res: Response) => {
  const {
    accountSid, authToken, fromNumber, toNumber, webhookBaseUrl, scenarioId, metricIds,
    customPersona, customScenario, silenceTimeout, mainAgentSpeaksFirst,
  } = req.body;

  if (!accountSid || !authToken || !fromNumber || !toNumber || !webhookBaseUrl || !scenarioId) {
    return res.status(400).json({
      error: 'accountSid, authToken, fromNumber, toNumber, webhookBaseUrl, and scenarioId are required',
    });
  }

  let scenario: typeof VAPI_SCENARIOS[0];

  if (scenarioId === 'custom') {
    if (!customPersona?.name || !customScenario?.reason || !customScenario?.opening_line) {
      return res.status(400).json({
        error: 'Custom scenario requires customPersona.name, customScenario.reason, and customScenario.opening_line',
      });
    }
    const customerContext = `You are PLAYING THE ROLE OF A CUSTOMER on a support call. You are NOT the support agent.

YOUR IDENTITY (provide naturally when asked):
- Name: ${customPersona.name}${customPersona.age ? `\n- Age: ${customPersona.age}` : ''}${customPersona.policy_number ? `\n- Policy / Account Number: ${customPersona.policy_number}` : ''}${customPersona.dob ? `\n- Date of Birth: ${customPersona.dob}` : ''}${customPersona.otp ? `\n- OTP / PIN: ${customPersona.otp}` : ''}
- Emotional State: ${customPersona.emotional_state || 'neutral'}

YOUR SITUATION:
- Reason for calling: ${customScenario.reason}${customScenario.details ? `\n- Key details: ${customScenario.details}` : ''}${customScenario.goal ? `\n- Your goal: ${customScenario.goal}` : ''}

CONVERSATION RULES:
- Respond ONLY as the customer. Never say anything a support agent would say.
- When asked for your name, policy/account number, DOB, or OTP — give the exact values from YOUR IDENTITY above.
- Stay in character as a ${customPersona.emotional_state || 'neutral'} customer throughout the call.
- Keep each reply to 1–3 short sentences.
- Do NOT end the call yourself until your issue is fully resolved or you are explicitly dismissed.`;

    scenario = {
      id: 'custom',
      name: customScenario.reason,
      description: customScenario.details || customScenario.reason,
      seed: customScenario.opening_line,
      customer_context: customerContext,
    };
  } else {
    const found = VAPI_SCENARIOS.find(s => s.id === scenarioId);
    if (!found) return res.status(404).json({ error: 'Scenario not found' });
    scenario = found;
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured on the server' });

  const selectedMetrics = metricIds?.length
    ? VAPI_METRICS.filter(m => metricIds.includes(m.id))
    : VAPI_METRICS;

  const sessionId = randomUUID();
  const base = webhookBaseUrl.replace(/\/$/, '');

  twilioCallStates.set(sessionId, {
    sessionId,
    callSid: '',
    scenario,
    openaiApiKey,
    accountSid,
    authToken,
    webhookBaseUrl: base,
    selectedMetrics,
    turns: [],
    conversationHistory: [
      { role: 'user', content: '[Call started. You are the customer. Respond only as the customer.]' },
    ],
    startTime: Date.now(),
    status: 'calling',
    currentTurn: 0,
    maxTurns: 10,
    silenceTimeout: typeof silenceTimeout === 'number' && silenceTimeout >= 1 && silenceTimeout <= 15 ? silenceTimeout : 3,
    sttMode: 'record',
    // When true, the agent-under-test greets first (inbound): Twilio records the
    // greeting, then the simulator says the seed. Default false here (the Voice
    // Sim Twilio tab opts in via its own toggle, unlike eval runs which read the
    // agent-level setting).
    mainAgentSpeaksFirst: mainAgentSpeaksFirst === true,
    // customerSimulatorModel left undefined → handler falls back to LLM_PROVIDER env default
  });

  const formData = new URLSearchParams();
  formData.append('To', toNumber);
  formData.append('From', fromNumber);
  formData.append('Url', `${base}/api/voice/twilio-voice-webhook/${sessionId}`);
  formData.append('Method', 'POST');
  // StatusCallback fires when the call ends — used to finalize evaluation
  // even if the conversation loop didn't catch the farewell phrase
  formData.append('StatusCallback', `${base}/api/voice/twilio-call-ended/${sessionId}`);
  formData.append('StatusCallbackMethod', 'POST');
  formData.append('StatusCallbackEvent', 'completed');
  // Record the full call so the user can download it after. We delete from
  // Twilio immediately after fetching the MP3 (~0 storage cost).
  formData.append('Record', 'true');
  formData.append('RecordingStatusCallback', `${base}/api/voice/twilio-recording-ready/${sessionId}`);
  formData.append('RecordingStatusCallbackEvent', 'completed');
  formData.append('RecordingStatusCallbackMethod', 'POST');

  try {
    const twilioRes = await twilioRequest(accountSid, authToken, '/Calls.json', 'POST', formData);
    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      twilioCallStates.delete(sessionId);
      return res.status(400).json({ error: `Twilio error: ${errText}` });
    }
    const callData = await twilioRes.json() as { sid: string };
    twilioCallStates.get(sessionId)!.callSid = callData.sid;
    markRecordingPending(sessionId, accountSid, authToken);
    return res.json({ sessionId, callSid: callData.sid });
  } catch (err) {
    twilioCallStates.delete(sessionId);
    return res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /twilio-voice-webhook/:sessionId ─────────────────────────────────────
// Called by Twilio when the call connects. Speaks the seed message and starts
// recording the agent's response.

router.post('/twilio-voice-webhook/:sessionId', (req: Request, res: Response) => {
  console.log(`[twilio-webhook] received for session ${req.params.sessionId}`);
  try {
    const state = twilioCallStates.get(req.params.sessionId);
    if (!state) {
      console.warn(`[twilio-webhook] unknown session: ${req.params.sessionId}`);
      res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
      return;
    }

    state.status = 'in-progress';

    const timeout = state.silenceTimeout ?? 2;

    // When the agent greets first (Vapi's vapiSpeaksFirst, or a plain voice
    // agent's main_agent_speaks_first), capture the agent's greeting before
    // saying the seed. The <Record> here captures the agent's opening message.
    // /twilio-first-agent-message will transcribe it, then say the seed and hand
    // off to the normal /twilio-recording loop.
    if (state.vapiSpeaksFirst || state.mainAgentSpeaksFirst) {
      // Use a short silence timeout (4s) so we detect the end of Vapi's greeting quickly
      // and return TwiML with our seed before Vapi's own silence timeout fires.
      // The full silenceTimeout (10s) is only appropriate for mid-conversation responses.
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Record maxLength="30" timeout="4" playBeep="false"
    action="${state.webhookBaseUrl}/api/voice/twilio-first-agent-message/${state.sessionId}"
    method="POST"/>
</Response>`;
      console.log(`[twilio-webhook] agent-speaks-first — recording agent greeting first for session ${state.sessionId}`);
      res.type('text/xml').send(twiml);
      return;
    }

    state.turns.push({ role: 'user', content: state.scenario.seed, timestamp_ms: 0 });

    const twiml = state.sttMode === 'gather'
      ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${escapeXml(state.scenario.seed)}</Say>
  <Gather input="speech" timeout="${timeout}" speechTimeout="auto" action="${state.webhookBaseUrl}/api/voice/twilio-gather/${state.sessionId}" method="POST"/>
</Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${escapeXml(state.scenario.seed)}</Say>
  <Record maxLength="60" timeout="${timeout}" playBeep="false"
    action="${state.webhookBaseUrl}/api/voice/twilio-recording/${state.sessionId}"
    method="POST"/>
</Response>`;

    console.log(`[twilio-webhook] responding with TwiML for session ${state.sessionId}`);
    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[twilio-webhook] error:', err);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }
});

// ── POST /twilio-first-agent-message/:sessionId ──────────────────────────────
// Used only when vapiSpeaksFirst=true. Captures the agent's opening greeting,
// transcribes it, adds it as the first agent turn, then says the seed utterance
// and starts the normal recording loop.

router.post('/twilio-first-agent-message/:sessionId', async (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  if (!state) {
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    return;
  }

  const hangupTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
  const recordingUrl = req.body.RecordingUrl as string | undefined;

  console.log(`[first-agent-message] session=${state.sessionId} url=${recordingUrl}`);

  try {
    // Try to transcribe the agent's greeting
    if (recordingUrl) {
      const audioRes = await fetch(`${recordingUrl}.mp3`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${state.accountSid}:${state.authToken}`).toString('base64')}`,
        },
      });

      if (audioRes.ok) {
        const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
        if (audioBuffer.length >= 200) {
          const { client: stt, model: sttModel } = getSttClient(state.openaiApiKey);
          const transcription = await stt.audio.transcriptions.create({
            file: await toFile(audioBuffer, 'recording.mp3', { type: 'audio/mpeg' }),
            model: sttModel,
          });
          const agentGreeting = transcription.text?.trim() || '';
          if (agentGreeting) {
            console.log(`[first-agent-message] agent greeting: "${agentGreeting}"`);
            state.turns.push({ role: 'agent', content: agentGreeting, timestamp_ms: Date.now() - state.startTime });
            // Add to conversation history so the simulator knows what the agent said first
            state.conversationHistory.push({ role: 'user', content: agentGreeting });
          }
        }
      }
    }

    // Now say the seed (customer's opening line) and start the normal loop
    state.turns.push({ role: 'user', content: state.scenario.seed, timestamp_ms: Date.now() - state.startTime });

    const timeout = state.silenceTimeout ?? 10;
    const twiml = state.sttMode === 'gather'
      ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(state.scenario.seed)}</Say>
  <Gather input="speech" timeout="${timeout}" speechTimeout="auto" action="${state.webhookBaseUrl}/api/voice/twilio-gather/${state.sessionId}" method="POST"/>
</Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(state.scenario.seed)}</Say>
  <Record maxLength="60" timeout="${timeout}" playBeep="false"
    action="${state.webhookBaseUrl}/api/voice/twilio-recording/${state.sessionId}"
    method="POST"/>
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[first-agent-message] error:', err);
    await finalizeVoiceEval(state);
    res.type('text/xml').send(hangupTwiml);
  }
});

// ── POST /twilio-recording/:sessionId ────────────────────────────────────────
// Called by Twilio when each recording completes. Transcribes the agent audio,
// generates the next customer reply, and returns TwiML to continue the loop.

router.post('/twilio-recording/:sessionId', async (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  if (!state) {
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    return;
  }

  const hangupTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

  // NOTE: Twilio's <Record> action callback does NOT send RecordingStatus.
  // That field only appears in the separate recordingStatusCallback.
  // We only need RecordingUrl to be present.
  const recordingUrl = req.body.RecordingUrl as string | undefined;

  console.log(`[twilio-recording] session=${req.params.sessionId} url=${recordingUrl} body=${JSON.stringify(req.body)}`);

  if (!recordingUrl) {
    console.warn('[twilio-recording] no RecordingUrl — finalizing');
    await finalizeVoiceEval(state);
    res.type('text/xml').send(hangupTwiml);
    return;
  }

  try {
    const tStart = Date.now();
    let dlMs = 0, sttMs = 0, llmMs = 0;

    // Download the MP3 recording from Twilio (requires auth)
    const dlStart = Date.now();
    const audioRes = await fetch(`${recordingUrl}.mp3`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${state.accountSid}:${state.authToken}`).toString('base64')}`,
      },
    });
    if (!audioRes.ok) throw new Error(`Could not download recording: ${audioRes.status}`);

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    dlMs = Date.now() - dlStart;
    if (audioBuffer.length < 200) {
      // Recording effectively empty — Twilio timed out with no speech from agent
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    // Transcribe (provider chosen via STT_PROVIDER env var; default openai/whisper-1)
    const { client: stt, model: sttModel, provider: sttProvider } = getSttClient(state.openaiApiKey);
    const sttStart = Date.now();
    const transcription = await stt.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'recording.mp3', { type: 'audio/mpeg' }),
      model: sttModel,
    });
    sttMs = Date.now() - sttStart;
    console.log(`[stt] provider=${sttProvider} model=${sttModel} latency=${sttMs}ms`);

    const agentText = transcription.text?.trim() || '';
    if (!agentText) {
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    state.turns.push({ role: 'agent', content: agentText, timestamp_ms: Date.now() - state.startTime });

    // Update conversation history (flipped roles: assistant=customer, user=agent)
    const lastCustomerTurn = state.turns.filter(t => t.role === 'user').slice(-1)[0];
    if (lastCustomerTurn) {
      state.conversationHistory.push({ role: 'assistant', content: lastCustomerTurn.content });
    }
    state.conversationHistory.push({ role: 'user', content: agentText });
    state.currentTurn++;

    // End conversation if agent said farewell (after at least 2 exchanges) or max turns reached.
    // Only use unambiguous closing phrases — "thanks for calling" / "thank you for calling" are
    // common agent OPENERS and must not be used as farewell signals.
    const endPhrases = ['goodbye', 'have a great day', 'have a great rest', 'have a wonderful day', 'have a good day'];
    const agentFarewell = state.currentTurn >= 3 && endPhrases.some(p => agentText.toLowerCase().includes(p));
    if (agentFarewell || state.currentTurn >= (state.maxTurns ?? 10)) {
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    // Generate next customer message
    const sim = resolveCustomerSimulator(state.customerSimulatorModel);
    const { client: llm, model: llmModel, provider: llmProvider } = getLlmClient({
      fallbackOpenAIKey: state.openaiApiKey,
      provider: sim.provider,
      model: sim.model,
    });
    const llmStart = Date.now();
    const simRes = await llm.chat.completions.create({
      model: llmModel,
      messages: [
        {
          role: 'system',
          content: `${state.scenario.customer_context}

VOICE CALL RULES:
- You ARE the customer on a phone call. Speak naturally, 1–2 short sentences.
- You are NOT the support agent. Never say "How can I help you?" or similar.
- If asked for email → give it immediately from YOUR IDENTITY above.
- If asked for name, company, or last 4 digits → give the exact value from YOUR IDENTITY above.
- Do NOT end the call yourself. Keep engaging until your issue is resolved.`,
        },
        ...state.conversationHistory,
      ],
      max_tokens: 80,
      temperature: 0.4,
    });
    llmMs = Date.now() - llmStart;
    console.log(`[llm] provider=${llmProvider} model=${llmModel} latency=${llmMs}ms`);

    const nextMsg = simRes.choices[0]?.message?.content?.trim() || '';
    if (!nextMsg) {
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    state.turns.push({ role: 'user', content: nextMsg, timestamp_ms: Date.now() - state.startTime });

    const recTimeout = state.silenceTimeout ?? 2;
    const twiml = state.sttMode === 'gather'
      ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(nextMsg)}</Say>
  <Gather input="speech" timeout="${recTimeout}" speechTimeout="auto" action="${state.webhookBaseUrl}/api/voice/twilio-gather/${state.sessionId}" method="POST"/>
</Response>`
      : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(nextMsg)}</Say>
  <Record maxLength="60" timeout="${recTimeout}" playBeep="false"
    action="${state.webhookBaseUrl}/api/voice/twilio-recording/${state.sessionId}"
    method="POST"/>
</Response>`;

    console.log(`[turn] session=${state.sessionId} dl=${dlMs}ms stt=${sttMs}ms llm=${llmMs}ms handler_total=${Date.now() - tStart}ms`);
    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[twilio-recording] error:', err);
    await finalizeVoiceEval(state);
    res.type('text/xml').send(hangupTwiml);
  }
});

// ── POST /twilio-gather/:sessionId ───────────────────────────────────────────
// Called by Twilio when <Gather input="speech"> completes (gather/STT mode).
// Twilio sends SpeechResult with the transcribed text directly — no Whisper needed.

router.post('/twilio-gather/:sessionId', async (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  if (!state) {
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    return;
  }

  const hangupTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
  const agentText = (req.body.SpeechResult as string | undefined)?.trim() || '';

  console.log(`[twilio-gather] session=${req.params.sessionId} SpeechResult="${agentText}"`);

  if (!agentText) {
    await finalizeVoiceEval(state);
    res.type('text/xml').send(hangupTwiml);
    return;
  }

  try {
    state.turns.push({ role: 'agent', content: agentText, timestamp_ms: Date.now() - state.startTime });

    const lastCustomerTurn = state.turns.filter(t => t.role === 'user').slice(-1)[0];
    if (lastCustomerTurn) {
      state.conversationHistory.push({ role: 'assistant', content: lastCustomerTurn.content });
    }
    state.conversationHistory.push({ role: 'user', content: agentText });
    state.currentTurn++;

    const endPhrases = ['goodbye', 'have a great day', 'have a great rest', 'have a wonderful day', 'have a good day'];
    const agentFarewell = state.currentTurn >= 3 && endPhrases.some(p => agentText.toLowerCase().includes(p));
    if (agentFarewell || state.currentTurn >= (state.maxTurns ?? 10)) {
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    // Generate next customer message
    const sim = resolveCustomerSimulator(state.customerSimulatorModel);
    const { client: llm, model: llmModel, provider: llmProvider } = getLlmClient({
      fallbackOpenAIKey: state.openaiApiKey,
      provider: sim.provider,
      model: sim.model,
    });
    const llmStart = Date.now();
    const simRes = await llm.chat.completions.create({
      model: llmModel,
      messages: [
        {
          role: 'system',
          content: `${state.scenario.customer_context}

VOICE CALL RULES:
- You ARE the customer on a phone call. Speak naturally, 1–2 short sentences.
- You are NOT the support agent. Never say "How can I help you?" or similar.
- Do NOT end the call yourself. Keep engaging until your issue is resolved.`,
        },
        ...state.conversationHistory,
      ],
      max_tokens: 80,
      temperature: 0.4,
    });
    console.log(`[llm] provider=${llmProvider} model=${llmModel} latency=${Date.now() - llmStart}ms`);

    const nextMsg = simRes.choices[0]?.message?.content?.trim() || '';
    if (!nextMsg) {
      await finalizeVoiceEval(state);
      res.type('text/xml').send(hangupTwiml);
      return;
    }

    state.turns.push({ role: 'user', content: nextMsg, timestamp_ms: Date.now() - state.startTime });

    const gatherTimeout = state.silenceTimeout ?? 2;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(nextMsg)}</Say>
  <Gather input="speech" timeout="${gatherTimeout}" speechTimeout="auto" action="${state.webhookBaseUrl}/api/voice/twilio-gather/${state.sessionId}" method="POST"/>
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[twilio-gather] error:', err);
    await finalizeVoiceEval(state);
    res.type('text/xml').send(hangupTwiml);
  }
});

// ── POST /twilio-call-ended/:sessionId ───────────────────────────────────────
// Twilio fires this StatusCallback when the call reaches a terminal state
// (completed, failed, busy, no-answer). This is the reliable signal to finalize
// the evaluation regardless of whether our recording loop caught the farewell.

router.post('/twilio-call-ended/:sessionId', async (req: Request, res: Response) => {
  const callStatus = req.body.CallStatus as string;
  console.log(`[twilio-call-ended] session=${req.params.sessionId} CallStatus=${callStatus}`);

  const state = twilioCallStates.get(req.params.sessionId);
  if (state) {
    await finalizeVoiceEval(state);
  }
  res.status(204).send();
});

// ── GET /call-status/:sessionId ───────────────────────────────────────────────
// Frontend polls this to check progress and retrieve results.

router.get('/call-status/:sessionId', (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  if (!state) return res.status(404).json({ error: 'Session not found' });

  const rec = recordingMeta.get(req.params.sessionId);
  res.json({
    status: state.status,
    callSid: state.callSid,
    turnCount: state.turns.length,
    turns: state.turns,                              // live transcript stream
    result: state.result ?? null,
    error: state.error ?? null,
    recording: rec ? {
      status: rec.status,
      downloadUrl: rec.status === 'ready' ? `/api/voice/recording/${req.params.sessionId}` : null,
      error: rec.error ?? null,
    } : null,
  });
});

// ── POST /cancel/:sessionId ──────────────────────────────────────────────────
// Terminate an in-flight Twilio call mid-conversation. Twilio will then fire
// its normal /twilio-call-ended callback which finalizes scoring + recording.
router.post('/cancel/:sessionId', async (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  if (!state.callSid) return res.status(400).json({ error: 'Call has not been placed yet' });

  const formData = new URLSearchParams();
  formData.append('Status', 'completed');

  try {
    const result = await twilioRequest(
      state.accountSid, state.authToken,
      `/Calls/${state.callSid}.json`, 'POST', formData,
    );
    if (!result.ok) {
      const errText = await result.text();
      return res.status(400).json({ error: `Twilio error: ${errText}` });
    }
    console.log(`[cancel] terminated callSid=${state.callSid} for session=${req.params.sessionId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /twilio-recording-ready/:sessionId ───────────────────────────────────
// Twilio fires this after Record=true call completes and the recording is ready.
// We download the MP3, save locally for 30 minutes, then DELETE from Twilio so
// no ongoing storage cost is incurred.

router.post('/twilio-recording-ready/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  // Always 204 to Twilio quickly so it doesn't retry — do work async.
  res.status(204).send();

  const recordingUrl = req.body.RecordingUrl as string | undefined;
  const recordingSid = req.body.RecordingSid as string | undefined;
  const recordingStatus = req.body.RecordingStatus as string | undefined;

  console.log(`[recording-ready] session=${sessionId} sid=${recordingSid} status=${recordingStatus} url=${recordingUrl}`);

  if (!recordingUrl || !recordingSid || recordingStatus !== 'completed') {
    recordingMeta.set(sessionId, {
      ...(recordingMeta.get(sessionId) ?? { pendingSince: Date.now() }),
      status: 'error',
      error: `Twilio reported status=${recordingStatus}`,
      readyAt: Date.now(),
    });
    return;
  }

  // Prefer creds stored on recordingMeta (set at call-init time) since
  // session state may have been cleaned up by the eval-run flow already.
  const meta = recordingMeta.get(sessionId);
  const state = twilioCallStates.get(sessionId);
  const accountSid = meta?.accountSid ?? state?.accountSid;
  const authToken = meta?.authToken ?? state?.authToken;

  if (!accountSid || !authToken) {
    console.warn(`[recording-ready] no credentials for session ${sessionId} — cannot fetch`);
    recordingMeta.set(sessionId, {
      ...(meta ?? { pendingSince: Date.now() }),
      status: 'error',
      error: 'Credentials no longer available for fetching recording',
      readyAt: Date.now(),
    });
    return;
  }

  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  try {
    const audioRes = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: auth } });
    if (!audioRes.ok) throw new Error(`fetch failed: ${audioRes.status}`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch { /* ignore */ }
    const filePath = path.join(RECORDINGS_DIR, `${sessionId}.mp3`);
    fs.writeFileSync(filePath, audioBuffer);

    recordingMeta.set(sessionId, {
      ...(recordingMeta.get(sessionId) ?? { pendingSince: Date.now(), accountSid, authToken }),
      status: 'ready',
      filePath,
      readyAt: Date.now(),
    });
    console.log(`[recording-ready] saved ${audioBuffer.length} bytes to ${filePath}`);

    // Delete from Twilio so storage cost stays at ~0.
    try {
      const delRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.json`,
        { method: 'DELETE', headers: { Authorization: auth } },
      );
      if (!delRes.ok) {
        console.warn(`[recording-ready] twilio delete returned ${delRes.status} (recording kept on Twilio)`);
      } else {
        console.log(`[recording-ready] deleted recording ${recordingSid} from Twilio`);
      }
    } catch (delErr) {
      console.warn(`[recording-ready] twilio delete failed: ${(delErr as Error).message}`);
    }
  } catch (err) {
    console.error(`[recording-ready] failed for session=${sessionId}:`, err);
    recordingMeta.set(sessionId, {
      ...(recordingMeta.get(sessionId) ?? { pendingSince: Date.now() }),
      status: 'error',
      error: (err as Error).message,
      readyAt: Date.now(),
    });
  }
});

// ── GET /recording/:sessionId ─────────────────────────────────────────────────
// Streams the locally-saved call recording. Returns 404 if not ready or expired.

router.get('/recording/:sessionId', (req: Request, res: Response) => {
  const meta = recordingMeta.get(req.params.sessionId);
  if (!meta) return res.status(404).json({ error: 'Recording not found or expired' });
  if (meta.status === 'pending') return res.status(202).json({ error: 'Recording still processing' });
  if (meta.status === 'error') return res.status(500).json({ error: meta.error || 'Recording failed' });
  if (!meta.filePath || !fs.existsSync(meta.filePath)) {
    return res.status(404).json({ error: 'Recording file no longer available' });
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="call-${req.params.sessionId}.mp3"`);
  fs.createReadStream(meta.filePath).pipe(res);
});

// ── DELETE /recording/:sessionId ──────────────────────────────────────────────
// Manually delete a saved recording (e.g., after the user has downloaded it).
// Idempotent — returns 200 even if the recording was already gone.

router.delete('/recording/:sessionId', (req: Request, res: Response) => {
  const meta = recordingMeta.get(req.params.sessionId);
  if (meta?.filePath && fs.existsSync(meta.filePath)) {
    try { fs.unlinkSync(meta.filePath); } catch (err) {
      console.warn(`[recording-delete] unlink failed for ${meta.filePath}:`, (err as Error).message);
    }
  }
  recordingMeta.delete(req.params.sessionId);
  res.json({ ok: true });
});

// ── POST /evaluate-vapi ──────────────────────────────────────────────────────
// Initiates a Twilio outbound call to a Vapi-hosted phone number.
// Reads Twilio credentials from Settings (same as evalRuns).
// Stores vapiApiKey + vapiAssistantId in session state so the frontend can
// later fetch the Vapi trace via GET /vapi-trace/:sessionId.

router.post('/evaluate-vapi', async (req: Request, res: Response) => {
  const {
    vapiApiKey, vapiAssistantId, toNumber, scenarioId, metricIds,
    customPersona, customScenario, vapiSpeaksFirst, silenceTimeout,
  } = req.body;

  if (!vapiApiKey || !vapiAssistantId || !toNumber || !scenarioId) {
    return res.status(400).json({
      error: 'vapiApiKey, vapiAssistantId, toNumber, and scenarioId are required',
    });
  }

  // Read Twilio credentials from settings DB
  const getSetting = (key: string) => {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  };
  const accountSid = getSetting('twilio_account_sid');
  const authToken = getSetting('twilio_auth_token');
  const fromNumber = getSetting('twilio_from_number');
  const webhookBaseUrl = getSetting('twilio_webhook_url');

  if (!accountSid || !authToken || !fromNumber || !webhookBaseUrl) {
    return res.status(400).json({ error: 'Twilio credentials not configured. Go to Settings → Voice Simulation.' });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured on the server' });

  // Build scenario
  let scenario: typeof VAPI_SCENARIOS[0];
  if (scenarioId === 'custom') {
    if (!customPersona?.name || !customScenario?.reason || !customScenario?.opening_line) {
      return res.status(400).json({ error: 'Custom scenario requires name, reason, and opening_line' });
    }
    const customerContext = `You are PLAYING THE ROLE OF A CUSTOMER on a support call. You are NOT the support agent.

YOUR IDENTITY (provide naturally when asked):
- Name: ${customPersona.name}${customPersona.age ? `\n- Age: ${customPersona.age}` : ''}${customPersona.policy_number ? `\n- Policy / Account Number: ${customPersona.policy_number}` : ''}${customPersona.dob ? `\n- Date of Birth: ${customPersona.dob}` : ''}${customPersona.otp ? `\n- OTP / PIN: ${customPersona.otp}` : ''}
- Emotional State: ${customPersona.emotional_state || 'neutral'}

YOUR SITUATION:
- Reason for calling: ${customScenario.reason}${customScenario.details ? `\n- Key details: ${customScenario.details}` : ''}${customScenario.goal ? `\n- Your goal: ${customScenario.goal}` : ''}

CONVERSATION RULES:
- Respond ONLY as the customer. Never say anything a support agent would say.
- When asked for your name, policy/account number, DOB, or OTP — give the exact values from YOUR IDENTITY above.
- Stay in character as a ${customPersona.emotional_state || 'neutral'} customer throughout the call.
- Keep each reply to 1–3 short sentences.
- Do NOT end the call yourself until your issue is fully resolved or you are explicitly dismissed.`;

    scenario = {
      id: 'custom',
      name: customScenario.reason,
      description: customScenario.details || customScenario.reason,
      seed: customScenario.opening_line,
      customer_context: customerContext,
    };
  } else {
    const found = VAPI_SCENARIOS.find(s => s.id === scenarioId);
    if (!found) return res.status(404).json({ error: 'Scenario not found' });
    scenario = found;
  }

  const selectedMetrics = metricIds?.length
    ? VAPI_METRICS.filter(m => metricIds.includes(m.id))
    : VAPI_METRICS;

  const sessionId = randomUUID();
  const base = webhookBaseUrl.replace(/\/$/, '');
  const callInitiatedAt = Date.now();

  twilioCallStates.set(sessionId, {
    sessionId,
    callSid: '',
    scenario,
    openaiApiKey,
    accountSid,
    authToken,
    webhookBaseUrl: base,
    selectedMetrics,
    turns: [],
    conversationHistory: [
      { role: 'user', content: '[Call started. You are the customer. Respond only as the customer.]' },
    ],
    startTime: Date.now(),
    status: 'calling',
    currentTurn: 0,
    maxTurns: 10,
    silenceTimeout: typeof silenceTimeout === 'number' && silenceTimeout >= 1 && silenceTimeout <= 15 ? silenceTimeout : 10,
    sttMode: 'gather',
    // customerSimulatorModel left undefined → handler falls back to LLM_PROVIDER env default
    vapiApiKey,
    vapiAssistantId,
    callInitiatedAt,
    vapiSpeaksFirst: !!vapiSpeaksFirst,
  });

  const formData = new URLSearchParams();
  formData.append('To', toNumber);
  formData.append('From', fromNumber);
  formData.append('Url', `${base}/api/voice/twilio-voice-webhook/${sessionId}`);
  formData.append('Method', 'POST');
  formData.append('StatusCallback', `${base}/api/voice/twilio-call-ended/${sessionId}`);
  formData.append('StatusCallbackMethod', 'POST');
  formData.append('StatusCallbackEvent', 'completed');
  // Record the full call so the user can download it after.
  formData.append('Record', 'true');
  formData.append('RecordingStatusCallback', `${base}/api/voice/twilio-recording-ready/${sessionId}`);
  formData.append('RecordingStatusCallbackEvent', 'completed');
  formData.append('RecordingStatusCallbackMethod', 'POST');

  try {
    const twilioRes = await twilioRequest(accountSid, authToken, '/Calls.json', 'POST', formData);
    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      twilioCallStates.delete(sessionId);
      return res.status(400).json({ error: `Twilio error: ${errText}` });
    }
    const callData = await twilioRes.json() as { sid: string };
    twilioCallStates.get(sessionId)!.callSid = callData.sid;
    markRecordingPending(sessionId, accountSid, authToken);
    return res.json({ sessionId, callSid: callData.sid });
  } catch (err) {
    twilioCallStates.delete(sessionId);
    return res.status(500).json({ error: (err as Error).message });
  }
});

// vapiTraceCache is imported from voiceEval.ts (shared with runVapiTrialForEvalRun)

function parseVapiMessages(messages: VapiMessage[]) {
  // Vapi uses different role names in webhooks ('bot', 'tool_calls') vs API records ('assistant', 'tool_call')
  const toolCallMessages = messages.filter(m =>
    (m.role === 'tool_calls' || m.role === 'tool_call') &&
    (m.toolCallList?.length || m.toolCalls?.length)
  );

  const toolCalls = toolCallMessages.flatMap(m => {
    const list = m.toolCallList || m.toolCalls || [];
    return list.map(tc => {
      const resultMsg = messages.find(r =>
        (r.role === 'tool_call_result' || r.role === 'tool_result') && r.toolCallId === tc.id
      );
      let parsedArgs: unknown = {};
      let parsedResult: unknown = null;
      try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch { parsedArgs = tc.function.arguments; }
      try { parsedResult = JSON.parse(resultMsg?.result || 'null'); } catch { parsedResult = resultMsg?.result ?? null; }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
        result: parsedResult,
        timestamp_ms: (m.time ?? m.secondsFromStart ?? 0) * (m.time && m.time > 1000 ? 1 : 1000),
        status: resultMsg ? 'success' : 'pending',
      };
    });
  });

  // Accept both 'bot' (webhook) and 'assistant' (API) as the agent role
  const vapiTranscript = messages
    .filter(m => m.role === 'bot' || m.role === 'assistant' || m.role === 'user')
    .map(m => ({
      role: (m.role === 'bot' || m.role === 'assistant') ? 'bot' : 'user' as 'bot' | 'user',
      content: m.message || m.content || '',
      timestamp_ms: (m.time ?? m.secondsFromStart ?? 0) * (m.time && m.time > 1000 ? 1 : 1000),
    }))
    .filter(m => m.content.trim().length > 0);

  console.log(`[parseVapiMessages] total=${messages.length} transcript=${vapiTranscript.length} toolCalls=${toolCalls.length}`);
  if (messages.length > 0) {
    console.log(`[parseVapiMessages] roles seen: ${[...new Set(messages.map(m => m.role))].join(', ')}`);
  }

  return { toolCalls, vapiTranscript };
}

// ── POST /vapi-webhook ────────────────────────────────────────────────────────
// Configure this URL as the serverUrl on your Vapi phone number in Vapi settings.
// Receives status-update and end-of-call-report events.
//
// status-update (in-progress): captures Vapi's call ID so we can match it to a session.
// end-of-call-report: stores the full trace — transcript, tool calls, cost breakdown.

router.get('/vapi-webhook', (_req: Request, res: Response) => {
  res.json({ ok: true, endpoint: 'vapi-webhook', timestamp: new Date().toISOString() });
});

router.post('/vapi-webhook', async (req: Request, res: Response) => {
  // Always dump raw body so we can see exactly what Vapi sends
  console.log('[vapi-webhook] raw body:', JSON.stringify(req.body));

  // Vapi wraps events in a `message` field, but handle both wrapped and unwrapped
  const raw = req.body as Record<string, unknown>;
  const message = (raw.message ?? raw) as { type?: string; status?: string; endedReason?: string; call?: VapiCallRecord; artifact?: { transcript?: string; messages?: VapiMessage[]; recordingUrl?: string } };
  const { type, call, artifact } = message;

  if (!type) {
    console.warn('[vapi-webhook] no type field — ignoring');
    return res.status(200).send('ok');
  }

  const callId = call?.id;
  console.log(`[vapi-webhook] type=${type} callId=${callId}`);

  // ── status-update: capture Vapi call ID into the matching session ──
  if (type === 'status-update' && message.status === 'in-progress' && callId) {
    const callCreatedAt = call?.createdAt ? new Date(call.createdAt).getTime() : Date.now();
    let bestSession: TwilioCallState | null = null;
    let bestDelta = Infinity;

    for (const state of twilioCallStates.values()) {
      if (!state.vapiAssistantId || state.vapiCallId) continue; // skip non-vapi or already matched
      const delta = Math.abs((state.callInitiatedAt ?? 0) - callCreatedAt);
      if (delta < 120_000 && delta < bestDelta) {
        bestDelta = delta;
        bestSession = state;
      }
    }

    if (bestSession) {
      bestSession.vapiCallId = callId;
      console.log(`[vapi-webhook] matched callId=${callId} to session=${bestSession.sessionId} (delta=${bestDelta}ms)`);
    } else {
      console.warn(`[vapi-webhook] no active Vapi session matched callId=${callId}`);
    }
  }

  // ── end-of-call-report: store full trace ──
  if (type === 'end-of-call-report' && callId) {
    const messages: VapiMessage[] = artifact?.messages || call?.messages || [];
    const { toolCalls, vapiTranscript } = parseVapiMessages(messages);

    const traceData: Record<string, unknown> = {
      callId,
      status: call?.status,
      endedReason: message.endedReason || call?.endedReason,
      startedAt: call?.startedAt,
      endedAt: call?.endedAt,
      transcript: artifact?.transcript || call?.transcript || call?.artifact?.transcript,
      vapiTranscript,
      toolCalls,
      costBreakdown: call?.costBreakdown,
      recordingUrl: artifact?.recordingUrl || call?.artifact?.recordingUrl,
    };

    vapiTraceCache.set(callId, traceData);

    // Also store directly on the matched session for instant retrieval
    for (const state of twilioCallStates.values()) {
      if (state.vapiCallId === callId) {
        state.vapiTraceData = traceData;
        console.log(`[vapi-webhook] stored end-of-call-report trace for session=${state.sessionId}`);
        break;
      }
    }
  }

  res.status(200).send('ok');
});

// ── GET /vapi-trace/:sessionId ────────────────────────────────────────────────
// Returns the Vapi agent trace for a completed eval session.
// Priority: (1) webhook-received trace on session, (2) vapiTraceCache by call ID,
// (3) fall back to polling the Vapi API (used when webhook is not configured).

router.get('/vapi-trace/:sessionId', async (req: Request, res: Response) => {
  const state = twilioCallStates.get(req.params.sessionId);
  console.log(`[vapi-trace] sessionId=${req.params.sessionId} stateExists=${!!state} vapiApiKey=${!!state?.vapiApiKey} vapiAssistantId=${!!state?.vapiAssistantId} vapiCallId=${state?.vapiCallId} hasTraceData=${!!state?.vapiTraceData}`);

  if (!state) {
    return res.status(404).json({ error: 'Session not found — it may have expired. Please start a new evaluation.' });
  }
  if (!state.vapiApiKey) {
    return res.status(404).json({ error: 'Session is not a Vapi evaluation (no vapiApiKey)' });
  }

  // ── Fast path: webhook already delivered the trace ──
  if (state.vapiTraceData) {
    console.log(`[vapi-trace] returning webhook-received trace for session=${req.params.sessionId}`);
    return res.json(state.vapiTraceData);
  }
  if (state.vapiCallId && vapiTraceCache.has(state.vapiCallId)) {
    console.log(`[vapi-trace] returning cached trace for callId=${state.vapiCallId}`);
    return res.json(vapiTraceCache.get(state.vapiCallId));
  }

  const { vapiApiKey, callInitiatedAt = 0 } = state;

  try {
    // If we captured the Vapi call ID via a status-update webhook, fetch it directly.
    // This is the most reliable path — no timestamp correlation needed.
    if (state.vapiCallId) {
      console.log(`[vapi-trace] fetching by callId=${state.vapiCallId} (from status-update webhook)`);
      const directRes = await fetch(`https://api.vapi.ai/call/${state.vapiCallId}`, {
        headers: { Authorization: `Bearer ${vapiApiKey}` },
      });
      if (directRes.ok) {
        const call = await directRes.json() as VapiCallRecord;
        const messages: VapiMessage[] = call.messages || call.artifact?.messages || [];
        const { toolCalls, vapiTranscript } = parseVapiMessages(messages);
        return res.json({
          callId: call.id, status: call.status, endedReason: call.endedReason,
          startedAt: call.startedAt, endedAt: call.endedAt,
          transcript: call.transcript || call.artifact?.transcript,
          vapiTranscript, toolCalls, costBreakdown: call.costBreakdown,
          recordingUrl: call.artifact?.recordingUrl,
        });
      }
    }

    // Fallback: list recent calls by time window only (no assistantId filter —
    // inbound calls to a Vapi phone number are not indexed by assistantId).
    // Use createdAtGt/createdAtLt (exclusive) — the correct Vapi API param names.
    const since = new Date(callInitiatedAt - 120_000).toISOString();
    const until = new Date(callInitiatedAt + 600_000).toISOString();

    const listUrl = `https://api.vapi.ai/call?limit=20&createdAtGt=${encodeURIComponent(since)}&createdAtLt=${encodeURIComponent(until)}`;
    console.log(`[vapi-trace] listing calls: ${listUrl}`);

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${vapiApiKey}` } });

    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error(`[vapi-trace] list API error ${listRes.status}: ${errText}`);
      return res.status(400).json({ error: `Vapi API error (${listRes.status}): ${errText}` });
    }

    const listData = await listRes.json() as VapiCallRecord[] | { data?: VapiCallRecord[] };
    const calls: VapiCallRecord[] = Array.isArray(listData) ? listData : (listData.data ?? []);
    console.log(`[vapi-trace] found ${calls.length} calls in time window`);

    if (calls.length === 0) {
      return res.status(404).json({
        error: 'No Vapi call found in the time window. To get reliable traces, set the webhook URL in Vapi → Phone Numbers → Server URL.',
      });
    }

    // Pick the call closest in time to when we initiated
    const matching = calls.reduce((best, c) => {
      const dt = Math.abs(new Date(c.createdAt).getTime() - callInitiatedAt);
      const bestDt = Math.abs(new Date(best.createdAt).getTime() - callInitiatedAt);
      return dt < bestDt ? c : best;
    });

    console.log(`[vapi-trace] matched callId=${matching.id} createdAt=${matching.createdAt}`);

    // Fetch full call details (the list endpoint may omit messages/transcript)
    const detailRes = await fetch(`https://api.vapi.ai/call/${matching.id}`, {
      headers: { Authorization: `Bearer ${vapiApiKey}` },
    });

    if (!detailRes.ok) {
      const errText = await detailRes.text();
      return res.status(400).json({ error: `Vapi API error fetching call detail: ${errText}` });
    }

    const call = await detailRes.json() as VapiCallRecord;
    const messages: VapiMessage[] = call.messages || [];
    const { toolCalls, vapiTranscript } = parseVapiMessages(messages);
    console.log(`[vapi-trace] returning API-fetched trace, messages=${messages.length} transcript=${(call.transcript || '').length} chars`);

    return res.json({
      callId: call.id,
      status: call.status,
      endedReason: call.endedReason,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      transcript: call.transcript || call.artifact?.transcript,
      vapiTranscript,
      toolCalls,
      costBreakdown: call.costBreakdown,
      recordingUrl: call.artifact?.recordingUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch Vapi trace: ${(err as Error).message}` });
  }
});

export default router;
