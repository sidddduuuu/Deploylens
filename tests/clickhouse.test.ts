import assert from "node:assert/strict";
import test from "node:test";

import { parseClickHouseConfig } from "../src/lib/clickhouse.ts";

test("ClickHouse configuration validates required connection values", () => {
  assert.deepEqual(parseClickHouseConfig({
    CLICKHOUSE_URL: "https://example.clickhouse.cloud",
    CLICKHOUSE_PASSWORD: "secret",
  }), {
    database: "deploylens",
    url: "https://example.clickhouse.cloud",
    username: "default",
    password: "secret",
  });

  assert.throws(() => parseClickHouseConfig({
    CLICKHOUSE_URL: "not-a-url",
    CLICKHOUSE_PASSWORD: "secret",
  }));
  assert.throws(() => parseClickHouseConfig({
    CLICKHOUSE_URL: "https://example.clickhouse.cloud",
  }));
});
