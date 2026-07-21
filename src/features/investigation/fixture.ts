import {
  incidentResultSchema,
  type IncidentResult,
  type IncidentResultInput,
  type Segment,
} from "./schema.ts";

type IncidentViewInput = IncidentResultInput["views"][number];
type FunnelInput = IncidentViewInput["funnel"]["baseline"];
type TimelineInput = IncidentViewInput["timeline"];

const versions = ["1.8.2", "1.8.3"] as const;
const regions = ["AP-South", "EU-Central", "EU-West", "US-East"] as const;
const devices = ["desktop", "mobile", "tablet"] as const;

const affectedSegment: Segment = {
  version: "1.8.3",
  region: "EU-West",
  device: "mobile",
};

const baselineFunnel = [
  { key: "cart", label: "Cart", sessions: 1200, completionFromStart: 1, dropoffFromPrevious: 0 },
  { key: "checkout_started", label: "Checkout started", sessions: 1000, completionFromStart: 0.833, dropoffFromPrevious: 0.167 },
  { key: "payment_submitted", label: "Payment submitted", sessions: 800, completionFromStart: 0.667, dropoffFromPrevious: 0.2 },
  { key: "purchase", label: "Purchase", sessions: 720, completionFromStart: 0.6, dropoffFromPrevious: 0.1 },
] satisfies FunnelInput;

const stableIncidentFunnel = [
  { key: "cart", label: "Cart", sessions: 1210, completionFromStart: 1, dropoffFromPrevious: 0 },
  { key: "checkout_started", label: "Checkout started", sessions: 1008, completionFromStart: 0.833, dropoffFromPrevious: 0.167 },
  { key: "payment_submitted", label: "Payment submitted", sessions: 803, completionFromStart: 0.664, dropoffFromPrevious: 0.203 },
  { key: "purchase", label: "Purchase", sessions: 718, completionFromStart: 0.593, dropoffFromPrevious: 0.106 },
] satisfies FunnelInput;

const affectedIncidentFunnel = [
  { key: "cart", label: "Cart", sessions: 1200, completionFromStart: 1, dropoffFromPrevious: 0 },
  { key: "checkout_started", label: "Checkout started", sessions: 1000, completionFromStart: 0.833, dropoffFromPrevious: 0.167 },
  { key: "payment_submitted", label: "Payment submitted", sessions: 780, completionFromStart: 0.65, dropoffFromPrevious: 0.22 },
  { key: "purchase", label: "Purchase", sessions: 616, completionFromStart: 0.513, dropoffFromPrevious: 0.21 },
] satisfies FunnelInput;

const aggregateIncidentFunnel = [
  { key: "cart", label: "Cart", sessions: 1210, completionFromStart: 1, dropoffFromPrevious: 0 },
  { key: "checkout_started", label: "Checkout started", sessions: 1008, completionFromStart: 0.833, dropoffFromPrevious: 0.167 },
  { key: "payment_submitted", label: "Payment submitted", sessions: 796, completionFromStart: 0.658, dropoffFromPrevious: 0.21 },
  { key: "purchase", label: "Purchase", sessions: 684, completionFromStart: 0.565, dropoffFromPrevious: 0.141 },
] satisfies FunnelInput;

const stableTimeline = [
  { at: "2026-07-20T13:50:00Z", sessions: 180, conversionRate: 0.72, errorRate: 0.04, p95LatencyMs: 220 },
  { at: "2026-07-20T14:17:00Z", sessions: 184, conversionRate: 0.71, errorRate: 0.04, p95LatencyMs: 225 },
  { at: "2026-07-20T14:20:00Z", sessions: 181, conversionRate: 0.71, errorRate: 0.05, p95LatencyMs: 230 },
  { at: "2026-07-20T14:35:00Z", sessions: 186, conversionRate: 0.7, errorRate: 0.05, p95LatencyMs: 235 },
  { at: "2026-07-20T14:47:00Z", sessions: 179, conversionRate: 0.71, errorRate: 0.04, p95LatencyMs: 225 },
] satisfies TimelineInput;

const affectedTimeline = [
  { at: "2026-07-20T13:50:00Z", sessions: 180, conversionRate: 0.72, errorRate: 0.04, p95LatencyMs: 220 },
  { at: "2026-07-20T14:17:00Z", sessions: 184, conversionRate: 0.72, errorRate: 0.04, p95LatencyMs: 225 },
  { at: "2026-07-20T14:20:00Z", sessions: 181, conversionRate: 0.616, errorRate: 0.055, p95LatencyMs: 420 },
  { at: "2026-07-20T14:35:00Z", sessions: 186, conversionRate: 0.61, errorRate: 0.055, p95LatencyMs: 460 },
  { at: "2026-07-20T14:47:00Z", sessions: 179, conversionRate: 0.69, errorRate: 0.042, p95LatencyMs: 260 },
] satisfies TimelineInput;

const aggregateTimeline = [
  { at: "2026-07-20T13:50:00Z", sessions: 4320, conversionRate: 0.72, errorRate: 0.04, p95LatencyMs: 220 },
  { at: "2026-07-20T14:17:00Z", sessions: 4416, conversionRate: 0.71, errorRate: 0.04, p95LatencyMs: 225 },
  { at: "2026-07-20T14:20:00Z", sessions: 4344, conversionRate: 0.68, errorRate: 0.045, p95LatencyMs: 245 },
  { at: "2026-07-20T14:35:00Z", sessions: 4464, conversionRate: 0.67, errorRate: 0.046, p95LatencyMs: 255 },
  { at: "2026-07-20T14:47:00Z", sessions: 4296, conversionRate: 0.7, errorRate: 0.041, p95LatencyMs: 230 },
] satisfies TimelineInput;

const segments = versions.flatMap((version) =>
  regions.flatMap((region) =>
    devices.map((device) => ({ version, region, device } satisfies Segment)),
  ),
);

function isAffected(segment: Segment) {
  return (
    segment.version === affectedSegment.version &&
    segment.region === affectedSegment.region &&
    segment.device === affectedSegment.device
  );
}

function segmentId(segment: Segment) {
  return `${segment.version}-${segment.region}-${segment.device}`;
}

const segmentDeltas = segments.map((segment) => {
  const affected = isAffected(segment);
  return {
    id: segmentId(segment),
    segment,
    viewId: `view-${segmentId(segment)}`,
    sessions: affected ? 4500 : 3200,
    baselineConversionRate: 0.72,
    incidentConversionRate: affected ? 0.616 : 0.718,
    conversionRelativeChangePct: affected ? -14.4 : -0.3,
    checkoutFailureRelativeChangePct: affected ? 37 : 0.6,
  };
});

const segmentViews = segmentDeltas.map(({ segment, viewId }) => {
  const affected = isAffected(segment);
  return {
    id: viewId,
    label: [segment.version, segment.region, segment.device].join(" / "),
    filter: segment,
    timeline: affected ? affectedTimeline : stableTimeline,
    funnel: {
      baseline: baselineFunnel,
      incident: affected ? affectedIncidentFunnel : stableIncidentFunnel,
    },
  };
});

const fixtureInput = {
  schemaVersion: 1,
  incidentId: "checkout-2026-07-20-1420",
  question: "Why did checkout conversion drop around 14:20?",
  service: "checkout",
  generatedAt: "2026-07-20T15:00:00Z",
  timezone: "UTC",
  windows: {
    baseline: { from: "2026-07-20T13:50:00Z", to: "2026-07-20T14:17:00Z" },
    incident: { from: "2026-07-20T14:20:00Z", to: "2026-07-20T14:47:00Z" },
  },
  finding: {
    headline: "Release 1.8.3 caused a 37% checkout failure increase for mobile users in EU-West.",
    confidence: "high",
    cause: {
      kind: "deployment",
      version: "1.8.3",
      commitSha: "a1843de",
      deployedAt: "2026-07-20T14:18:00Z",
    },
    affectedSegment,
    conversionRelativeChangePct: -14.4,
    checkoutFailureRelativeChangePct: 37,
  },
  markers: [
    { kind: "deployment", at: "2026-07-20T14:18:00Z", label: "Deploy 1.8.3" },
    { kind: "incident_start", at: "2026-07-20T14:20:00Z", label: "Incident starts" },
    { kind: "rollback", at: "2026-07-20T14:47:00Z", label: "Rollback to 1.8.2" },
  ],
  defaultViewId: "all",
  views: [
    {
      id: "all",
      label: "All checkout traffic",
      filter: {},
      timeline: aggregateTimeline,
      funnel: { baseline: baselineFunnel, incident: aggregateIncidentFunnel },
    },
    ...segmentViews,
  ],
  segments: segmentDeltas,
} satisfies IncidentResultInput;

export const incidentFixture: IncidentResult = incidentResultSchema.parse(fixtureInput);
