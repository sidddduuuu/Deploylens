import {
  classifyInvestigationQuestion,
  incidentResultSchema,
  investigationProgressSchema,
  type IncidentResult,
  type InvestigationProgress,
} from "./schema.ts";

export const unsupportedQuestionMessage =
  "Ask about the seeded checkout incident or filter it to mobile traffic.";

const schemaFailureMessage =
  "The investigation returned invalid evidence. Retry the investigation.";
const toolFailureMessage =
  "The investigation could not complete. Retry it, then check the Trigger.dev and ClickHouse configuration if it fails again.";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";
type MessagePart = Readonly<{
  type: string;
  text?: unknown;
  state?: unknown;
  output?: unknown;
  data?: unknown;
}>;
type Message = Readonly<{
  role: string;
  parts: readonly MessagePart[];
}>;

type FailureState = Readonly<{
  kind: "schema-invalid" | "tool-error" | "unsupported";
  message: string;
  progress: readonly InvestigationProgress[];
  retryable: boolean;
}>;

export type InvestigationMessageState =
  | Readonly<{ kind: "initial"; progress: readonly InvestigationProgress[] }>
  | Readonly<{ kind: "pending"; progress: readonly InvestigationProgress[] }>
  | Readonly<{ kind: "valid"; incident: IncidentResult; progress: readonly InvestigationProgress[] }>
  | FailureState;

function questionFrom(message: Message) {
  return message.parts
    .flatMap((part) => part.type === "text" && typeof part.text === "string" ? [part.text] : [])
    .join("\n");
}

function progressFrom(message: Message | undefined) {
  if (!message) return [];
  return message.parts.flatMap((part) => {
    if (part.type !== "data-progress") return [];
    const parsed = investigationProgressSchema.safeParse(part.data);
    return parsed.success ? [parsed.data] : [];
  });
}

export function deriveMessageState(
  messages: readonly Message[],
  status: ChatStatus,
): InvestigationMessageState {
  const userIndex = messages.findLastIndex(({ role }) => role === "user");
  if (userIndex < 0) return { kind: "initial", progress: [] };

  const userMessage = messages[userIndex]!;
  if (!classifyInvestigationQuestion(questionFrom(userMessage))) {
    return {
      kind: "unsupported",
      message: unsupportedQuestionMessage,
      progress: [],
      retryable: false,
    };
  }
  if (status === "submitted") return { kind: "pending", progress: [] };

  const assistant = messages.slice(userIndex + 1).findLast(({ role }) => role === "assistant");
  const progress = progressFrom(assistant);
  const toolPart = assistant?.parts.findLast(({ type }) => type === "tool-investigateIncident");

  if (toolPart?.state === "output-available") {
    const parsed = incidentResultSchema.safeParse(toolPart.output);
    return parsed.success
      ? { kind: "valid", incident: parsed.data, progress }
      : { kind: "schema-invalid", message: schemaFailureMessage, progress, retryable: true };
  }
  if (toolPart?.state === "output-error" || toolPart?.state === "output-denied" || status === "error") {
    return { kind: "tool-error", message: toolFailureMessage, progress, retryable: true };
  }
  if (!assistant || status === "streaming") {
    return { kind: "pending", progress };
  }
  return { kind: "tool-error", message: toolFailureMessage, progress, retryable: true };
}
