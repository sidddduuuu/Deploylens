import assert from "node:assert/strict";
import test from "node:test";
import type { ClickHouseClient } from "@clickhouse/client";

import {
  buildIncidentResult,
  queryBaseline,
  queryFunnel,
  querySegments,
  selectRootCause,
} from "../src/features/investigation/analysis.ts";
import type { Segment } from "../src/features/investigation/schema.ts";

const versions = ["1.8.2", "1.8.3"] as const;
const regions = ["AP-South", "EU-Central", "EU-West", "US-East"] as const;
const devices = ["desktop", "mobile", "tablet"] as const;

const segments = versions.flatMap((version) =>
  regions.flatMap((region) =>
    devices.map((device) => ({ version, region, device } satisfies Segment)),
  ),
);
const scopes: (Segment | null)[] = [null, ...segments];

function isAffected(segment: Segment | null) {
  return segment?.version === "1.8.3" && segment.region === "EU-West" && segment.device === "mobile";
}

function scopeColumns(segment: Segment | null) {
  return {
    scope_mask: segment ? 0 : 7,
    result_version: segment?.version ?? null,
    result_region: segment?.region ?? null,
    result_device: segment?.device ?? null,
  };
}

function purchasesFor(segment: Segment | null, period: "baseline" | "incident" | "recovery") {
  if (!segment) return period === "incident" ? 328 * 24 - 48 : 328 * 24;
  return isAffected(segment) && period === "incident" ? 280 : 328;
}

function minuteWindow(
  period: "baseline" | "incident" | "recovery",
  start: string,
  count: number,
) {
  return Array.from({ length: count }, (_, minute) => [
    period,
    new Date(Date.parse(start) + minute * 60_000).toISOString(),
  ] as const);
}

const timelineTimes = [
  ...minuteWindow("baseline", "2026-07-20T13:50:00Z", 27),
  ...minuteWindow("incident", "2026-07-20T14:20:00Z", 27),
  ...minuteWindow("recovery", "2026-07-20T14:47:00Z", 27),
];

const timelineRows = scopes.flatMap((segment) =>
  timelineTimes.map(([period, at]) => {
    const degraded = isAffected(segment) && period === "incident";
    const checkoutCount = segment ? 459 : 459 * 24;
    const purchaseCount = purchasesFor(segment, period);
    return {
      ...scopeColumns(segment),
      period,
      at,
      session_count: checkoutCount,
      checkout_count: checkoutCount,
      error_count: checkoutCount - purchaseCount,
      purchase_count: purchaseCount,
      p95_latency_ms: degraded ? 496 : 227,
    };
  }),
);

const funnelRows = scopes.flatMap((segment) =>
  (["baseline", "incident"] as const).map((period) => {
    const starts = segment ? 459 : 459 * 24;
    return {
      ...scopeColumns(segment),
      period,
      cart: starts,
      checkout_started: starts,
      payment_submitted: starts,
      purchase: purchasesFor(segment, period),
    };
  }),
);

const segmentRows = segments.map((segment) => {
  const affected = isAffected(segment);
  return {
    ...segment,
    incident_sessions: 459,
    baseline_starts: 459,
    baseline_errors: 131,
    baseline_purchases: 328,
    incident_starts: 459,
    incident_errors: affected ? 179 : 131,
    incident_purchases: affected ? 280 : 328,
    recovery_starts: 459,
    recovery_errors: affected ? 130 : 131,
  };
});

const deploymentRows = [
  { at: "2026-07-20T14:18:00Z", version: "1.8.3", commit_sha: "a1843de", region: "global" },
  { at: "2026-07-20T14:47:00Z", version: "1.8.2", commit_sha: "b7c21af", region: "global" },
];

function seededClient(funnels: unknown[] = funnelRows) {
  return {
    query: async ({ query }: { query: string }) => ({
      json: async () => query.includes("FROM deployments")
        ? deploymentRows
        : query.includes("windowFunnel")
          ? funnels
          : query.includes("uniqExactMergeIf")
            ? segmentRows
            : timelineRows,
    }),
  } as unknown as ClickHouseClient;
}

const analysisParams = {
  service: "checkout",
  baseline: { from: "2026-07-20T13:50:00Z", to: "2026-07-20T14:17:00Z" },
  incident: { from: "2026-07-20T14:20:00Z", to: "2026-07-20T14:47:00Z" },
};

test("seeded child analyses select the deployed EU-West mobile regression", async () => {
  const client = seededClient();
  const [baseline, funnel, segmentAnalysis] = await Promise.all([
    queryBaseline(client, analysisParams),
    queryFunnel(client, analysisParams),
    querySegments(client, analysisParams),
  ]);
  const children = { baseline, funnel, segments: segmentAnalysis };
  const result = selectRootCause(children);
  const incident = buildIncidentResult(children, {
    question: "Why did checkout conversion drop around 14:20?",
    service: "checkout",
    generatedAt: "2026-07-20T15:00:00Z",
  });

  assert.deepEqual(result.segment.segment, {
    version: "1.8.3",
    region: "EU-West",
    device: "mobile",
  });
  assert.equal(result.deployment.commitSha, "a1843de");
  assert.equal(result.segment.estimatedLostPurchases, 48);
  assert.ok(Math.abs(result.segment.checkoutFailureRelativeChangePct - 36.641) < 0.001);
  assert.equal(incident.incidentId, "checkout-2026-07-20-1420");
  assert.equal(incident.finding.cause.version, "1.8.3");
  assert.deepEqual(incident.finding.affectedSegment, result.segment.segment);
  assert.equal(incident.views.length, 25);
  assert.equal(incident.segments.length, 24);
  assert.ok(Buffer.byteLength(JSON.stringify(incident)) < 500_000);

  const emptyFunnel = await queryFunnel(
    seededClient(funnelRows.map((row) => ({
      ...row,
      checkout_started: 0,
      payment_submitted: 0,
      purchase: 0,
    }))),
    analysisParams,
  );
  assert.equal(emptyFunnel.views[0]!.baseline[2]!.dropoffFromPrevious, 0);

  assert.throws(() => selectRootCause({ baseline, segments: segmentAnalysis }));
  assert.throws(() => selectRootCause({ baseline, funnel, segments: segmentAnalysis.slice(1) }));
  assert.throws(() => buildIncidentResult({ baseline, funnel }, {
    question: "Why did checkout conversion drop around 14:20?",
    service: "checkout",
    generatedAt: "2026-07-20T15:00:00Z",
  }));

  const contradiction = structuredClone(children);
  const contradictoryView = contradiction.funnel.views.find(({ segment }) => isAffected(segment))!;
  const contradictoryPurchase = contradictoryView.incident.find(({ key }) => key === "purchase")!;
  contradictoryPurchase.sessions = 328;
  contradictoryPurchase.completionFromStart = 328 / 459;
  contradictoryPurchase.dropoffFromPrevious = 1 - 328 / 459;
  assert.throws(() => selectRootCause(contradiction));

  const noise = structuredClone(children);
  const noisyCandidate = noise.segments.find(({ segment }) => isAffected(segment))!;
  const noisyView = noise.funnel.views.find(({ segment }) => isAffected(segment))!;
  const noisyPurchase = noisyView.incident.find(({ key }) => key === "purchase")!;
  noisyPurchase.sessions = 327;
  noisyPurchase.completionFromStart = 327 / 459;
  noisyPurchase.dropoffFromPrevious = 1 - 327 / 459;
  noisyCandidate.incidentConversionRate = 327 / 459;
  noisyCandidate.incidentFailureRate = 132 / 459;
  noisyCandidate.conversionRelativeChangePct =
    (noisyCandidate.incidentConversionRate / noisyCandidate.baselineConversionRate - 1) * 100;
  noisyCandidate.checkoutFailureRelativeChangePct =
    (noisyCandidate.incidentFailureRate / noisyCandidate.baselineFailureRate - 1) * 100;
  noisyCandidate.estimatedLostPurchases = 1;
  assert.throws(() => selectRootCause(noise));
});
