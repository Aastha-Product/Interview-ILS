import { defineConfig } from "@playwright/test";

// The extension's Chrome tests (auto-apply step 6): Chromium with the extension loaded, a fake
// Pathfinder, and mock job boards served at the boards' own addresses. No app or database needed.
// Run with `yarn test:extension`.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: "../test-results/extension",
});
