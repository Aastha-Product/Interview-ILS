import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });

/** The integration-test database URL. Refuses anything that does not look like a test database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must point at a database whose name ends in _test (got ${name})`);
  }
  return url;
}
