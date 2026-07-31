/**
 * Shared voice scenario + metric definitions for the LiveKit eval tab.
 *
 * These mirror the VAPI_SCENARIOS / VAPI_METRICS constants in routes/voice.ts.
 * They are duplicated here (rather than imported) to keep the LiveKit feature
 * fully isolated — routes/voice.ts is intentionally left untouched. If these
 * preset scenarios ever change in voice.ts, update this copy to match.
 *
 * The frontend LiveKit tab uses the SAME scenario/metric IDs (it loads them from
 * GET /api/voice/scenarios and /api/voice/metrics), so the IDs here must stay in
 * sync with voice.ts.
 */

export interface VoiceScenario {
  id: string;
  name: string;
  description: string;
  seed: string;
  customer_context: string;
}

export interface VoiceMetric {
  id: string;
  name: string;
  description: string;
}

export const VOICE_SCENARIOS: VoiceScenario[] = [
  {
    id: 'voice-s1',
    name: 'Account Login Issue',
    description: 'User cannot log in to the SaaS product after a password reset.',
    seed: "Hi, I'm unable to log in to my account. I've already tried resetting my password but it's still not working.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS product support line. You are NOT the support agent — you are the customer who needs help.

YOUR IDENTITY (provide naturally when asked):
- Name: Sarah Mitchell
- Work email: sarah.mitchell@brightwave.io
- Company: Brightwave Inc.
- Contract ID last 4 digits: 7743

YOUR SITUATION:
You have been unable to log in since this morning. You reset your password but it still shows "Invalid credentials." You need access urgently for a 2pm client presentation.

CONVERSATION RULES:
- Respond ONLY as the customer. Never respond as the agent.
- Keep each reply to 1–3 short sentences.
- Do NOT end the call yourself until your issue is resolved.`,
  },
  {
    id: 'voice-s2',
    name: 'Policy Cancellation — Undisclosed Charges',
    description: 'Frustrated customer wants to cancel Safeguard Insurance policy due to undisclosed charges. Stays only if offered ≥15% discount unprompted.',
    seed: "Hi, I'm calling because I want to cancel my Safeguard Insurance policy. I've been charged fees that nobody told me about when I signed up, and I'm not happy about it.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling Safeguard Insurance to cancel your policy. You are NOT the support agent.

YOUR IDENTITY (provide naturally when asked):
- Name: James Hartley
- Date of Birth: 12 March 1985
- Policy Number: SFG-2291-7743
- Monthly Premium: $148/month

YOUR SITUATION:
You were not told about a $25/month admin fee and a $15/month surcharge at signup. You feel misled and want to cancel.

RETENTION RULE — CRITICAL:
- You stay ONLY if the agent proactively offers ≥15% off without you asking.
- If offered ≥15% unprompted: accept and stay. Otherwise: proceed with cancellation.
- Do NOT hint that a discount would change your mind.

CONVERSATION RULES:
- Respond ONLY as the customer. Keep replies to 1–3 short sentences.
- Do NOT end the call until the outcome is clear.`,
  },
  {
    id: 'voice-s3',
    name: 'Feature Not Working',
    description: 'Customer reports that the data export feature is broken and blocking their workflow.',
    seed: "The data export feature in your product has stopped working for us. Every time I try to export, it just spins and then times out. This is blocking our end-of-month reporting.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS support line about a broken feature. You are NOT the support agent.

YOUR IDENTITY (provide naturally when asked):
- Name: Priya Anand
- Work email: priya.anand@nexusmedia.co
- Company: Nexus Media Co.
- Contract ID last 4 digits: 6612

YOUR SITUATION:
CSV export has been broken for 2 days — it spins ~90 seconds then fails. Your end-of-month report is due tomorrow. You need it escalated as high priority.

CONVERSATION RULES:
- Respond ONLY as the customer. Keep replies to 1–3 short sentences.
- Emphasize the business impact. Do NOT say anything an agent would say.`,
  },
  {
    id: 'voice-s4',
    name: 'Plan Upgrade Inquiry',
    description: 'Customer wants to understand what is included in the Business plan before upgrading.',
    seed: "Hi, we're currently on the Professional plan and we're considering upgrading to Business. I just want to make sure I understand what we'd be getting before I commit.",
    customer_context: `You are PLAYING THE ROLE OF A CUSTOMER calling a SaaS support line about a plan upgrade. You are NOT the support agent.

YOUR IDENTITY (provide naturally when asked):
- Name: Jordan Lee
- Work email: jordan.lee@stratapulse.com
- Company: StrataPulse
- Current plan: Professional ($299/month), team of 22 users

YOUR SITUATION:
You're hitting the seat limit on Professional and want to know Business seat limits, feature differences, price difference, and any annual discount. Ready to upgrade today if value is clear.

CONVERSATION RULES:
- Respond ONLY as the customer. Ask specific questions about seats, features, and pricing.
- Keep replies to 1–3 short sentences. Do NOT say anything an agent would say.`,
  },
];

export const VOICE_METRICS: VoiceMetric[] = [
  { id: 'voice-m1', name: 'Goal Completion', description: 'Did the agent successfully help the customer achieve their stated goal or resolve their issue?' },
  { id: 'voice-m2', name: 'Response Quality', description: 'Were the agent responses accurate, relevant, helpful, and professional throughout the conversation?' },
  { id: 'voice-m3', name: 'Conversation Flow', description: 'Was the conversation natural, coherent, and well-structured? Did the agent maintain context across turns?' },
  { id: 'voice-m4', name: 'Resolution Rate', description: 'Was the customer issue fully resolved by the end of the conversation without unnecessary escalation?' },
];
