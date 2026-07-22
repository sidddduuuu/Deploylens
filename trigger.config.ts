import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

import { parseClickHouseConfig } from "./src/lib/clickhouse.ts";

export default defineConfig({
  build: {
    extensions: [
      syncEnvVars(() => {
        const { password, url, username } = parseClickHouseConfig(process.env);
        return [
          { isSecret: true, name: "CLICKHOUSE_URL", value: url },
          { isSecret: true, name: "CLICKHOUSE_USERNAME", value: username },
          { isSecret: true, name: "CLICKHOUSE_PASSWORD", value: password },
        ];
      }),
    ],
  },
  project: "proj_ynjfjijqfgternjoiukp",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  runtime: "node-22",
});
