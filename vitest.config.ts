import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**", "**/.next/**"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/test/**/*.int.test.ts", "apps/*/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          globalSetup: ["./test/integration-global-setup.ts"],
          setupFiles: ["./test/integration-env.ts"],
          // Tests share one database, so files run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
