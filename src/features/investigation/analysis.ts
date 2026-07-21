import type { ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";

import {
  funnelSchema,
  segmentSchema,
  timelineSchema,
  timeRangeSchema,
  type Segment,
} from "./schema.ts";

const versions = ["1.8.2", "1.8.3"] as const;
const regions = ["AP-South", "EU-Central", "EU-West", "US-East"] as const;
const devices = ["desktop", "mobile", "tablet"] as const;

const analysisParamsSchema = z
  .object({
    service: z.string().trim().min(1).max(100),
    baseline: timeRangeSchema,
    incident: timeRangeSchema,
  })
  .strict()
  .superRefine(({ baseline, incident }, context) => {
    const baselineDuration = Date.parse(baseline.to) - Date.parse(baseline.from);
    const incidentDuration = Date.parse(incident.to) - Date.parse(incident.from);

    if (baselineDuration !== incidentDuration) {
      context.addIssue({ code: "custom", message: "analysis windows must have equal duration" });
    }
    if (Date.parse(baseline.to) > Date.parse(incident.from)) {
      context.addIssue({ code: "custom", message: "analysis windows must not overlap" });
    }
  });

const windowsSchema = z
  .object({
    baseline: timeRangeSchema,
    incident: timeRangeSchema,
    recovery: timeRangeSchema,
  })
  .strict();

const deploymentSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    version: z.enum(versions),
    commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
    region: z.string().trim().min(1).max(100),
  })
  .strict();

const timelineViewSchema = z
  .object({
    id: z.string().trim().min(1),
    segment: segmentSchema.nullable(),
    baseline: timelineSchema,
    incident: timelineSchema,
    recovery: timelineSchema,
  })
  .strict();

const funnelViewSchema = z
  .object({
    id: z.string().trim().min(1),
    segment: segmentSchema.nullable(),
    baseline: funnelSchema,
    incident: funnelSchema,
  })
  .strict();

function segmentId(segment: Segment) {
  return [segment.version, segment.region, segment.device].join("-");
}

function viewId(segment: Segment | null) {
  return segment ? `view-${segmentId(segment)}` : "all";
}

function validateViewSet(
  views: readonly { id: string; segment: Segment | null }[],
  context: z.RefinementCtx,
) {
  const ids = views.map(({ id }) => id);
  const segments = views.flatMap(({ segment }) => segment ? [segmentId(segment)] : []);

  if (new Set(ids).size !== 25 || !ids.includes("all")) {
    context.addIssue({ code: "custom", message: "analysis must contain all 25 views" });
  }
  if (new Set(segments).size !== 24) {
    context.addIssue({ code: "custom", message: "analysis must contain 24 unique segment views" });
  }
  views.forEach(({ id, segment }, index) => {
    if (id !== viewId(segment)) {
      context.addIssue({ code: "custom", message: "view ID must match its segment", path: [index, "id"] });
    }
  });
}

const timelineViewsSchema = z.array(timelineViewSchema).length(25).superRefine(validateViewSet);
const funnelViewsSchema = z.array(funnelViewSchema).length(25).superRefine(validateViewSet);

const baselineAnalysisSchema = z
  .object({
    windows: windowsSchema,
    views: timelineViewsSchema,
    deployments: z.array(deploymentSchema).min(2).max(10),
  })
  .strict();

const funnelAnalysisSchema = z
  .object({ views: funnelViewsSchema })
  .strict();

const segmentAnalysisRowSchema = z
  .object({
    id: z.string().trim().min(1),
    viewId: z.string().trim().min(1),
    segment: segmentSchema,
    sessions: z.number().int().positive(),
    baselineConversionRate: z.number().finite().positive().max(1),
    incidentConversionRate: z.number().finite().min(0).max(1),
    conversionRelativeChangePct: z.number().finite(),
    checkoutFailureRelativeChangePct: z.number().finite(),
    estimatedLostPurchases: z.number().finite().nonnegative(),
    baselineFailureRate: z.number().finite().positive().max(1),
    incidentFailureRate: z.number().finite().min(0).max(1),
    recoveryFailureRate: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((row, context) => {
    const conversionChange = (row.incidentConversionRate / row.baselineConversionRate - 1) * 100;
    const failureChange = (row.incidentFailureRate / row.baselineFailureRate - 1) * 100;
    if (
      Math.abs(row.conversionRelativeChangePct - conversionChange) > 0.001 ||
      Math.abs(row.checkoutFailureRelativeChangePct - failureChange) > 0.001
    ) {
      context.addIssue({ code: "custom", message: "segment relative changes must match their rates" });
    }
  });

function validateSegments(
  segments: readonly z.infer<typeof segmentAnalysisRowSchema>[],
  context: z.RefinementCtx,
) {
  const ids = segments.map(({ id }) => id);
  const keys = segments.map(({ segment }) => segmentId(segment));

  if (new Set(ids).size !== 24 || new Set(keys).size !== 24) {
    context.addIssue({ code: "custom", message: "segment analysis must contain 24 unique segments" });
  }
  segments.forEach(({ id, viewId: resultViewId, segment }, index) => {
    if (id !== segmentId(segment) || resultViewId !== viewId(segment)) {
      context.addIssue({ code: "custom", message: "segment IDs must match their dimensions", path: [index] });
    }
  });
}

const segmentAnalysisSchema = z
  .array(segmentAnalysisRowSchema)
  .length(24)
  .superRefine(validateSegments);

function funnelConversion(stages: z.infer<typeof funnelSchema>) {
  const checkoutStarts = stages.find(({ key }) => key === "checkout_started")!.sessions;
  const purchases = stages.find(({ key }) => key === "purchase")!.sessions;
  return { checkoutStarts, purchases, rate: checkoutStarts === 0 ? 0 : purchases / checkoutStarts };
}

function timelineConversion(points: z.infer<typeof timelineSchema>) {
  // ponytail: the seeded demo has one checkout per session; carry checkout counts if that changes.
  const sessions = points.reduce((total, point) => total + point.sessions, 0);
  return points.reduce((total, point) => total + point.conversionRate * point.sessions, 0) / sessions;
}

const childAnalysesSchema = z
  .object({
    baseline: baselineAnalysisSchema,
    funnel: funnelAnalysisSchema,
    segments: segmentAnalysisSchema,
  })
  .strict()
  .superRefine(({ baseline, funnel, segments }, context) => {
    const timelineIds = new Set(baseline.views.map(({ id }) => id));
    const funnelIds = new Set(funnel.views.map(({ id }) => id));

    if (timelineIds.size !== funnelIds.size || [...timelineIds].some((id) => !funnelIds.has(id))) {
      context.addIssue({ code: "custom", message: "timeline and funnel views must match" });
    }
    if (segments.some(({ viewId: resultViewId }) => !timelineIds.has(resultViewId))) {
      context.addIssue({ code: "custom", message: "every segment must reference a precomputed view" });
    }
    const aggregateTimeline = baseline.views.find(({ id }) => id === "all")!;
    const aggregateFunnel = funnel.views.find(({ id }) => id === "all")!;
    if (
      Math.abs(timelineConversion(aggregateTimeline.baseline) - funnelConversion(aggregateFunnel.baseline).rate) > 0.001 ||
      Math.abs(timelineConversion(aggregateTimeline.incident) - funnelConversion(aggregateFunnel.incident).rate) > 0.001
    ) {
      context.addIssue({ code: "custom", message: "aggregate timeline and funnel evidence must agree" });
    }
    segments.forEach((segment, index) => {
      const view = funnel.views.find(({ id }) => id === segment.viewId);
      if (!view) return;
      const baseline = funnelConversion(view.baseline);
      const incident = funnelConversion(view.incident);
      const expectedImpact = Math.max(
        segment.baselineConversionRate * incident.checkoutStarts - incident.purchases,
        0,
      );
      if (
        Math.abs(segment.baselineConversionRate - baseline.rate) > 0.001 ||
        Math.abs(segment.incidentConversionRate - incident.rate) > 0.001 ||
        Math.abs(segment.baselineFailureRate - (1 - baseline.rate)) > 0.001 ||
        Math.abs(segment.incidentFailureRate - (1 - incident.rate)) > 0.001 ||
        Math.abs(segment.estimatedLostPurchases - expectedImpact) > 0.001
      ) {
        context.addIssue({ code: "custom", message: "segment and funnel evidence must agree", path: ["segments", index] });
      }
    });
  });

const scopeShape = {
  scope_mask: z.union([z.literal(0), z.literal(7)]),
  result_version: z.enum(versions).nullable(),
  result_region: z.enum(regions).nullable(),
  result_device: z.enum(devices).nullable(),
};

function validateScope(
  row: { scope_mask: 0 | 7; result_version: string | null; result_region: string | null; result_device: string | null },
  context: z.RefinementCtx,
) {
  const values = [row.result_version, row.result_region, row.result_device];
  if (row.scope_mask === 7 ? values.some((value) => value !== null) : values.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "query scope columns are inconsistent" });
  }
}

const timelineRowSchema = z
  .object({
    ...scopeShape,
    period: z.enum(["baseline", "incident", "recovery"]),
    at: z.string().datetime({ offset: true }),
    session_count: z.number().int().positive(),
    checkout_count: z.number().int().positive(),
    error_count: z.number().int().nonnegative(),
    purchase_count: z.number().int().nonnegative(),
    p95_latency_ms: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine(validateScope);

const funnelRowSchema = z
  .object({
    ...scopeShape,
    period: z.enum(["baseline", "incident"]),
    cart: z.number().int().positive(),
    checkout_started: z.number().int().nonnegative(),
    payment_submitted: z.number().int().nonnegative(),
    purchase: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((row, context) => {
    validateScope(row, context);
    if (
      row.checkout_started > row.cart ||
      row.payment_submitted > row.checkout_started ||
      row.purchase > row.payment_submitted
    ) {
      context.addIssue({ code: "custom", message: "funnel counts must not increase" });
    }
  });

const segmentRowSchema = z
  .object({
    version: z.enum(versions),
    region: z.enum(regions),
    device: z.enum(devices),
    incident_sessions: z.number().int().positive(),
    baseline_starts: z.number().int().positive(),
    baseline_errors: z.number().int().positive(),
    baseline_purchases: z.number().int().positive(),
    incident_starts: z.number().int().positive(),
    incident_errors: z.number().int().positive(),
    incident_purchases: z.number().int().nonnegative(),
    recovery_starts: z.number().int().positive(),
    recovery_errors: z.number().int().nonnegative(),
  })
  .strict();

const deploymentRowSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    version: z.enum(versions),
    commit_sha: z.string().regex(/^[a-f0-9]{7,40}$/i),
    region: z.string().trim().min(1).max(100),
  })
  .strict();

const timelineQuery = `
SELECT
    multiIf(
        minute < {baseline_to:DateTime('UTC')}, 'baseline',
        minute < {incident_to:DateTime('UTC')}, 'incident',
        'recovery'
    ) AS period,
    formatDateTime(minute, '%FT%TZ', 'UTC') AS at,
    toUInt8(grouping(version, region, device)) AS scope_mask,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), version) AS result_version,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), region) AS result_region,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), device) AS result_device,
    toUInt32(uniqExactMerge(sessions)) AS session_count,
    toUInt32(sumMerge(checkout_starts)) AS checkout_count,
    toUInt32(sumMerge(errors)) AS error_count,
    toUInt32(sumMerge(purchases)) AS purchase_count,
    quantileExactMerge(0.95)(p95_latency_ms) AS p95_latency_ms
FROM minute_metrics
WHERE service = {service:String}
    AND (
        (minute >= {baseline_from:DateTime('UTC')} AND minute < {baseline_to:DateTime('UTC')})
        OR (minute >= {incident_from:DateTime('UTC')} AND minute < {recovery_to:DateTime('UTC')})
    )
GROUP BY GROUPING SETS
(
    (period, minute),
    (period, minute, version, region, device)
)
ORDER BY at, scope_mask DESC, result_version, result_region, result_device`;

const deploymentsQuery = `
SELECT
    formatDateTime(timestamp, '%FT%TZ', 'UTC') AS at,
    version,
    commit_sha,
    region
FROM deployments
WHERE service = {service:String}
    AND timestamp >= {baseline_from:DateTime('UTC')}
    AND timestamp <= {incident_to:DateTime('UTC')}
ORDER BY timestamp`;

const funnelQuery = `
SELECT
    period,
    toUInt8(grouping(version, region, device)) AS scope_mask,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), version) AS result_version,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), region) AS result_region,
    if(scope_mask = 7, CAST(NULL AS Nullable(String)), device) AS result_device,
    toUInt32(countIf(level >= 1)) AS cart,
    toUInt32(countIf(level >= 2)) AS checkout_started,
    toUInt32(countIf(level >= 3)) AS payment_submitted,
    toUInt32(countIf(level >= 4)) AS purchase
FROM
(
    SELECT
        if(timestamp < {baseline_to:DateTime('UTC')}, 'baseline', 'incident') AS period,
        version,
        region,
        device,
        session_id,
        windowFunnel(30)(
            timestamp,
            event_name = 'cart',
            event_name = 'checkout_started',
            event_name = 'payment_submitted',
            event_name = 'purchase'
        ) AS level
    FROM events
    WHERE service = {service:String}
        AND (
            (timestamp >= {baseline_from:DateTime('UTC')} AND timestamp < {baseline_to:DateTime('UTC')})
            OR (timestamp >= {incident_from:DateTime('UTC')} AND timestamp < {incident_to:DateTime('UTC')})
        )
    GROUP BY period, version, region, device, session_id
)
GROUP BY GROUPING SETS
(
    (period),
    (period, version, region, device)
)
ORDER BY period, scope_mask DESC, result_version, result_region, result_device`;

const segmentsQuery = `
SELECT
    version,
    region,
    device,
    toUInt32(uniqExactMergeIf(
        sessions,
        minute >= {incident_from:DateTime('UTC')} AND minute < {incident_to:DateTime('UTC')}
    )) AS incident_sessions,
    toUInt32(sumMergeIf(
        checkout_starts,
        minute >= {baseline_from:DateTime('UTC')} AND minute < {baseline_to:DateTime('UTC')}
    )) AS baseline_starts,
    toUInt32(sumMergeIf(
        errors,
        minute >= {baseline_from:DateTime('UTC')} AND minute < {baseline_to:DateTime('UTC')}
    )) AS baseline_errors,
    toUInt32(sumMergeIf(
        purchases,
        minute >= {baseline_from:DateTime('UTC')} AND minute < {baseline_to:DateTime('UTC')}
    )) AS baseline_purchases,
    toUInt32(sumMergeIf(
        checkout_starts,
        minute >= {incident_from:DateTime('UTC')} AND minute < {incident_to:DateTime('UTC')}
    )) AS incident_starts,
    toUInt32(sumMergeIf(
        errors,
        minute >= {incident_from:DateTime('UTC')} AND minute < {incident_to:DateTime('UTC')}
    )) AS incident_errors,
    toUInt32(sumMergeIf(
        purchases,
        minute >= {incident_from:DateTime('UTC')} AND minute < {incident_to:DateTime('UTC')}
    )) AS incident_purchases,
    toUInt32(sumMergeIf(
        checkout_starts,
        minute >= {incident_to:DateTime('UTC')} AND minute < {recovery_to:DateTime('UTC')}
    )) AS recovery_starts,
    toUInt32(sumMergeIf(
        errors,
        minute >= {incident_to:DateTime('UTC')} AND minute < {recovery_to:DateTime('UTC')}
    )) AS recovery_errors
FROM minute_metrics
WHERE service = {service:String}
    AND (
        (minute >= {baseline_from:DateTime('UTC')} AND minute < {baseline_to:DateTime('UTC')})
        OR (minute >= {incident_from:DateTime('UTC')} AND minute < {recovery_to:DateTime('UTC')})
    )
GROUP BY version, region, device
ORDER BY version, region, device`;

type QueryParameters = Record<string, unknown>;
type TimelinePoint = z.infer<typeof timelineSchema>[number];
type Funnel = z.infer<typeof funnelSchema>;

export type AnalysisParams = z.input<typeof analysisParamsSchema>;
export type BaselineAnalysis = z.infer<typeof baselineAnalysisSchema>;
export type FunnelAnalysis = z.infer<typeof funnelAnalysisSchema>;
export type SegmentAnalysis = z.infer<typeof segmentAnalysisSchema>;

function prepareAnalysis(input: AnalysisParams) {
  const parsed = analysisParamsSchema.parse(input);
  const baselineFrom = new Date(parsed.baseline.from);
  const baselineTo = new Date(parsed.baseline.to);
  const incidentFrom = new Date(parsed.incident.from);
  const incidentTo = new Date(parsed.incident.to);
  const recoveryTo = new Date(incidentTo.getTime() + incidentTo.getTime() - incidentFrom.getTime());
  const recovery = { from: incidentTo.toISOString(), to: recoveryTo.toISOString() };

  return {
    windows: windowsSchema.parse({ baseline: parsed.baseline, incident: parsed.incident, recovery }),
    queryParams: {
      service: parsed.service,
      baseline_from: baselineFrom,
      baseline_to: baselineTo,
      incident_from: incidentFrom,
      incident_to: incidentTo,
      recovery_to: recoveryTo,
    } satisfies QueryParameters,
  };
}

async function queryRows<Output>(
  client: ClickHouseClient,
  query: string,
  queryParams: QueryParameters,
  schema: z.ZodType<Output>,
) {
  const result = await client.query({ query, query_params: queryParams, format: "JSONEachRow" });
  return z.array(schema).parse(await result.json());
}

function scopeFromRow(row: z.infer<typeof timelineRowSchema> | z.infer<typeof funnelRowSchema>) {
  if (row.scope_mask === 7) return null;
  return segmentSchema.parse({
    version: row.result_version,
    region: row.result_region,
    device: row.result_device,
  });
}

function buildTimelineViews(rows: readonly z.infer<typeof timelineRowSchema>[]) {
  const views = new Map<string, {
    id: string;
    segment: Segment | null;
    baseline: TimelinePoint[];
    incident: TimelinePoint[];
    recovery: TimelinePoint[];
  }>();

  for (const row of rows) {
    const segment = scopeFromRow(row);
    const id = viewId(segment);
    const view = views.get(id) ?? { id, segment, baseline: [], incident: [], recovery: [] };
    view[row.period].push({
      at: row.at,
      sessions: row.session_count,
      conversionRate: row.purchase_count / row.checkout_count,
      errorRate: row.error_count / row.checkout_count,
      p95LatencyMs: row.p95_latency_ms,
    });
    views.set(id, view);
  }

  return timelineViewsSchema.parse([...views.values()]);
}

const funnelStages = [
  ["cart", "Cart"],
  ["checkout_started", "Checkout started"],
  ["payment_submitted", "Payment submitted"],
  ["purchase", "Purchase"],
] as const;

function buildFunnel(row: z.infer<typeof funnelRowSchema>): Funnel {
  const counts = [row.cart, row.checkout_started, row.payment_submitted, row.purchase];
  return funnelSchema.parse(funnelStages.map(([key, label], index) => ({
    key,
    label,
    sessions: counts[index]!,
    completionFromStart: counts[index]! / counts[0]!,
    dropoffFromPrevious: index === 0 || counts[index - 1] === 0
      ? 0
      : 1 - counts[index]! / counts[index - 1]!,
  })));
}

function buildFunnelViews(rows: readonly z.infer<typeof funnelRowSchema>[]) {
  const views = new Map<string, {
    id: string;
    segment: Segment | null;
    baseline?: Funnel;
    incident?: Funnel;
  }>();

  for (const row of rows) {
    const segment = scopeFromRow(row);
    const id = viewId(segment);
    const view = views.get(id) ?? { id, segment };
    view[row.period] = buildFunnel(row);
    views.set(id, view);
  }

  return funnelViewsSchema.parse([...views.values()]);
}

export async function queryBaseline(client: ClickHouseClient, input: AnalysisParams): Promise<BaselineAnalysis> {
  const { windows, queryParams } = prepareAnalysis(input);
  const [timelineRows, deploymentRows] = await Promise.all([
    queryRows(client, timelineQuery, queryParams, timelineRowSchema),
    queryRows(client, deploymentsQuery, queryParams, deploymentRowSchema),
  ]);

  return baselineAnalysisSchema.parse({
    windows,
    views: buildTimelineViews(timelineRows),
    deployments: deploymentRows.map(({ commit_sha: commitSha, ...deployment }) => ({ ...deployment, commitSha })),
  });
}

export async function queryFunnel(client: ClickHouseClient, input: AnalysisParams): Promise<FunnelAnalysis> {
  const { queryParams } = prepareAnalysis(input);
  const rows = await queryRows(client, funnelQuery, queryParams, funnelRowSchema);
  return funnelAnalysisSchema.parse({ views: buildFunnelViews(rows) });
}

export async function querySegments(client: ClickHouseClient, input: AnalysisParams): Promise<SegmentAnalysis> {
  const { queryParams } = prepareAnalysis(input);
  const rows = await queryRows(client, segmentsQuery, queryParams, segmentRowSchema);
  const segments = rows.map((row) => {
    const segment = segmentSchema.parse({
      version: row.version,
      region: row.region,
      device: row.device,
    });
    const baselineConversionRate = row.baseline_purchases / row.baseline_starts;
    const incidentConversionRate = row.incident_purchases / row.incident_starts;
    const baselineFailureRate = row.baseline_errors / row.baseline_starts;
    const incidentFailureRate = row.incident_errors / row.incident_starts;

    return {
      id: segmentId(segment),
      viewId: viewId(segment),
      segment,
      sessions: row.incident_sessions,
      baselineConversionRate,
      incidentConversionRate,
      conversionRelativeChangePct: (incidentConversionRate / baselineConversionRate - 1) * 100,
      checkoutFailureRelativeChangePct: (incidentFailureRate / baselineFailureRate - 1) * 100,
      estimatedLostPurchases: Math.max(baselineConversionRate * row.incident_starts - row.incident_purchases, 0),
      baselineFailureRate,
      incidentFailureRate,
      recoveryFailureRate: row.recovery_errors / row.recovery_starts,
    };
  });

  return segmentAnalysisSchema.parse(segments);
}

export function selectRootCause(input: unknown) {
  const analyses = childAnalysesSchema.parse(input);
  const aggregateFunnel = analyses.funnel.views.find(({ id }) => id === "all")!;
  const aggregateBaseline = funnelConversion(aggregateFunnel.baseline).rate;
  const aggregateIncident = funnelConversion(aggregateFunnel.incident).rate;
  const candidate = [...analyses.segments]
    .sort((left, right) =>
      right.estimatedLostPurchases - left.estimatedLostPurchases || left.id.localeCompare(right.id),
    )[0];

  if (
    !candidate ||
    aggregateIncident >= aggregateBaseline ||
    candidate.estimatedLostPurchases <= 0 ||
    candidate.conversionRelativeChangePct >= 0 ||
    candidate.checkoutFailureRelativeChangePct <= 0 ||
    candidate.baselineConversionRate - candidate.incidentConversionRate <= 0.01 ||
    candidate.incidentFailureRate - candidate.baselineFailureRate <= 0.01 ||
    Math.abs(candidate.recoveryFailureRate - candidate.baselineFailureRate) > 0.01
  ) {
    throw new Error("analysis does not support a recovered segment regression");
  }

  const incidentStart = Date.parse(analyses.baseline.windows.incident.from);
  const rollbackAt = Date.parse(analyses.baseline.windows.incident.to);
  const deployment = analyses.baseline.deployments
    .filter(({ at, version }) => version === candidate.segment.version && Date.parse(at) < incidentStart)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
  const rollback = analyses.baseline.deployments.find(({ at, version }) =>
    version !== candidate.segment.version && Date.parse(at) === rollbackAt,
  );

  if (!deployment || !rollback) {
    throw new Error("analysis does not support deployment attribution");
  }

  return { segment: candidate, deployment };
}
