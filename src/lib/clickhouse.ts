import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";

const clickHouseConfigSchema = z
  .object({
    database: z.literal("deploylens"),
    url: z.string().url(),
    username: z.string().trim().min(1),
    password: z.string().min(1),
  })
  .strict();

export function parseClickHouseConfig(env: Readonly<Record<string, string | undefined>>) {
  return clickHouseConfigSchema.parse({
    database: "deploylens",
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USERNAME ?? "default",
    password: env.CLICKHOUSE_PASSWORD,
  });
}

export async function withClickHouse<Result>(
  run: (client: ClickHouseClient) => Promise<Result>,
): Promise<Result> {
  const client = createClient(parseClickHouseConfig(process.env));
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}
