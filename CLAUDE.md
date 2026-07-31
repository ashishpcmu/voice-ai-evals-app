# AI Evaluation Suite — Claude Code Build Prompt

## Project Overview

You are building the **AI Evaluation Suite** — a locally-hosted, full-stack web application for evaluating AI conversational agents. This is a professional product used by Product Managers, QA Engineers, and enterprise customers to simulate, score, and validate AI agents before production deployment.

The application must be **fully functional, locally hosted**, and accessible in a web browser at `http://localhost:3000`.

---

## Brand & Design System

### Product Color Palette
```
Primary Blue:      #1B4FD8   (main actions, headers, links)
Dark Navy:         #0F2167   (sidebar, nav background)
Accent Teal:       #00C2CB   (highlights, badges, success states)
Light Blue:        #EFF6FF   (card backgrounds, hover states)
White:             #FFFFFF   (content backgrounds)
Dark Text:         #111827   (primary text)
Gray Text:         #6B7280   (secondary text, labels)
Border:            #E5E7EB   (dividers, card borders)
Success Green:     #059669   (pass states, existing features)
Warning Amber:     #D97706   (P1 priority, caution)
Error Red:         #DC2626   (fail states, P0 priority)
```

### Design Principles
- Professional SaaS interface — clean, data-dense, no clutter
- Sidebar navigation with dark navy background and white text
- Card-based content areas with subtle shadows
- Tables must be readable with alternating row colors
- All interactive elements have hover states
- Toast notifications for actions (save, run, assign, etc.)
- Loading skeletons for async operations
- Mobile-responsive but optimized for desktop (1280px+)

---

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** as the build tool
- **Tailwind CSS** for styling (configured with the product color palette)
- **React Router v6** for navigation
- **Zustand** for state management
- **React Query (TanStack Query)** for server state / API calls
- **React Hook Form** + **Zod** for forms and validation
- **Lucide React** for icons
- **Recharts** for metric charts and visualizations
- **React Hot Toast** for notifications
- **@tanstack/react-table** for data tables

### Backend
- **Node.js** with **Express** and TypeScript
- **SQLite** with **better-sqlite3** as the database (no external DB needed — fully local)
- **Drizzle ORM** for database schema and queries
- **Multer** for file uploads (PDF and DOCX transcripts)
- **pdf-parse** for PDF text extraction
- **mammoth** for DOCX text extraction
- **OpenAI SDK** (configurable — user provides API key via `.env`)
- **uuid** for ID generation
- **cors**, **helmet**, **express-validator** for security middleware
- **tsx** for running TypeScript directly

### Project Structure
```
ai-eval/
├── CLAUDE.md                    ← this file
├── .env.example                 ← environment variable template
├── .env                         ← created by user (gitignored)
├── package.json                 ← root workspace config
├── README.md                    ← setup and run instructions
│
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── api/                 ← API client functions
│       ├── components/          ← shared UI components
│       │   ├── ui/              ← primitives (Button, Badge, Card, Modal, etc.)
│       │   ├── layout/          ← Sidebar, TopNav, PageHeader
│       │   └── shared/          ← TranscriptViewer, MetricCard, etc.
│       ├── pages/               ← one file per route
│       │   ├── Dashboard.tsx
│       │   ├── Scenarios/
│       │   ├── EvalRuns/
│       │   ├── TraceInspector/
│       │   ├── Metrics/
│       │   ├── Collaboration/
│       │   ├── VersionComparison/
│       │   ├── EvaluatorQuality/
│       │   └── Settings/
│       ├── store/               ← Zustand stores
│       └── types/               ← shared TypeScript types
│
└── backend/
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── index.ts             ← Express server entry
        ├── db/
        │   ├── schema.ts        ← Drizzle schema (all tables)
        │   └── index.ts         ← DB connection + migrations
        ├── routes/              ← one file per resource
        ├── services/            ← business logic
        ├── middleware/          ← auth, error handling, upload
        └── types/               ← shared types
```

---

## Database Schema

Create all tables using Drizzle ORM with SQLite. The schema must include:

```typescript
// Agents
agents: id, name, version, prompt, sop, tools (JSON), knowledge_bases (JSON), created_at, updated_at

// Scenarios
scenarios: id, agent_id, name, description, seed_utterance, expected_outcome_type (natural_language|tool_call|kpi_threshold), expected_outcome_value, persona_id, tags (JSON array), status (draft|active|archived), created_by, created_at, updated_at

// Personas
personas: id, agent_id, name, tone, goal, frustration_level, additional_attributes (JSON), is_synthetic, created_at

// Eval Runs
eval_runs: id, agent_id, agent_version, name, scenario_ids (JSON), n_trials, k_threshold, metric_ids (JSON), mode (mock|live), status (pending|running|complete|failed), summary_metrics (JSON), created_at, completed_at

// Trial Results
trial_results: id, run_id, scenario_id, trial_index, kpi_score, kpi_rationale, pass_fail, nfr_metrics (JSON: {ttft, avg_latency, e2e_latency, cost, input_tokens, output_tokens, model_calls}), talk_ratio, created_at

// Transcript Turns
transcript_turns: id, trial_result_id, turn_index, role (user|agent|tool|kb), content, timestamp_ms, metadata (JSON)

// Tool Calls (embedded in transcript_turns metadata or separate table)
tool_calls: id, turn_id, tool_name, input_args (JSON), response (JSON), latency_ms, status (success|error)

// KB Calls
kb_calls: id, turn_id, query, chunks (JSON: [{title, snippet, score}]), latency_ms, kb_source

// Annotations
annotations: id, trial_result_id, turn_id (nullable), note_text, tags (JSON), author_id, author_name, created_at

// Assignments
assignments: id, trial_result_id, assignee_id, assignee_name, status (unassigned|in_review|resolved), due_date, history (JSON), created_at, updated_at

// Human Ratings
human_ratings: id, run_id, scenario_id, trial_result_id, rater_id, rater_name, rating (pass|fail), comment, created_at

// Disagreement Reports
disagreement_reports: id, run_id, disagreement_rate, kappa_score, false_positives (JSON), false_negatives (JSON), summary, generated_at

// Uploaded Files
uploaded_files: id, original_name, file_path, file_type (pdf|docx), parsed_content (TEXT), parsing_status, created_at
```

---

## Complete Feature Requirements

Build every feature below. Do not skip any. Each feature maps to a PRD requirement.

---

### SECTION A — Scenario Management

#### REQ-01: Manual Scenario Authoring
**Route:** `/scenarios/new`

Build a full-page form with these fields:
- **Scenario Name** (required, text input)
- **Description / Intent** (optional, textarea)
- **Conversation Seed** (required, textarea — this is the first user utterance the simulator sends)
- **Expected Outcome Type** (radio select):
  - `Natural Language` → show a textarea: "Describe in plain English what a passing outcome looks like"
  - `Required Tool Call` → show a text input: "Tool name that must be called"
  - `KPI Score Threshold` → show: metric name + operator (≥, ≤, =) + value
- **Persona Assignment** (dropdown of existing personas, or "Create new inline")
- **Tags** (tag input — type and press Enter to add, click × to remove)
- **Status** (toggle: Draft / Active)

Validation: Scenario name must be unique per agent. Seed is required.

On save: Show toast "Scenario saved", redirect to scenario list.

#### REQ-02: AI-Assisted Scenario Generation
**Location:** Button on Scenario List page → opens a slide-over panel

Build a generation panel with:
- **Prompt field** (large textarea, placeholder: "e.g. Generate 10 edge cases where a customer is frustrated and wants to cancel but could be retained with a discount offer")
- **Count** (number input, 1–50, default 5)
- **Persona hint** (optional text input)
- **Generate button** → calls `POST /api/scenarios/generate`

Backend: The generate endpoint calls OpenAI with the prompt + agent context (current agent's prompt, SOP, tool list) and returns structured JSON of scenarios. If no OpenAI key is configured, return a set of 5 realistic mock scenarios for demo purposes.

After generation: Show a review table with all generated scenarios. Each row is editable inline. User can toggle rows on/off. "Save Selected" commits to DB.

All AI-generated scenarios get a tag: `ai-generated` automatically.

#### REQ-03: Bulk Import via CSV/JSON
**Location:** Button on Scenario List page

- Downloadable CSV template button
- File upload area (drag & drop or click)
- On upload: parse and show validation summary table (valid rows in green, errors in red with reason)
- User can proceed with valid rows, skipping errors
- Supported CSV headers: `name, seed_utterance, expected_outcome_type, expected_outcome_value, persona_hint, tags`

---

### SECTION B — Eval Run Execution

#### REQ-04: n-Trial Runs with pass@k and pass^k

**Run Configuration Modal** (triggered from eval runs page):
- Select scenarios (multi-select with checkboxes, search)
- **Trials per scenario (n)**: number input, 1–20, default 1
- **k threshold**: number input (must be ≤ n), default 1
- **Metrics to track**: multi-select from available metrics
- **Mode**: toggle Mock / Live
- **Run name**: auto-suggested as "Run {date}" but editable

After run completes, the results table shows per scenario:
- Scenario name
- Trials run (e.g. "5/5")
- Pass count (e.g. "4")
- **pass@k** = 1 - (C(n-pass, k) / C(n, k)) — show as percentage with tooltip explanation
- **pass^k (strict)** = (pass_count / n)^k — show as percentage
- KPI score (avg across trials)
- TTFT (avg)
- Latency (avg)
- Cost (sum)
- Talk Ratio (avg)

#### REQ-05 & REQ-06: AI User Simulator + Mock Tool Execution

Build a simulation engine in the backend (`services/simulator.ts`):

The simulator runs a multi-turn conversation:
1. Takes the scenario seed as the first user message
2. Calls a mock "agent response" (use OpenAI if key present, else use a realistic scripted mock response based on the scenario)
3. Detects when a "tool call" would happen — generates mock tool call with realistic input/output
4. Detects when a KB lookup would happen — generates mock KB chunks
5. Continues until: (a) resolution detected, (b) escalation detected, or (c) max 20 turns
6. Records the full transcript with all metadata
7. Calculates all NFR metrics from timing

The simulation must feel realistic. For mock mode, generate plausible conversation flows for insurance/banking/telecom-style contact center scenarios.

---

### SECTION C — Metrics

#### REQ-07: Per-Scenario KPI Scoring with LLM Rationale
After each trial, score the conversation:
- Use LLM (OpenAI if available, else rule-based mock scorer) to evaluate against the scenario's expected outcome
- Return: score (0 or 1 or float 0–1), rationale (2–3 sentence explanation citing specific turns)
- Display: score as colored badge (green ≥ 0.7, amber 0.3–0.7, red < 0.3) + rationale text inline in results

#### REQ-08: Custom Metric Definition
**Route:** `/metrics/new`
- Name, description (natural language), type (conversation-level or turn-level)
- "Test metric" button: paste a sample transcript and see what score the LLM would give
- Metrics library page showing all defined metrics with edit/archive

#### REQ-09: Talk Ratio Metric
Calculate automatically for every trial:
- `agent_word_count` = sum of words across all agent turns
- `user_word_count` = sum of words across all user/simulator turns  
- `talk_ratio` = agent_word_count / user_word_count
- Display as decimal AND as a mini horizontal bar chart in the results table
- Color code: green if 0.8–2.0 (healthy range), amber if 2.0–3.5, red if > 3.5 or < 0.5
- PM can configure custom thresholds in Settings

#### REQ-10: TTFT, Latency, Cost Metrics
Auto-captured during simulation:
- `ttft_ms`: time from turn 1 user message to first agent token
- `avg_latency_ms`: mean response time per agent turn
- `e2e_latency_ms`: total conversation wall time
- `cost_usd`: calculated from token counts × model pricing (use $0.002/1K tokens as default estimate)

Show in run summary: P50/P90/P99 distribution for latency across all scenarios using a histogram chart.

#### REQ-11: Token Count & Model Call Count
- `input_tokens`, `output_tokens`, `model_calls` per trial
- Show in per-scenario detail AND run summary totals
- Highlight if model_calls exceeds the agent's configured limit

---

### SECTION D — Trace Inspection

#### REQ-12: Timestamps on Every Turn
In `TranscriptViewer` component:
- Every turn row shows timestamp
- Default: relative time from conversation start (e.g. `T+2.4s`)
- Toggle in transcript header to switch to wall-clock (HH:MM:SS.mmm)
- Implement this toggle with smooth transition

#### REQ-13: Tool Calls Inline in Transcript
Tool call events appear as rows between agent turns:

```
[T+3.1s] 🔧 TOOL CALL — verify_customer_identity
  Input:   { "dob": "1990-01-01", "ssn_last4": "1234", "policy_id": "POL-9988" }
  Output:  { "verified": true, "customer_name": "Jane Smith" }
  Latency: 142ms  ✓ Success
```

Visual design:
- Light gray background with a teal left border
- Wrench icon
- Input/Output JSON sections collapsed by default, expand on click
- Latency badge
- Status dot (green = success, red = error)

#### REQ-14: KB / RAG Calls Inline in Transcript
KB retrieval events appear as rows:

```
[T+5.2s] 📚 KB LOOKUP — policy_cancellation_faq
  Query:   "What are the cancellation terms for standard policies?"
  Retrieved 3 chunks:
    1. "Policy Cancellation Guide" — score: 0.94  [expand to read]
    2. "Refund Processing Rules"   — score: 0.87  [expand to read]
    3. "Early Termination Fees"    — score: 0.71  [expand to read]
  Latency: 89ms
```

Visual design:
- Light blue background with a blue left border
- Book icon
- Chunks collapsed by default, expandable
- Score shown as colored number (green > 0.8, amber 0.6–0.8, red < 0.6)

---

### SECTION E — Collaboration & Review

#### REQ-15: Annotations, Notes, and Tags on Traces
In the trace detail view (right side panel):
- "Add Note" button → opens inline form: textarea + tag selector
- Notes appear in a stacked list with: author avatar/initials, timestamp, text, tags
- Notes support basic markdown (bold, italic, code)
- Tags appear as colored chips in both the note and the trace row in the results table
- Turn-level annotations: clicking on any transcript turn shows a "📌 Pin note here" option

#### REQ-16: Assign Traces to Team Members
In trace detail and results table (row actions menu):
- "Assign to" dropdown → shows team member list (configurable in Settings)
- Status dropdown: Unassigned → In Review → Resolved
- Assignment shown as avatar + status badge in results table
- "My Reviews" filter in results table header

#### REQ-17: Filter & Search Traces
Above the results table, a filter bar with:
- 🔍 Search by scenario name (text input)
- Filter by: Tags (multi-select), Assignee (multi-select), Review Status, Pass/Fail, KPI score range (slider)
- Active filter count badge: "3 filters active" with clear-all button
- Filters persist within session, serialized to URL query params

---

### SECTION F — Version Comparison

#### REQ-18 & REQ-19: Version Comparison with Delta View
**Route:** `/compare`

Page layout:
- Two dropdowns: "Baseline Run" and "New Run" — select from completed eval runs
- "Compare" button → shows side-by-side comparison

Comparison view:
- **Summary cards**: KPI Score, Pass Rate, TTFT, Avg Latency, Cost — each card shows baseline value, new value, and delta (colored: green = improvement, red = regression, gray = neutral)
- **Per-scenario table**: each row shows scenario name, baseline score, new score, delta, change indicator (↑ ↓ →)
- **Regressions callout box**: at top, lists any scenarios that regressed by > 5% KPI or > 10% latency
- **Metric chart**: line/bar chart showing metric values across both runs side by side (Recharts)

---

### SECTION G — Evaluator Quality

#### REQ-20: Human Rating UI
**Route:** `/eval-runs/{id}/human-review`

Flow:
1. Configure session: set N (default 20), sampling strategy (random, lowest-confidence, by-tag)
2. Review queue: shows progress bar "Reviewed 5 of 20"
3. One scenario at a time:
   - Left panel: full transcript with all events
   - Right panel: LLM judge score + rationale, then human rating buttons
   - Human rates: **Pass** (green button) or **Fail** (red button) + optional comment
   - Keyboard shortcut: P = Pass, F = Fail, N = next
4. After completing N ratings: "Calculate Disagreement" button activates

#### REQ-21: Disagreement Score
After human review session completes:
- Calculate: disagreement_rate = (mismatches / total_rated)
- Calculate Cohen's Kappa: κ = (Po - Pe) / (1 - Pe)
- Show results panel:
  - Headline: "68% agreement with LLM judge (κ = 0.42 — Moderate)"
  - Disagreement rate as a donut chart
  - False Positives table: "Judge said PASS, Human said FAIL" — with scenario name + LLM rationale
  - False Negatives table: "Judge said FAIL, Human said PASS"
  - AI suggestion: "Consider refining the judge prompt to be stricter about X..."

#### REQ-22: Calibration Report
Generate a PDF-ready report view (printable) with:
- Run name, date, scenario count, rater names
- Headline disagreement metrics
- Top 5 disagreement scenarios with full details
- Suggested judge prompt improvements

---

### SECTION H — Transcript Upload & Parsing

**Route:** `/upload`

This is how real transcript data enters the system. Build a complete upload flow:

1. **Upload page**: drag & drop zone accepting PDF and DOCX files
2. **Parser backend** (`services/transcriptParser.ts`):
   - PDF: use `pdf-parse` to extract text
   - DOCX: use `mammoth` to extract text
   - Parse the text into structured turns using these rules:
     - Lines starting with `[HH:MM:SS]` or `[T+Xs]` = timestamp
     - Lines with `Agent:` or `BOT:` = agent turn
     - Lines with `Customer:` or `User:` = user turn
     - Lines with `TOOL CALL:` or `[TOOL]` = tool call event
     - Lines with `KB LOOKUP:` or `[KB]` = knowledge base event
     - JSON blocks after tool/KB headers = payload data
   - Store parsed result in `uploaded_files.parsed_content`
3. **Review parsed transcript**: show the structured preview with all turns, tool calls, KB calls highlighted
4. **Create scenario from transcript**: button to use the first user turn as a conversation seed and create a scenario

---

### SECTION I — Dashboard

**Route:** `/` (Dashboard)

A metrics overview page showing:
- **Top stat cards** (4 across): Total Runs, Avg KPI Score (last 7 days), Avg Pass Rate, Avg TTFT
- **Recent Runs table**: last 5 runs with name, date, scenario count, pass rate, status
- **KPI trend chart**: line chart showing avg KPI score per run over time (Recharts LineChart)
- **Latency distribution**: bar chart of P50/P90/P99 across recent runs
- **Top failing scenarios**: table of scenarios with lowest pass rates across all runs
- **Quick actions**: "New Eval Run", "Upload Transcript", "Add Scenario" buttons

---

### SECTION J — Settings

**Route:** `/settings`

Tabs:
1. **API Keys**: OpenAI API key input (masked, with "Test connection" button), saved to `.env` file or local DB
2. **Team Members**: add/remove team members (name + email) for assignment feature
3. **Agents**: list of configured agents, each with name, version, description
4. **Metrics Defaults**: default metrics applied to all new runs, default thresholds
5. **Talk Ratio Thresholds**: configure warning and danger thresholds

---

## API Endpoints

Implement all these RESTful endpoints:

```
# Health
GET  /api/health

# Agents
GET    /api/agents
POST   /api/agents
GET    /api/agents/:id
PUT    /api/agents/:id

# Scenarios
GET    /api/scenarios?agent_id=&status=&tags=
POST   /api/scenarios
GET    /api/scenarios/:id
PUT    /api/scenarios/:id
DELETE /api/scenarios/:id
POST   /api/scenarios/generate          ← AI generation
POST   /api/scenarios/import            ← CSV/JSON bulk import
GET    /api/scenarios/export/template   ← download CSV template

# Eval Runs
GET    /api/eval-runs?agent_id=
POST   /api/eval-runs                   ← create and start run
GET    /api/eval-runs/:id
GET    /api/eval-runs/:id/results       ← full results with trial data
GET    /api/eval-runs/:id/summary       ← aggregated summary metrics
POST   /api/eval-runs/:id/cancel

# Trial Results
GET    /api/trial-results/:id           ← full trace with turns, tool calls, KB calls
POST   /api/trial-results/:id/annotations
GET    /api/trial-results/:id/annotations
POST   /api/trial-results/:id/assign
PUT    /api/trial-results/:id/status

# Metrics
GET    /api/metrics
POST   /api/metrics
GET    /api/metrics/:id
PUT    /api/metrics/:id
POST   /api/metrics/:id/test            ← test metric against sample transcript

# Human Review
POST   /api/eval-runs/:id/human-review/start
GET    /api/eval-runs/:id/human-review/queue
POST   /api/eval-runs/:id/human-review/rate
GET    /api/eval-runs/:id/disagreement-report
POST   /api/eval-runs/:id/disagreement-report/generate

# Version Comparison
POST   /api/compare                     ← body: { baseline_run_id, new_run_id }

# File Upload
POST   /api/upload                      ← multipart/form-data
GET    /api/upload/:id/preview

# Settings
GET    /api/settings
PUT    /api/settings
POST   /api/settings/test-openai        ← test API key
```

---

## Seed Data

On first run (when DB is empty), seed the database with:

**1 Agent:**
- Name: "Policy Cancellation Agent"
- Version: "v1"
- Description: "Handles insurance policy cancellation requests for Safeguard Insurance"

**5 Scenarios:**
1. "Standard Cancellation" — seed: "Hi, I'd like to cancel my insurance policy."
2. "Price Objection — Retention Opportunity" — seed: "I want to cancel, your prices are way too high."
3. "Urgent Cancellation" — seed: "I need to cancel immediately, I just bought a new policy elsewhere."
4. "Confused Customer" — seed: "I'm not sure if I want to cancel or just change my plan..."
5. "Verification Failure" — seed: "I want to cancel but I don't have my policy number handy."

**3 Personas:**
1. Frustrated Customer (tone: frustrated, goal: cancel immediately)
2. Persuadable Customer (tone: neutral, goal: cost reduction)
3. Confused Customer (tone: confused, goal: unclear)

**1 Completed Eval Run** with realistic mock results (including transcript turns, tool calls, KB calls, scores) so the UI has data to display immediately on first load.

---

## Error Handling & UX Details

- All API errors return `{ error: string, code: string, details?: any }`
- Frontend shows error toasts for failed API calls
- Loading states: use skeleton screens (not spinners) for table/card loading
- Empty states: every empty list/table must have an illustration + helpful CTA (e.g. "No scenarios yet — Create your first one" with a button)
- Confirm dialogs before destructive actions (delete, archive)
- All forms have inline validation with error messages below fields
- "Unsaved changes" warning if user navigates away from an edited form

---

## Startup & Run Instructions

Generate a `README.md` with:

```bash
# Prerequisites: Node.js 18+, npm

# 1. Install all dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env to add your OpenAI API key (optional — app works without it using mock data)

# 3. Start the application (starts both frontend and backend)
npm run dev

# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
# API docs: http://localhost:3001/api/health
```

Use `concurrently` in the root package.json to run both frontend and backend with `npm run dev`.

---

## Implementation Order

Build in this order to ensure each phase is testable:

1. **Phase 1 — Foundation**: Project setup, DB schema, seed data, basic Express server, React app shell with sidebar navigation and routing
2. **Phase 2 — Core Data**: Scenarios CRUD (REQ-01, REQ-03), Agents, Personas, Metrics pages
3. **Phase 3 — Eval Engine**: Simulator service, eval run execution, trial result storage (REQ-04, REQ-05, REQ-06)
4. **Phase 4 — Results & Metrics**: Results table with all metrics, transcript viewer with timestamps/tool calls/KB calls (REQ-07–REQ-14)
5. **Phase 5 — AI Features**: AI scenario generation (REQ-02), KPI scoring, custom metrics test
6. **Phase 6 — Collaboration**: Annotations, assignments, filters (REQ-15–REQ-17)
7. **Phase 7 — Advanced**: Version comparison, human review, disagreement scoring (REQ-18–REQ-22)
8. **Phase 8 — Dashboard & Polish**: Dashboard charts, settings, upload flow, empty states, error handling

---

## Quality Checklist

Before considering the build complete, verify:
- [ ] `npm run dev` starts both servers without errors
- [ ] Seeded data is visible on Dashboard immediately
- [ ] Can create a scenario, run an eval, and view results end-to-end
- [ ] Transcript viewer shows timestamps, tool calls, and KB calls
- [ ] Can add an annotation and assign a trace
- [ ] Version comparison shows delta values
- [ ] Human review flow completes and shows disagreement score
- [ ] All pages have loading states and empty states
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] No broken navigation routes

---

*This file is the single source of truth for the build. Read it fully before writing any code. Build the complete application — do not stop at a skeleton or MVP.*
