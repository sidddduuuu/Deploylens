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

This repository currently contains the project definition and architecture for the DeployLens demo. Implementation can proceed in three tracks:

1. Telemetry generation + ClickHouse schema/MV setup
2. Trigger.dev incident investigation tools
3. Next.js chat UI + interactive Incident Card

See [BUILD_PLAN.md](./BUILD_PLAN.md) for the contract-first, layer-by-layer implementation plan.
