# Voice AI Evaluation Suite

A locally-hosted, full-stack web app for evaluating AI conversational agents — author scenarios, run multi-trial evaluations, score them, inspect transcripts/tool calls, compare versions, and run voice-agent evaluations over **Twilio** or **LiveKit** (with live transcription and call recording).

## Product capabilities

The suite provides an end-to-end evaluation workflow for conversational AI teams moving agents from prototype to production:

- **Scenario and persona design:** Define test cases with seed utterances, customer goals, tone, frustration level, tags, and explicit success criteria. Expected outcomes can be expressed as natural-language requirements, required tool calls, or KPI thresholds.
- **Repeatable experimentation:** Run multiple trials per scenario with configurable turn limits and pass thresholds. This makes non-deterministic agent behavior measurable instead of relying on one-off demos.
- **LLM-assisted evaluation:** Use model-based judges to score conversation outcomes, return evidence-backed rationales, and break compound requirements into individually scored components. OpenAI and Anthropic are supported for evaluation, with a deterministic mock fallback for local development.
- **Quality, performance, and cost metrics:** Track pass/fail results alongside time to first token, average and end-to-end latency, token usage, model-call count, estimated cost, and conversational talk ratio.
- **Trace-level observability:** Inspect complete transcripts and the associated tool and knowledge-base activity, including arguments, responses, retrieved chunks, status, and latency. This helps teams distinguish prompt failures from orchestration, retrieval, or integration failures.
- **Agent version comparison:** Compare evaluation runs across agent and prompt versions to identify regressions, quantify improvements, and support evidence-based release decisions.
- **Human-in-the-loop quality governance:** Add annotations, assign reviews, collect human ratings, and analyze evaluator disagreement, false positives, false negatives, and inter-rater agreement.
- **Voice AI testing:** Execute phone-based evaluations through Twilio or LiveKit with streaming speech-to-text, configurable text-to-speech, call recordings, and voice-specific latency signals.
- **Flexible test inputs:** Author scenarios manually, generate them with AI, bulk-import test cases, or upload PDF and DOCX conversations for evaluation.

## Product tour

### Evaluation dashboard

Monitor aggregate quality, pass rate, time to first token, latency percentiles, and recent evaluation runs from a single release-readiness view.

![Voice AI Evaluation Suite dashboard showing KPI, pass-rate, and latency metrics](Screenshots/Dashboard%20-%20Eval%20Suite.png)

### Metrics library

Define and manage reusable conversation-level and turn-level metrics that can be applied consistently across evaluation runs.

![Metrics library showing reusable conversational AI evaluation criteria](Screenshots/Metrics%20-%20Eval%20Suite.png)

### Product and technical design

The application reflects several concerns central to shipping enterprise AI products:

- Evaluation datasets are modeled as reusable agents, personas, scenarios, metrics, runs, and trial-level traces in SQLite through Drizzle ORM.
- The evaluation loop separates customer simulation, agent execution, scoring, and analysis so each layer can be configured and diagnosed independently.
- Multi-trial runs provide a foundation for measuring reliability and defining release gates rather than treating a single successful response as sufficient evidence.
- Provider integrations are modular: OpenAI and Groq power simulation, OpenAI or Anthropic can judge results, Deepgram supports transcription, and Twilio or LiveKit provide voice transport.
- Credentials and evaluation data remain local by default, supporting rapid prototyping while reducing the risk of committing sensitive configuration.

- **Frontend:** React + TypeScript + Vite + Tailwind → http://localhost:3000
- **Backend:** Node + Express + TypeScript + SQLite (Drizzle) → http://localhost:3001

> Everything runs locally. Copy `.env.example` to `.env` and provide your own API keys for the integrations you use.

---

## Prerequisites

- **Node.js 18+** and **npm** (developed on Node 18–24; any 18+ works)
- **git**
- **ngrok** — only if you'll test **Twilio** voice calls (needed for the public webhook). Not required for chat or LiveKit.

---

## Quick start

```bash
# 1. Clone
git clone git@github.com:ashishpcmu/voice-ai-evals-app.git
cd voice-ai-evals-app

# 2. Create your local environment file, then add your own API keys
cp .env.example .env

# 3. Install everything (root install covers both frontend and backend workspaces)
npm install

# 4. Run both servers
npm run dev
```

Then open **http://localhost:3000**. The backend runs on **http://localhost:3001** (health check: `/api/health`).

On first run the SQLite database is created and seeded automatically — you'll see sample agents, scenarios, and a completed run immediately.

---

## Staying up to date

When new changes are pushed:

```bash
git pull
npm install     # only needed if dependencies changed
npm run dev
```

Your local `.env` and your local database are **not** tracked by git, so pulling won't overwrite them.

---

## Environment / API keys

- **`.env.example`** documents the supported settings without containing credentials. Copy it to `.env`, then add keys only for the integrations you plan to use.
- Your local **`.env` is gitignored** and must never be committed. Keep all API keys and cloud credentials there.

---

## Voice features (Twilio & LiveKit)

OpenAI, Groq, Deepgram, and AWS keys in `.env` enable scoring, simulation, transcription, and optional LiveKit recording. **Telephony credentials are entered in the app UI, not in `.env`:**

1. Open the app → **Settings → Voice Simulation**.
2. Enter your **Twilio** credentials (Account SID, Auth Token, From Number, Webhook URL) and **LiveKit** credentials (URL, API Key, API Secret, SIP Trunk ID). These values are not stored in the repository.
   - These are saved in your **local** database, so you only do this once per machine.

### Twilio calls also need a public webhook (per person)

Twilio must reach your local backend, so run a tunnel and point Twilio at it:

```bash
ngrok http 3001
```

Copy the `https://…ngrok-free.dev` URL ngrok prints, then paste it into the **Twilio Webhook URL** field in **Settings → Voice Simulation**. (The free ngrok URL changes each restart — update it when it changes.)

### LiveKit notes

- LiveKit eval/voice-sim flows dial out via **LiveKit Cloud + a Twilio SIP trunk** and stream STT/TTS.
- **Call recording** uses LiveKit Egress → S3 and consumes **egress minutes** on the LiveKit plan. If you see `egress minutes exceeded`, the call still runs and is scored — only the recording is skipped. Set `LIVEKIT_RECORDING=false` in `.env` to skip recording entirely.

---

## Useful scripts

```bash
npm run dev        # start frontend + backend together
npm run build      # build both for production
npm run typecheck  # type-check both workspaces
```

---

## Project layout

```
voice-ai-evals-app/
├── frontend/     # React app (Vite) — pages, components, API client
├── backend/      # Express API — routes, services (simulator, scorer, voice, livekit), SQLite/Drizzle
├── .env.example  # credential-free configuration template — copy to .env
├── CLAUDE.md     # full product/build spec
└── README.md
```

---

## Troubleshooting

- **"An application error has occurred" when a Twilio call connects** → your ngrok tunnel isn't running, or the Twilio Webhook URL in Settings is stale. Start `ngrok http 3001` and update the URL.
- **Recording link unavailable / "egress minutes exceeded"** → LiveKit egress quota is used up; the call/scoring still work. Top up the LiveKit plan or set `LIVEKIT_RECORDING=false`.
- **Port already in use** → something else is on 3000/3001; stop it or change `PORT` in `.env` (and the Vite proxy if you change the backend port).
- **Fresh start** → stop the app and delete the local DB file (`bais-eval.db`); it will be recreated and reseeded on next `npm run dev`.
