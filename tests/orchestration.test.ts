import assert from "node:assert/strict";
import test from "node:test";

import { childOutput } from "../src/trigger/deploylens.ts";

test("child task results are unwrapped or rejected with analysis context", () => {
  assert.equal(childOutput("baseline", { ok: true, output: 42 }), 42);
  assert.throws(
    () => childOutput("baseline", { ok: false, error: new Error("query failed") }),
    /baseline analysis failed/,
  );
});
