import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const RAW_DB_ALLOWED = [
  "packages/db/**",
  "apps/web/server/auth.ts",
  "apps/web/server/dev-sign-in.ts",
  "**/*.int.test.ts",
  "**/test/**",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/db/src/generated/**",
      "e2e/playwright-report/**",
      "e2e/test-results/**",
      "**/next-env.d.ts",
      ".local/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    files: ["scripts/**", "**/*.config.*"],
    rules: { "no-console": "off" },
  },
  // Next.js rules, only for the web app.
  ...nextCoreWebVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
    settings: { ...config.settings, next: { rootDir: "apps/web" } },
  })),
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Only a few places may use the unscoped database client.
  {
    ignores: RAW_DB_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@pathfinder/db/raw",
              message: "Use scopedDb(userId) from @pathfinder/db. Raw access is limited to auth and account deletion.",
            },
          ],
          patterns: [
            {
              group: ["**/generated/prisma/**"],
              message: "Import from @pathfinder/db instead of the generated client.",
            },
          ],
        },
      ],
    },
  },
);
