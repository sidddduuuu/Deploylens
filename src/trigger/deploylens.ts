import { anthropic } from "@ai-sdk/anthropic";
import { batch, schemaTask } from "@trigger.dev/sdk";
import { ai, chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool, type InferUITools, type UIMessage } from "ai";
import { z } from "zod";

import {
  analysisParamsSchema,
  buildIncidentResult,
  queryBaseline,
  queryFunnel,
  querySegments,
} from "../features/investigation/analysis.ts";
import {
  incidentResultSchema,
  type IncidentResult,
  type InvestigationProgress,
} from "../features/investigation/schema.ts";
import { withClickHouse } from "../lib/clickhouse.ts";

const checkoutAnalysisSchema = analysisParamsSchema.refine(
  ({ service }) => service === "checkout",
  "only the checkout service is supported",
);

const investigationInputSchema = z
  .object({
    metric: z.literal("checkout_conversion"),
    question: z.string().trim().min(1).max(500),
    analysis: checkoutAnalysisSchema,
  })
  .strict();

export const baselineTask = schemaTask({
  id: "deploylens-baseline",
  schema: analysisParamsSchema,
  run: (payload) => withClickHouse((client) => queryBaseline(client, payload)),
});

export const funnelTask = schemaTask({
  id: "deploylens-funnel",
  schema: analysisParamsSchema,
  run: (payload) => withClickHouse((client) => queryFunnel(client, payload)),
});

export const segmentTask = schemaTask({
  id: "deploylens-segments",
  schema: analysisParamsSchema,
  run: (payload) => withClickHouse((client) => querySegments(client, payload)),
});

type ProgressKey = "baseline" | "funnel" | "segments" | "render";
type ProgressUpdate = InvestigationProgress & { key: ProgressKey };

const analysisStarted = [
  { key: "baseline", label: "Comparing baseline", status: "running" },
  { key: "funnel", label: "Reconstructing funnel", status: "running" },
  { key: "segments", label: "Scanning 24 segments", status: "running" },
] as const satisfies readonly ProgressUpdate[];

const analysisFailed = [
  { key: "baseline", label: "Comparing baseline", status: "failed" },
  { key: "funnel", label: "Reconstructing funnel", status: "failed" },
  { key: "segments", label: "Scanning 24 segments", status: "failed" },
  { key: "render", label: "Rendering incident", status: "failed" },
] as const satisfies readonly ProgressUpdate[];

type ChildResult<Output> =
  | { ok: true; output: Output }
  | { ok: false; error: unknown };

async function writeProgress(toolCallId: string, updates: readonly ProgressUpdate[]) {
  if (!ai.chatContext()) return;

  const { waitUntilComplete } = chat.stream.writer({
    target: "root",
    execute: ({ write }) => {
      for (const { key, label, status } of updates) {
        write({ type: "data-progress", id: `${toolCallId}:${key}`, data: { label, status } });
      }
    },
  });
  await waitUntilComplete();
}

export function childOutput<Output>(name: string, result: ChildResult<Output>): Output {
  if (!result.ok) throw new Error(`${name} analysis failed`, { cause: result.error });
  return result.output;
}

export const investigateIncidentTask = schemaTask<
  "investigate-incident",
  typeof investigationInputSchema,
  IncidentResult
>({
  id: "investigate-incident",
  description: "Investigate the seeded checkout conversion incident with deterministic evidence.",
  schema: investigationInputSchema,
  run: async ({ analysis, question }) => {
    const toolCallId = ai.toolCallId() ?? "investigation";
    await writeProgress(toolCallId, analysisStarted);

    const { runs: [baseline, funnel, segments] } = await batch
      .triggerByTaskAndWait([
        { task: baselineTask, payload: analysis },
        { task: funnelTask, payload: analysis },
        { task: segmentTask, payload: analysis },
      ])
      .catch(async (error: unknown) => {
        await writeProgress(toolCallId, analysisFailed);
        throw error;
      });
    const childFailed = !baseline.ok || !funnel.ok || !segments.ok;
    await writeProgress(toolCallId, [
      { key: "baseline", label: "Comparing baseline", status: baseline.ok ? "complete" : "failed" },
      { key: "funnel", label: "Reconstructing funnel", status: funnel.ok ? "complete" : "failed" },
      { key: "segments", label: "Scanning 24 segments", status: segments.ok ? "complete" : "failed" },
      { key: "render", label: "Rendering incident", status: childFailed ? "failed" : "running" },
    ]);
    const children = {
      baseline: childOutput("baseline", baseline),
      funnel: childOutput("funnel", funnel),
      segments: childOutput("segment", segments),
    };

    try {
      const result = buildIncidentResult(children, {
        question,
        service: analysis.service,
        generatedAt: new Date().toISOString(),
      });
      await writeProgress(toolCallId, [
        { key: "render", label: "Rendering incident", status: "complete" },
      ]);
      return result;
    } catch (error) {
      await writeProgress(toolCallId, [
        { key: "render", label: "Rendering incident", status: "failed" },
      ]);
      throw error;
    }
  },
});

const executeInvestigation = ai.toolExecute(investigateIncidentTask);
const investigateIncident = tool({
  description: investigateIncidentTask.description ?? "",
  inputSchema: investigationInputSchema,
  execute: async (input, options): Promise<IncidentResult> =>
    incidentResultSchema.parse(await executeInvestigation(input, options)),
  toModelOutput: ({ output }) => ({
    type: "json",
    value: {
      incidentId: output.incidentId,
      conclusion: output.finding.headline,
      activeFilters: output.views.find(({ id }) => id === output.defaultViewId)?.filter ?? {},
    },
  }),
});

const deploylensTools = { investigateIncident };
export type DeployLensUIMessage = UIMessage<
  unknown,
  { progress: InvestigationProgress },
  InferUITools<typeof deploylensTools>
>;

export const deploylensAgent = chat.withUIMessage<DeployLensUIMessage>().agent({
  id: "deploylens-agent",
  tools: deploylensTools,
  run: async ({ messages, tools, signal }) => streamText({
    ...chat.toStreamTextOptions({ tools }),
    model: anthropic("claude-sonnet-4-5"),
    system: `You are DeployLens. For the seeded checkout incident, call investigateIncident once using checkout_conversion, service checkout, baseline 2026-07-20T13:50:00Z–2026-07-20T14:17:00Z, and incident 2026-07-20T14:20:00Z–2026-07-20T14:47:00Z. Copy the user's question exactly. Never invent evidence. After the tool returns, state its conclusion in no more than two sentences.`,
    messages,
    abortSignal: signal,
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0
        ? { type: "tool", toolName: "investigateIncident" }
        : "none",
    }),
    stopWhen: stepCountIs(2),
  }),
});
