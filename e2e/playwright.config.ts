import { defineConfig, devices } from "@playwright/test";

// Browsers live in node_modules (see scripts/install-browsers.mjs).
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";

/**
 * End-to-end tests run against `next dev` and the queue worker with no Google or AI keys: dev
 * sign-in, the mock AI and local file storage. Postgres must be running and migrated first (`pnpm services:up && pnpm db:deploy`).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @pathfinder/web dev",
      cwd: "..",
      url: "http://localhost:3000/signin",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The queue worker: drafts with the mock AI and renders PDFs with Chromium.
      command: "pnpm --filter @pathfinder/worker start",
      cwd: "..",
      wait: { stdout: /Worker ready/ },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
