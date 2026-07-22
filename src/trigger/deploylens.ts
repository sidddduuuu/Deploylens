import { batch, schemaTask } from "@trigger.dev/sdk";
import { ai, chat } from "@trigger.dev/sdk/ai";
import {
  createUIMessageStream,
  generateId,
  tool,
  type InferUITools,
  type UIMessage,
  type UIMessageStreamOptions,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";

import {
  analysisParamsSchema,
  buildIncidentResult,
  queryBaseline,
  queryFunnel,
  querySegments,
} from "../features/investigation/analysis.ts";
import {
  classifyInvestigationQuestion,
  incidentResultSchema,
  investigationQuestionSchema,
  type IncidentResult,
  type InvestigationProgress,
} from "../features/investigation/schema.ts";
import { unsupportedQuestionMessage } from "../features/investigation/message-state.ts";
import { withClickHouse } from "../lib/clickhouse.ts";

const checkoutAnalysisSchema = analysisParamsSchema.refine(
  ({ service }) => service === "checkout",
  "only the checkout service is supported",
);

export const investigationInputSchema = z
  .object({
    metric: z.literal("checkout_conversion"),
    question: investigationQuestionSchema,
    device: z.literal("mobile").optional(),
    analysis: checkoutAnalysisSchema,
  })
  .strict()
  .superRefine(({ device, question }, context) => {
    if (device !== classifyInvestigationQuestion(question)?.device) {
      context.addIssue({
        code: "custom",
        message: "device must match the supported investigation request",
        path: ["device"],
      });
    }
  });

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
  run: async ({ analysis, device, question }) => {
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
        ...(device ? { device } : {}),
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

type DeployLensStreamWriter = UIMessageStreamWriter<DeployLensUIMessage>;

const seededAnalysis = {
  service: "checkout",
  baseline: { from: "2026-07-20T13:50:00Z", to: "2026-07-20T14:17:00Z" },
  incident: { from: "2026-07-20T14:20:00Z", to: "2026-07-20T14:47:00Z" },
} as const;

function latestUserText(messages: readonly { role: string; content: unknown }[]) {
  const content = messages.findLast(({ role }) => role === "user")?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) =>
    part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
      ? [part.text]
      : [],
  ).join("\n");
}

export function publicInvestigationError() {
  return "The investigation failed before a validated result was produced. Please retry.";
}

function writeText(writer: DeployLensStreamWriter, text: string) {
  const id = generateId();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

function responseStream(
  execute: (writer: DeployLensStreamWriter) => Promise<void> | void,
) {
  return {
    toUIMessageStream(options: UIMessageStreamOptions<DeployLensUIMessage> = {}) {
      return createUIMessageStream<DeployLensUIMessage>({
        ...(options.originalMessages ? { originalMessages: options.originalMessages } : {}),
        ...(options.generateMessageId ? { generateId: options.generateMessageId } : {}),
        ...(options.onFinish ? { onFinish: options.onFinish } : {}),
        onError: options.onError ?? publicInvestigationError,
        execute: async ({ writer }) => {
          writer.write({ type: "start" });
          await execute(writer);
          writer.write({ type: "finish", finishReason: "stop" });
        },
      });
    },
  };
}

export const deploylensAgent = chat.withUIMessage<DeployLensUIMessage>().agent({
  id: "deploylens-agent",
  tools: deploylensTools,
  uiMessageStreamOptions: { onError: publicInvestigationError },
  run: async ({ messages, signal }) => {
    const question = latestUserText(messages);
    const intent = classifyInvestigationQuestion(question);
    if (!intent) return responseStream((writer) => writeText(writer, unsupportedQuestionMessage));

    const input = investigationInputSchema.parse({
      metric: "checkout_conversion",
      question,
      analysis: seededAnalysis,
      ...(intent.device ? { device: intent.device } : {}),
    });

    return responseStream(async (writer) => {
      const toolCallId = generateId();
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "investigateIncident",
        input,
      });
      try {
        const output = incidentResultSchema.parse(await executeInvestigation(input, {
          toolCallId,
          messages,
          abortSignal: signal,
        }));
        writer.write({ type: "tool-output-available", toolCallId, output });
        writeText(writer, output.finding.headline);
      } catch (error) {
        if (signal.aborted) throw error;
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: publicInvestigationError(),
        });
      }
    });
  },
});
