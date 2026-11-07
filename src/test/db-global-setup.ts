import { execFileSync } from "node:child_process";
import path from "node:path";

import { testDatabaseUrl } from "./db";

/** Creates the test database if needed and applies all migrations, once per test run. */
export default function setup() {
  // Run Prisma's CLI through Node itself rather than `yarn`, which isn't a plain executable on
  // Windows (execFileSync can't start yarn.cmd), so the setup works on every platform.
  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
}
