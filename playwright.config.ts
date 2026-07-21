import { defineConfig, devices } from "@playwright/test";

const localBaseUrl = "http://127.0.0.1:3107";
const deployedBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || undefined;

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? "github" : "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  use: {
    baseURL: deployedBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
  },
  ...(deployedBaseUrl ? {} : {
    webServer: {
      command: process.env.CI
        ? "npm run start -- --hostname 127.0.0.1 --port 3107"
        : "npm run dev -- --hostname 127.0.0.1 --port 3107",
      reuseExistingServer: false,
      timeout: 120_000,
      url: localBaseUrl,
    },
  }),
  workers: 1,
});
