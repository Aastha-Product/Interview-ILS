import { execFileSync } from "node:child_process";
import path from "node:path";
import { testDatabaseUrl } from "./test-db-url";

/** Brings the test database up to the latest migration once per run. */
export default function setup(): void {
  const url = testDatabaseUrl();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, "../packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}
