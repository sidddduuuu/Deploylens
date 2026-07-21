import assert from "node:assert/strict";
import test from "node:test";

import { incidentFixture } from "../src/features/investigation/fixture.ts";
import {
  deriveMessageState,
  unsupportedQuestionMessage,
} from "../src/features/investigation/message-state.ts";

const canonicalQuestion = "Why did checkout conversion drop around 14:20?";

function user(id: string, text: string) {
  return { id, role: "user", parts: [{ type: "text", text }] } as const;
}

type TestPart = Readonly<{ type: string; [key: string]: unknown }>;

function assistant(id: string, parts: readonly TestPart[]) {
  return { id, role: "assistant", parts } as const;
}

const validOutput = {
  type: "tool-investigateIncident",
  state: "output-available",
  output: incidentFixture,
} as const;

test("the latest user turn exclusively owns pending progress and evidence", () => {
  const messages = [
    user("user-1", canonicalQuestion),
    assistant("assistant-1", [
      { type: "data-progress", data: { label: "Rendering incident", status: "complete" } },
      validOutput,
    ]),
    user("user-2", "Show only mobile traffic"),
  ];

  assert.deepEqual(deriveMessageState(messages, "submitted"), {
    kind: "pending",
    progress: [],
  });

  const withLatestProgress = [
    ...messages,
    assistant("assistant-2", [
      { type: "data-progress", data: { label: "Scanning 24 segments", status: "running" } },
    ]),
  ];
  assert.deepEqual(deriveMessageState(withLatestProgress, "streaming"), {
    kind: "pending",
    progress: [{ label: "Scanning 24 segments", status: "running" }],
  });
});

test("the latest tool result is valid, schema-invalid, or failed without historical fallback", () => {
  const history = [
    user("user-1", canonicalQuestion),
    assistant("assistant-1", [validOutput]),
    user("user-2", "Show only mobile traffic"),
  ];
  const valid = deriveMessageState([
    ...history,
    assistant("assistant-2", [validOutput]),
  ], "ready");
  assert.equal(valid.kind, "valid");
  assert.equal(valid.kind === "valid" && valid.incident.incidentId, incidentFixture.incidentId);

  const schemaInvalid = deriveMessageState([
    ...history,
    assistant("assistant-2", [{
      ...validOutput,
      output: { ...incidentFixture, schemaVersion: 2 },
    }]),
  ], "ready");
  assert.equal(schemaInvalid.kind, "schema-invalid");
  assert.equal("incident" in schemaInvalid, false);
  assert.equal(schemaInvalid.retryable, true);

  const toolError = deriveMessageState([
    ...history,
    assistant("assistant-2", [{
      type: "tool-investigateIncident",
      state: "output-error",
      errorText: "CLICKHOUSE_PASSWORD=do-not-leak",
    }]),
  ], "ready");
  assert.equal(toolError.kind, "tool-error");
  assert.equal(toolError.message.includes("do-not-leak"), false);
  assert.equal(toolError.retryable, true);
  assert.deepEqual(deriveMessageState([
    ...history,
    assistant("assistant-2", [{
      type: "tool-investigateIncident",
      state: "output-error",
      errorText: "old failure",
    }]),
  ], "submitted"), { kind: "pending", progress: [] });
});

test("unsupported questions and transport failures return controlled public states", () => {
  const unsupported = deriveMessageState([
    user("user-1", "Write a poem about databases"),
  ], "ready");
  assert.deepEqual(unsupported, {
    kind: "unsupported",
    message: unsupportedQuestionMessage,
    progress: [],
    retryable: false,
  });

  const failed = deriveMessageState([user("user-1", canonicalQuestion)], "error");
  assert.equal(failed.kind, "tool-error");
  assert.equal(failed.retryable, true);
});
