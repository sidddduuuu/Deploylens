import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AgentChat } from "@trigger.dev/sdk/chat";
import type { UIMessageChunk } from "ai";

import {
  incidentResultSchema,
  investigationProgressSchema,
} from "../src/features/investigation/schema.ts";
import {
  investigationInputSchema,
  type deploylensAgent,
} from "../src/trigger/deploylens.ts";

const enabled = process.env.RUN_CREDENTIALED_E2E === "1";
const canonicalQuestion = "Why did checkout conversion drop around 14:20?";
const mobileFollowUp = "Show only mobile traffic";
const completedLabels = [
  "Comparing baseline",
  "Reconstructing funnel",
  "Scanning 24 segments",
  "Rendering incident",
] as const;

async function runTurn(chat: AgentChat<typeof deploylensAgent>, question: string) {
  const chunks: UIMessageChunk[] = [];
  const stream = await chat.sendMessage(question, {
    abortSignal: AbortSignal.timeout(180_000),
  });

  for await (const chunk of stream) chunks.push(chunk);

  const toolCalls = chunks.filter((chunk) => chunk.type === "tool-input-available");
  assert.equal(toolCalls.length, 1, `${question}: expected one tool call`);
  assert.equal(toolCalls[0]!.toolName, "investigateIncident");

  const toolOutputs = chunks.filter((chunk) => chunk.type === "tool-output-available");
  assert.equal(toolOutputs.length, 1, `${question}: expected one tool output`);
  assert.equal(toolOutputs[0]!.toolCallId, toolCalls[0]!.toolCallId);

  const progress = chunks.flatMap((chunk) =>
    chunk.type === "data-progress" && "data" in chunk
      ? [investigationProgressSchema.parse(chunk.data)]
      : [],
  );
  for (const label of completedLabels) {
    assert.ok(
      progress.some((update) => update.label === label && update.status === "complete"),
      `${question}: ${label} did not complete`,
    );
  }

  const text = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
  assert.ok(text.trim(), `${question}: expected a model response`);

  return {
    incident: incidentResultSchema.parse(toolOutputs[0]!.output),
    input: investigationInputSchema.parse(toolCalls[0]!.input),
  };
}

test("the deployed agent completes the canonical investigation and mobile follow-up", {
  skip: enabled ? false : "set RUN_CREDENTIALED_E2E=1 to run the live proof",
  timeout: 360_000,
}, async () => {
  assert.ok(
    process.env.TRIGGER_SECRET_KEY?.trim(),
    "TRIGGER_SECRET_KEY is required; the Trigger worker must also have ClickHouse and Anthropic credentials",
  );

  const chat = new AgentChat<typeof deploylensAgent>({
    agent: "deploylens-agent",
    id: randomUUID(),
    streamTimeoutSeconds: 180,
  });

  try {
    const { incident: initial, input: initialInput } = await runTurn(chat, canonicalQuestion);
    assert.equal(initialInput.device, undefined);
    assert.equal(initial.question, canonicalQuestion);
    assert.equal(initial.defaultViewId, "all");
    assert.equal(initial.views.length, 28);
    assert.equal(initial.segments.length, 24);
    assert.deepEqual(initial.finding.affectedSegment, {
      version: "1.8.3",
      region: "EU-West",
      device: "mobile",
    });

    const { incident: mobile, input: mobileInput } = await runTurn(chat, mobileFollowUp);
    assert.equal(mobileInput.device, "mobile");
    assert.equal(mobile.question, mobileFollowUp);
    assert.equal(mobile.incidentId, initial.incidentId);
    assert.equal(mobile.views.length, 28);
    assert.equal(mobile.defaultViewId, "device-mobile");
    assert.deepEqual(
      mobile.views.find(({ id }) => id === mobile.defaultViewId)?.filter,
      { device: "mobile" },
    );
  } finally {
    await chat.close();
  }
});
