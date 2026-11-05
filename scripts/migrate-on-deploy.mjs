#!/usr/bin/env node
// Runs before `next build` (see apps/web/package.json). Does nothing locally or in CI.
//
// On Vercel, for a demo site (APP_ENV=demo) or when MIGRATE_ON_BUILD=1, it applies the database
// migrations first, so the deployment and its database schema always match. It uses the direct
// (non-pooled) address that Vercel's Postgres integration provides, because migrations need one.

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
if (!env.VERCEL) process.exit(0);
if (env.APP_ENV !== "demo" && env.MIGRATE_ON_BUILD !== "1") {
  console.log("migrate-on-deploy: skipped (not a demo site and MIGRATE_ON_BUILD is not 1).");
  process.exit(0);
}

const url =
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_PRISMA_URL ||
  env.POSTGRES_URL;
if (!url) {
  console.error(
    "migrate-on-deploy: no database is connected. In Vercel open this project's Storage tab, create a Postgres " +
      "database (Neon), connect it to this project for Production, then redeploy.",
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("migrate-on-deploy: applying database migrations...");
execSync("pnpm --filter @pathfinder/db exec prisma migrate deploy", {
  cwd: root,
  stdio: "inherit",
  env: { ...env, DATABASE_URL: url },
});
