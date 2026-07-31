# Voice AI Evaluation Suite

A locally-hosted, full-stack web app for evaluating AI conversational agents — author scenarios, run multi-trial evaluations, score them, inspect transcripts/tool calls, compare versions, and run voice-agent evaluations over **Twilio** or **LiveKit** (with live transcription and call recording).

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
git clone git@github.com:ashishpcmu/voice-ai-evaluation-app.git
cd voice-ai-evaluation-app

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
voice-ai-evaluation-app/
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
