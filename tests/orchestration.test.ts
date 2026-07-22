import assert from "node:assert/strict";
import test from "node:test";

import { classifyInvestigationQuestion } from "../src/features/investigation/schema.ts";
import {
  childOutput,
  investigationInputSchema,
  publicInvestigationError,
} from "../src/trigger/deploylens.ts";

test("child task results are unwrapped or rejected with analysis context", () => {
  assert.equal(childOutput("baseline", { ok: true, output: 42 }), 42);
  assert.throws(
    () => childOutput("baseline", { ok: false, error: new Error("query failed") }),
    /baseline analysis failed/,
  );
});

test("only the canonical investigation and mobile follow-up reach the tool", () => {
  assert.deepEqual(
    classifyInvestigationQuestion("Why did checkout conversion drop around 14:20?"),
    {},
  );
  assert.deepEqual(
    classifyInvestigationQuestion("Why did checkout conversion drop around 14:20 ?"),
    {},
  );
  assert.deepEqual(classifyInvestigationQuestion("Show only mobile traffic"), { device: "mobile" });
  assert.deepEqual(classifyInvestigationQuestion("filter to mobile traffic"), { device: "mobile" });
  assert.equal(classifyInvestigationQuestion("What is the weather?"), null);
  assert.equal(classifyInvestigationQuestion("How do I improve checkout conversion?"), null);
  assert.equal(classifyInvestigationQuestion("Show mobile weather"), null);

  const analysis = {
    service: "checkout",
    baseline: { from: "2026-07-20T13:50:00Z", to: "2026-07-20T14:17:00Z" },
    incident: { from: "2026-07-20T14:20:00Z", to: "2026-07-20T14:47:00Z" },
  };
  assert.equal(investigationInputSchema.safeParse({
    metric: "checkout_conversion",
    question: "Show only mobile traffic",
    device: "mobile",
    analysis,
  }).success, true);
  assert.equal(investigationInputSchema.safeParse({
    metric: "checkout_conversion",
    question: "Show only mobile traffic",
    analysis,
  }).success, false);
  assert.equal(investigationInputSchema.safeParse({
    metric: "checkout_conversion",
    question: "Why did checkout conversion drop around 14:20?",
    device: "mobile",
    analysis,
  }).success, false);
  assert.equal(investigationInputSchema.safeParse({
    metric: "checkout_conversion",
    question: "What is the weather?",
    analysis,
  }).success, false);
});

test("stream failures expose one actionable message without raw details", () => {
  const message = publicInvestigationError();
  assert.match(message, /retry/i);
  assert.doesNotMatch(message, /clickhouse|password|secret/i);
});
