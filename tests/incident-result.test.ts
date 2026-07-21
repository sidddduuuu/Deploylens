import assert from "node:assert/strict";
import test from "node:test";

import { incidentFixture } from "../src/features/investigation/fixture.ts";
import {
  incidentResultSchema,
  type IncidentResultInput,
} from "../src/features/investigation/schema.ts";

function copyFixture() {
  return structuredClone(incidentFixture) as IncidentResultInput;
}

test("the canonical incident satisfies the contract", () => {
  const result = incidentResultSchema.parse(incidentFixture);
  const affected = result.segments.find(({ segment }) =>
    segment.version === "1.8.3" &&
    segment.region === "EU-West" &&
    segment.device === "mobile",
  );

  assert.equal(result.segments.length, 24);
  assert.equal(result.views.length, 25);
  assert.deepEqual(result.finding.affectedSegment, {
    version: "1.8.3",
    region: "EU-West",
    device: "mobile",
  });
  assert.equal(affected?.checkoutFailureRelativeChangePct, 37);
  assert.ok(result.views[0]!.timeline[2]!.conversionRate < result.views[0]!.timeline[1]!.conversionRate);

  const affectedView = result.views.find(({ id }) => id === affected?.viewId)!;
  const baselineFailures = 1 - affectedView.funnel.baseline[3]!.sessions / affectedView.funnel.baseline[1]!.sessions;
  const incidentFailures = 1 - affectedView.funnel.incident[3]!.sessions / affectedView.funnel.incident[1]!.sessions;
  assert.ok(Math.abs(((incidentFailures / baselineFailures) - 1) * 100 - 37) < 0.2);
});

test("rates and counts are bounded", () => {
  const invalidRate = copyFixture();
  invalidRate.views[0]!.timeline[0]!.conversionRate = 1.01;

  const invalidCount = copyFixture();
  invalidCount.segments[0]!.sessions = -1;

  assert.equal(incidentResultSchema.safeParse(invalidRate).success, false);
  assert.equal(incidentResultSchema.safeParse(invalidCount).success, false);
});

test("timeline and funnel sequences are structurally valid", () => {
  const unorderedTimeline = copyFixture();
  unorderedTimeline.views[0]!.timeline[1]!.at = unorderedTimeline.views[0]!.timeline[0]!.at;

  const duplicateStage = copyFixture();
  duplicateStage.views[0]!.funnel.incident[3]!.key = "cart";

  assert.equal(incidentResultSchema.safeParse(unorderedTimeline).success, false);
  assert.equal(incidentResultSchema.safeParse(duplicateStage).success, false);
});

test("view references and IDs are consistent", () => {
  const danglingReference = copyFixture();
  danglingReference.segments[0]!.viewId = "missing-view";

  const duplicateView = copyFixture();
  duplicateView.views[1]!.id = duplicateView.views[0]!.id;

  const duplicateSegmentId = copyFixture();
  duplicateSegmentId.segments[1]!.id = duplicateSegmentId.segments[0]!.id;

  const mismatchedView = copyFixture();
  mismatchedView.segments[0]!.viewId = mismatchedView.segments[1]!.viewId;

  assert.equal(incidentResultSchema.safeParse(danglingReference).success, false);
  assert.equal(incidentResultSchema.safeParse(duplicateView).success, false);
  assert.equal(incidentResultSchema.safeParse(duplicateSegmentId).success, false);
  assert.equal(incidentResultSchema.safeParse(mismatchedView).success, false);
});

test("funnel evidence uses canonical, internally consistent stages", () => {
  const reordered = copyFixture();
  reordered.views[0]!.funnel.incident[1]!.key = "payment_submitted";
  reordered.views[0]!.funnel.incident[2]!.key = "checkout_started";

  const contradictoryRate = copyFixture();
  contradictoryRate.views[0]!.funnel.incident[3]!.completionFromStart = 0.9;

  assert.equal(incidentResultSchema.safeParse(reordered).success, false);
  assert.equal(incidentResultSchema.safeParse(contradictoryRate).success, false);
});

test("markers and deployment evidence are consistent", () => {
  const missingRollback = copyFixture();
  missingRollback.markers[2]!.kind = "deployment";

  const mismatchedVersion = copyFixture();
  mismatchedVersion.finding.cause.version = "1.8.2";

  assert.equal(incidentResultSchema.safeParse(missingRollback).success, false);
  assert.equal(incidentResultSchema.safeParse(mismatchedVersion).success, false);
});
