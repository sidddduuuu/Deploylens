# DeployLens

**Tagline:** *Ask why a metric moved. Get the incident, not a paragraph.*

DeployLens is a deterministic incident-investigation demo that turns a natural-language question like **“Why did checkout conversion drop around 14:20?”** into a single interactive **Incident Card** instead of a long text answer.

The card combines metric context, funnel breakage, and segment-level attribution so the user can immediately see **what changed, where it changed, and what likely caused it**.

---

## Demo Outcome

For the question above, DeployLens returns one Incident Card containing:

1. A timeline with conversion rate, errors, latency, and deployment markers.
2. A before-vs-after checkout funnel.
3. A segment heatmap for app version, region, and device.
4. A highlighted likely cause (example):
   - **“Release 1.8.3 caused a 37% checkout failure increase for mobile users in EU-West.”**
5. Clickable heatmap cells that filter the timeline and funnel.

Outside the visualization, the assistant should answer in no more than one or two sentences.

---

## Why this is a strong one-day build

- **Clear problem statement:** explain a metric drop quickly.
- **Visually impressive reveal:** one high-signal card with linked views.
- **Deterministic demo:** seeded telemetry + planted incident means reliable outputs.
- **Low external risk:** avoids GitHub API limits, auth setup, scraping, uploads, and flaky third-party dependencies.

---

## Architecture

```text
Next.js chat UI
       │
       ▼
Trigger.dev chat.agent()
       │
       ├── Baseline analysis task
       ├── Funnel analysis task
       └── Segment-delta analysis task
                    │
                    ▼
             ClickHouse Cloud
      events + deployments + minute_metrics
                    │
                    ▼
         Interactive Incident Card
```

### Responsibilities

- **Next.js**: Chat interface and Incident Card rendering.
- **Trigger.dev**: Conversation runtime + orchestration of analysis tasks.
- **ClickHouse Cloud**: High-speed analytics over event telemetry and deployments.

---

## Data Model (ClickHouse)

Use three tables:

### 1) `events`

- `timestamp`
- `session_id`
- `user_id`
- `event_name`
- `service`
- `version`
- `region`
- `device`
- `latency_ms`
- `status_code`

### 2) `deployments`

- `timestamp`
- `service`
- `version`
- `commit_sha`
- `region`

### 3) `minute_metrics`

- `minute`
- `service`
- `version`
- `region`
- `device`
- `sessions`
- `errors`
- `checkouts`
- `purchases`
- latency percentiles

`minute_metrics` should be maintained via an **incremental materialized view** so aggregation work happens at insert time and the UI can query fast rollups.

Reference: [ClickHouse Incremental Materialized Views](https://clickhouse.com/docs/materialized-view/incremental-materialized-view?utm_source=chatgpt.com)

### ClickHouse functions to showcase

- `windowFunnel` for checkout funnel completion and drop-off stages.
- Quantile functions (time-oriented percentiles) for latency trend analysis.

---

## Synthetic Incident Scenario

Generate approximately **100,000–300,000 events** with this timeline:

- **Before 14:18**: normal traffic.
- **14:18**: deployment of `1.8.3`.
- **14:20**: planted incident starts — mobile + EU-West checkout errors spike.
- **14:47**: rollback and recovery.

This ensures the assistant consistently identifies the correct root cause in demos.

---

## Trigger.dev Agent Design

Use `chat.agent()` as the conversation and orchestration layer.

Expose one high-level tool:

- `investigateIncident(metric, timeRange)`

This tool launches three analyses in parallel:

1. **Baseline analysis**: compare incident window vs preceding normal window.
2. **Funnel analysis**: find where users drop in checkout journey.
3. **Segment scan**: detect largest negative deltas by version, region, and device.

### Stream visible progress states

- ✓ Comparing baseline
- ✓ Reconstructing funnel
- ✓ Scanning 24 segments
- ✓ Rendering incident

Then pass structured results to:

- `renderIncidentCard(...)`

A follow-up message like **“Show only mobile traffic”** should update the same component to demonstrate durable, interactive conversation state.

---

## What “Done” Looks Like (Demo Checklist)

- User asks: **“Why did checkout conversion drop around 14:20?”**
- System returns one Incident Card with linked timeline, funnel, and heatmap.
- Card highlights likely cause tied to deployment + segment impact.
- Clicking heatmap cells updates timeline and funnel filters.
- Follow-up chat queries refine the same incident view.
- Assistant text outside the card stays at 1–2 sentences.

---

## Project Status

Layers 1–7 and the credential-free portion of Layer 8 are implemented:

- a validated `IncidentResult` contract and fixture-backed evidence surface,
- deterministic ClickHouse schema, seed data, queries, and root-cause ranking,
- Trigger.dev child-task orchestration with streamed progress,
- a durable Trigger.dev chat transport with scoped session tokens,
- a native SVG timeline, CSS funnel comparison, and linked 24-cell segment heatmap,
- same-session mobile follow-up refinement and actionable inline failures,
- refresh-stable chat identity and Trigger stream reconnection,
- Playwright coverage for linked interactions and 390px, 768px, and 1440px layouts,
- credential-free app and ClickHouse CI gates.

The fixture is only the initial, explicitly labelled preview. A submitted supported question uses the real Trigger.dev → ClickHouse → model-provider path; there is no mock chat transport or mock analytics response. The live API and browser proofs are implemented but remain opt-in until service credentials and protected hosting are configured.

## Local development

Use Node.js 22. Copy `.env.example` to `.env.local` and provide the Trigger.dev project, ClickHouse, and Anthropic credentials. Apply `db/schema.sql` and then `db/seed.sql` to ClickHouse before starting the web app and Trigger.dev worker in separate terminals.

The schema creates a dedicated `deploylens` database and the application always connects to that database. The seed is destructive inside that namespace: it truncates `deploylens.events`, `deploylens.deployments`, and `deploylens.minute_metrics`. Never run it against a shared database whose `deploylens` namespace contains unrelated data.

```sh
npm install
npx playwright install chromium
npm run dev
npm run dev:trigger
```

## Credential-free verification

Run the full app gate and the isolated SQL smoke gate:

```sh
npm run verify
npm run test:sql
npm audit --audit-level=moderate
```

`npm run verify` runs lint, Next route type generation, strict TypeScript, unit tests, a production build, and the credential-free browser flow. `npm run test:sql` requires a local `clickhouse` binary; CI runs the same schema → seed → smoke sequence in a digest-pinned official ClickHouse image.

## Credentialed end-to-end proof

With the seeded ClickHouse database and Trigger.dev worker running (or deployed), put `TRIGGER_SECRET_KEY` in `.env.local`; the worker also needs the ClickHouse and Anthropic credentials from `.env.example`. Then run:

```sh
npm run test:e2e
npm run test:browser:live
```

The API proof validates one real Trigger.dev session, streamed progress, and both structured incident results. The browser proof submits the canonical question, refreshes during the live run, selects the affected segment, and applies the mobile follow-up to the same incident. Set `PLAYWRIGHT_BASE_URL` to exercise a deployed Next.js URL; otherwise Playwright starts the local app. A protected remote URL also needs the hosting provider's approved test-auth or automation-bypass setup once that provider is chosen—do not disable protection just to run the test. Regular tests skip both live proofs so credential-free CI stays deterministic.

## Credentialed deployment gate

1. Provision a dedicated ClickHouse service/database and apply `db/schema.sql` then `db/seed.sql`.
2. Configure the Trigger.dev environment with ClickHouse and Anthropic secrets, set `TRIGGER_ACCESS_TOKEN` locally, and run `npm run deploy:trigger`.
3. Deploy Next.js with `TRIGGER_SECRET_KEY` and keep the deployment access-protected.
4. Run the canonical browser flow twice, including the refresh-during-run proof, then the mobile follow-up.
5. Rehearse an unsupported question such as `What changed?` and confirm it returns the scoped inline error without starting a paid run.

Do not expose the current session actions on a public URL: they intentionally omit product authentication and rate limiting for this private seeded demo. Add both before removing deployment protection.

`deploy:trigger` fetches the exact 4.5.5 CLI outside the application dependency graph because installing that CLI currently introduces audited vulnerable transitive packages. Run it only from a trusted checkout, and move it into the lockfile once the upstream graph is clean.

See [BUILD_PLAN.md](./BUILD_PLAN.md) for the contract-first, layer-by-layer implementation plan.
