import { z } from "zod";

export type InvestigationIntent = Readonly<{ device?: "mobile" }>;

export function classifyInvestigationQuestion(input: string): InvestigationIntent | null {
  const question = input.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (question === "show only mobile traffic") {
    return { device: "mobile" };
  }
  if (question === "why did checkout conversion drop around 14:20") {
    return {};
  }
  return null;
}

export const investigationQuestionSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((question) => classifyInvestigationQuestion(question) !== null, {
    message: "ask about the seeded checkout incident or filter it to mobile traffic",
  });

const idSchema = z.string().trim().min(1).max(100);
const labelSchema = z.string().trim().min(1).max(160);
const timestampSchema = z.string().datetime({ offset: true });
const rateSchema = z.number().finite().min(0).max(1);
const countSchema = z.number().int().nonnegative();
const percentageSchema = z.number().finite();

export const investigationProgressSchema = z
  .object({
    label: z.enum([
      "Comparing baseline",
      "Reconstructing funnel",
      "Scanning 24 segments",
      "Rendering incident",
    ]),
    status: z.enum(["running", "complete", "failed"]),
  })
  .strict();

export const timeRangeSchema = z
  .object({
    from: timestampSchema,
    to: timestampSchema,
  })
  .strict()
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to), {
    message: "from must be earlier than to",
    path: ["to"],
  });

export const segmentSchema = z
  .object({
    version: idSchema,
    region: idSchema,
    device: z.enum(["desktop", "mobile", "tablet"]),
  })
  .strict();

const segmentFilterSchema = segmentSchema.partial();

const timelinePointSchema = z
  .object({
    at: timestampSchema,
    sessions: countSchema,
    conversionRate: rateSchema,
    errorRate: rateSchema,
    p95LatencyMs: z.number().finite().nonnegative(),
  })
  .strict();

export const timelineSchema = z
  .array(timelinePointSchema)
  .min(2)
  .max(180)
  .refine(
    (points) => points.every((point, index) =>
      index === 0 || Date.parse(points[index - 1]!.at) < Date.parse(point.at),
    ),
    "timeline points must be in chronological order",
  );

const funnelStageSchema = z
  .object({
    key: z.enum(["cart", "checkout_started", "payment_submitted", "purchase"]),
    label: labelSchema,
    sessions: countSchema,
    completionFromStart: rateSchema,
    dropoffFromPrevious: rateSchema,
  })
  .strict();

export const funnelSchema = z
  .array(funnelStageSchema)
  .length(4)
  .superRefine((stages, context) => {
    const expectedKeys = ["cart", "checkout_started", "payment_submitted", "purchase"] as const;
    const firstSessions = stages[0]?.sessions ?? 0;

    stages.forEach((stage, index) => {
      const previous = stages[index - 1];
      if (stage.key !== expectedKeys[index]) {
        context.addIssue({ code: "custom", message: "funnel stages must use canonical order", path: [index, "key"] });
      }
      if (previous && stage.sessions > previous.sessions) {
        context.addIssue({ code: "custom", message: "funnel sessions must not increase", path: [index, "sessions"] });
      }
      if (firstSessions > 0 && Math.abs(stage.completionFromStart - stage.sessions / firstSessions) > 0.001) {
        context.addIssue({ code: "custom", message: "completion rate must match sessions", path: [index, "completionFromStart"] });
      }
      const expectedDropoff = previous && previous.sessions > 0
        ? 1 - stage.sessions / previous.sessions
        : 0;
      if (Math.abs(stage.dropoffFromPrevious - expectedDropoff) > 0.001) {
        context.addIssue({ code: "custom", message: "drop-off rate must match sessions", path: [index, "dropoffFromPrevious"] });
      }
    });
  });

const incidentViewSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    filter: segmentFilterSchema,
    timeline: timelineSchema,
    funnel: z
      .object({
        baseline: funnelSchema,
        incident: funnelSchema,
      })
      .strict(),
  })
  .strict();

const segmentDeltaSchema = z
  .object({
    id: idSchema,
    segment: segmentSchema,
    viewId: idSchema,
    sessions: countSchema,
    baselineConversionRate: rateSchema,
    incidentConversionRate: rateSchema,
    conversionRelativeChangePct: percentageSchema,
    checkoutFailureRelativeChangePct: percentageSchema,
  })
  .strict();

const markerSchema = z
  .object({
    kind: z.enum(["deployment", "incident_start", "rollback"]),
    at: timestampSchema,
    label: labelSchema,
  })
  .strict();

const findingSchema = z
  .object({
    headline: z.string().trim().min(1).max(240),
    confidence: z.enum(["high", "medium", "low"]),
    cause: z
      .object({
        kind: z.literal("deployment"),
        version: idSchema,
        commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
        deployedAt: timestampSchema,
      })
      .strict(),
    affectedSegment: segmentSchema,
    conversionRelativeChangePct: percentageSchema,
    checkoutFailureRelativeChangePct: percentageSchema,
  })
  .strict();

const incidentResultBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    incidentId: idSchema,
    question: z.string().trim().min(1).max(500),
    service: idSchema,
    generatedAt: timestampSchema,
    timezone: z.literal("UTC"),
    windows: z
      .object({
        baseline: timeRangeSchema,
        incident: timeRangeSchema,
      })
      .strict(),
    finding: findingSchema,
    markers: z.array(markerSchema).min(3).max(10),
    defaultViewId: idSchema,
    views: z.array(incidentViewSchema).min(1).max(32),
    segments: z.array(segmentDeltaSchema).length(24),
  })
  .strict();

function validateReferences(
  result: z.infer<typeof incidentResultBaseSchema>,
  context: z.RefinementCtx,
) {
  const viewIds = result.views.map(({ id }) => id);
  const knownViews = new Set(viewIds);
  const segmentIds = result.segments.map(({ id }) => id);
  const segmentKeys = result.segments.map(({ segment }) =>
    [segment.version, segment.region, segment.device].join("|"),
  );

  if (knownViews.size !== viewIds.length) {
    context.addIssue({ code: "custom", message: "view IDs must be unique", path: ["views"] });
  }
  if (!knownViews.has(result.defaultViewId)) {
    context.addIssue({ code: "custom", message: "defaultViewId must reference a view", path: ["defaultViewId"] });
  }
  result.segments.forEach(({ segment, viewId }, index) => {
    const view = result.views.find(({ id }) => id === viewId);
    if (!view) {
      context.addIssue({ code: "custom", message: "viewId must reference a view", path: ["segments", index, "viewId"] });
    } else if (
      view.filter.version !== segment.version ||
      view.filter.region !== segment.region ||
      view.filter.device !== segment.device
    ) {
      context.addIssue({ code: "custom", message: "view filter must match segment", path: ["segments", index, "viewId"] });
    }
  });
  if (new Set(segmentKeys).size !== segmentKeys.length) {
    context.addIssue({ code: "custom", message: "segments must be unique", path: ["segments"] });
  }
  if (new Set(segmentIds).size !== segmentIds.length) {
    context.addIssue({ code: "custom", message: "segment IDs must be unique", path: ["segments"] });
  }
  const affectedKey = [
    result.finding.affectedSegment.version,
    result.finding.affectedSegment.region,
    result.finding.affectedSegment.device,
  ].join("|");
  if (!segmentKeys.includes(affectedKey)) {
    context.addIssue({ code: "custom", message: "affectedSegment must be scanned", path: ["finding", "affectedSegment"] });
  }
  if (result.finding.cause.version !== result.finding.affectedSegment.version) {
    context.addIssue({ code: "custom", message: "cause version must match affected segment", path: ["finding", "cause", "version"] });
  }
}

function validateMarkers(
  result: z.infer<typeof incidentResultBaseSchema>,
  context: z.RefinementCtx,
) {
  const markerKinds = new Set(result.markers.map(({ kind }) => kind));
  for (const kind of ["deployment", "incident_start", "rollback"] as const) {
    if (!markerKinds.has(kind)) {
      context.addIssue({ code: "custom", message: `missing ${kind} marker`, path: ["markers"] });
    }
  }
}

export const incidentResultSchema = incidentResultBaseSchema
  .superRefine(validateReferences)
  .superRefine(validateMarkers);

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

export type IncidentResult = DeepReadonly<z.infer<typeof incidentResultSchema>>;
export type IncidentResultInput = z.input<typeof incidentResultSchema>;
export type InvestigationProgress = z.infer<typeof investigationProgressSchema>;
export type Segment = DeepReadonly<z.infer<typeof segmentSchema>>;
