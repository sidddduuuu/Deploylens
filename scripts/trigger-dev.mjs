import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, [
  "--yes",
  "trigger.dev@4.5.5",
  "dev",
  "start",
  "--skip-update-check",
  "--env-file",
  ".env.local",
], {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
