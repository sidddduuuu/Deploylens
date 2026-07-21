# DeployLens Build Plan

DeployLens should be built as one narrow, contract-first vertical slice rather than a general observability platform. A one-day build is realistic only while the project remains a seeded, private demo with one metric, one incident, and no authentication or conversation-history system.

The architecture proposed in the README remains viable. As of July 20, 2026, Trigger.dev `chat.agent()` is generally available. Layer 5 pins Trigger.dev `4.5.5` and narrow same-major dependency overrides so the installed tree retains the relevant chat fixes and passes `npm audit`; the deployment gate still requires a live session and reconnect smoke test.

```text
Question
   |
   v
Trigger.dev chat.agent()
   |
   v investigateIncident()
   +-- Baseline task --+
   +-- Funnel task ----+-- ClickHouse
   +-- Segment task ---+
   |
   v
Validated IncidentResult
   |
   v
One interactive Incident Card
```

References:

- [Trigger.dev 4.5 GA](https://trigger.dev/changelog/v4-5-0)
- [Trigger.dev 4.5.4 release](https://trigger.dev/changelog/v4-5-4)
- [ClickHouse incremental materialized views](https://clickhouse.com/docs/materialized-view/incremental-materialized-view)

## Scope

- Private demo, not a public multi-tenant product.
- Only `checkout_conversion` is supported initially.
- One fixed synthetic day and incident.
- Four regions x three devices x two versions = 24 segments.
- No generic anomaly detection, live ingestion, authentication, billing, or conversation inbox.

## Layer 1: Result Contract

Define one Zod schema as the runtime source of truth for both backend and frontend:

```text
IncidentResult
+-- incident ID, question, service, and timezone
+-- baseline and incident windows
+-- deterministic finding and supporting evidence
+-- deployment, incident, and rollback markers
+-- default timeline and funnel view
+-- precomputed filtered views
+-- 24 segment deltas
```

Precomputed views let heatmap selections update the timeline and funnel without another request. The payload must contain bounded aggregates, never raw events.

### Exit gate

A fixture for `1.8.3 / EU-West / mobile` validates successfully, all rates and counts are within their allowed ranges, and every view reference resolves.

## Layer 2: Application Foundation

Use:

- Next.js App Router with strict TypeScript.
- Server Components for the page shell.
- One client workspace owning chat and filter state.
- Zod and the official ClickHouse client. Add the required Trigger.dev and AI SDK packages in Layer 5, when the orchestration code imports them.
- Native CSS, SVG, React state, and `Intl.DateTimeFormat`.

Do not add Tailwind, a component kit, chart library, Redux or Zustand, React Query, a date library, or an animation library.

Suggested feature-oriented layout:

```text
src/app/
  page.tsx
  actions.ts
  error.tsx
src/features/investigation/
  schema.ts
  incident.ts
  workspace.tsx
  incident-card.tsx
  timeline.tsx
  funnel.tsx
  segment-matrix.tsx
src/lib/clickhouse.ts
src/trigger/deploylens.ts
db/schema.sql
db/seed.sql
db/smoke.sql
tests/
```

Keep the interactive boundary around the investigation workspace rather than making the entire page a Client Component. See the [Next.js Server and Client Components guide](https://nextjs.org/docs/app/getting-started/server-and-client-components).

### Exit gate

Lint, type-check, and the production build pass with the fixture-backed page.

## Layer 3: ClickHouse Data

### Raw tables

- `events`: `MergeTree`, ordered for service and time queries; use `LowCardinality` for service, version, region, device, and event name.
- `deployments`: `MergeTree`, ordered by service and timestamp.
- `minute_metrics`: `AggregatingMergeTree` populated by an incremental materialized view.

`minute_metrics` must store mergeable aggregate states rather than finalized averages or percentiles:

- exact distinct session state,
- summed checkout starts, errors, and purchases,
- mergeable exact p95 latency state.

The materialized view's `GROUP BY` columns must match the target table's `ORDER BY` key so background merges combine the intended rows correctly.

### Deterministic seed

Use ClickHouse-native SQL over `numbers()` rather than adding a Faker dependency:

- approximately 50,000 sessions and 150,000-200,000 events,
- deployment `1.8.3` at 14:18,
- incident start at 14:20,
- elevated failures only for mobile users in EU-West,
- rollback at 14:47,
- immediate recovery,
- deterministic hashes and modulo operations for distribution.

### Exit gate

`db/smoke.sql` verifies the event count, deployment timestamps, target-segment failure spike, unaffected control segments, and recovery after rollback.

## Layer 4: Deterministic Analysis

Implement three parameterized query functions.

### Baseline analysis

- Read minute rollups.
- Compare equal-length baseline and incident windows.
- Return conversion, error, and p95 latency timelines plus deployment markers.

### Funnel analysis

- Query raw events with [`windowFunnel`](https://clickhouse.com/docs/sql-reference/aggregate-functions/parametric-functions#windowfunnel).
- Compare ordered stage completion before and during the incident.
- Return explicit session counts and drop-off rates.

### Segment analysis

- Scan all 24 version, region, and device combinations.
- Calculate baseline rate, incident rate, relative change, and estimated lost purchases.
- Produce precomputed views for interactive filtering.

Root-cause ranking remains pure and deterministic:

```text
impact = expected purchases at baseline rate - actual purchases
```

Select the highest-impact segment and attribute it to a deployment only when the deployment precedes the break, the affected version matches, the segment materially degrades, and the rollback aligns with recovery. The LLM summarizes this evidence but does not choose the root cause.

### Exit gate

A unit test identifies `1.8.3 / EU-West / mobile` from the seeded outputs and rejects incomplete child results.

## Layer 5: Trigger.dev Orchestration

Keep all tasks in one feature file:

- `baselineTask`
- `funnelTask`
- `segmentTask`
- `investigateIncidentTask`
- `deploylensAgent`

Expose the investigation task with `ai.toolExecute()`. Use `batch.triggerByTaskAndWait()` for the three different child tasks; do not wrap Trigger wait primitives in `Promise.all`. See [Trigger.dev task triggering](https://trigger.dev/docs/triggering).

Stream four progress parts with stable IDs:

- Comparing baseline
- Reconstructing funnel
- Scanning 24 segments
- Rendering incident

Return the validated Incident Card payload to the frontend. Use `toModelOutput` to give the model only the incident ID, conclusion, and active filters so chart arrays do not repeatedly enter model context.

Use:

- `useTriggerChatTransport()` and `useChat()`,
- one stable `chatId`,
- server actions for session start and scoped public-token minting,
- no custom chat route,
- no second Realtime subscription,
- no separate chat database.

Keep each result comfortably below Trigger.dev's approximately 1 MiB chat-record ceiling. See the [large-payload guidance](https://trigger.dev/docs/ai-chat/patterns/large-payloads).

### Exit gate

The canonical question streams real progress and returns a validated IncidentResult.

## Layer 6: Incident Card

Desktop layout:

- A narrow chat rail, approximately 20-22rem.
- The Incident Card as the dominant evidence surface.
- A vertical stack on smaller screens.

Card structure:

1. Deterministic finding and evidence.
2. Native SVG timeline with aligned conversion, error, and latency lanes.
3. CSS funnel comparison with visible counts and rates.
4. Semantic HTML segment table whose cells are buttons.

Use one restrained, high-contrast product surface rather than nested cards. Incident, deployment, and recovery colors must have distinct semantic meanings.

Accessibility requirements:

- keyboard-operable segment cells with `aria-pressed`,
- visible focus and 44px touch targets,
- timeline description plus expandable tabular data,
- funnel content that remains understandable without color,
- `aria-live="polite"` for progress and failures,
- a reduced-motion fallback,
- responsive checks at 390px, 768px, and 1440px.

### Exit gate

Selecting a segment cell changes both the timeline and funnel from one derived `selectedViewId`.

## Layer 7: Follow-ups and Failure Handling

For `Show only mobile traffic`:

1. Reuse the same `chatId`.
2. Call `investigateIncident` again with `device: "mobile"`.
3. Preserve the same `incidentId`.
4. Replace the active Incident Card data rather than appending another card.

Handle invalid questions, ClickHouse failures, a failed child task, stale streamed responses, retries, a second submission during a run, and schema mismatches. Never render a partial result as a confident finding.

### Exit gate

The canonical follow-up updates the existing card, and every controlled failure produces an actionable inline error without exposing secrets.

## Layer 8: Verification and Deployment

Automated checks:

- schema rejection tests,
- cause-ranking test,
- filter selector or reducer test,
- SQL smoke assertions,
- one Playwright flow covering question, progress, finding, segment selection, and follow-up,
- `eslint .`,
- `next typegen && tsc --noEmit`,
- tests,
- `next build`.

Deployment order:

1. Create ClickHouse Cloud tables and load seed data.
2. Deploy Trigger.dev tasks with ClickHouse and model-provider secrets.
3. Deploy Next.js with only its required Trigger credentials.
4. Run the canonical demo twice, including a browser refresh during execution.
5. Rehearse the mobile follow-up and one controlled failure.

## Execution Order

After the contract is fixed, the data and interface tracks can proceed independently:

```text
Contract
+-- ClickHouse -> analysis queries --+
+-- Fixture -> Incident Card UI -----+-> Trigger integration -> QA -> deploy
```

Expected focused effort:

| Work | Time |
| --- | ---: |
| Contract and foundation | 1-1.5 hours |
| ClickHouse schema, seed, and smoke checks | 1.5-2 hours |
| Analysis queries and cause ranking | 1.5 hours |
| Trigger.dev orchestration | 1-1.5 hours |
| Incident Card and interaction | 2-2.5 hours |
| Integration, verification, and deployment | 1-1.5 hours |

## Deferred Until Needed

- Generic anomaly detection and arbitrary metrics.
- Authentication and multi-tenancy.
- Persistent conversation history outside Trigger Sessions.
- Live telemetry ingestion.
- Server-side heatmap filtering.
- Reusable chart abstractions.

Add these only after the deterministic demo proves the need.
