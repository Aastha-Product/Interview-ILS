import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient, isSqliteUrl } from "@/lib/database";
import { contextUserId } from "@/lib/owner/context";
import { rawClientOf, scopedClient } from "@/lib/owner/scope";

/**
 * The student database tests act as (Pathfinder: private accounts). resetDatabase creates it.
 * A test can act as someone else with runAsUser(otherId, ...) from @/lib/owner/context.
 */
export const TEST_USER_ID = "test-student";
export const TEST_USER_EMAIL = "student@example.test";

/**
 * The database for `*.db.test.ts` files: TEST_DATABASE_URL, or DATABASE_URL
 * with "_test" added to the database name (or the SQLite file's, before its
 * extension). Refuses any database whose name doesn't end in "_test", so
 * tests can never wipe development data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error("Database tests need DATABASE_URL or TEST_DATABASE_URL.");
  }
  if (isSqliteUrl(explicit ?? base!)) {
    const url = explicit ?? base!.replace(/(\.\w+)?$/, "_test$1");
    if (!/_test(\.\w+)?$/.test(url)) throw new Error(`Refusing to run database tests against "${url}": its name must end in "_test".`);
    return url;
  }
  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run database tests against "${url.pathname.slice(1)}": its name must end in "_test".`);
  }
  return url.toString();
}

/** Whether the tests run against SQLite rather than PostgreSQL. */
export function testsUseSqlite(): boolean {
  return isSqliteUrl(testDatabaseUrl());
}

/** The app's database client as the test student sees it: scoped to their own rows. */
export function createTestClient(): PrismaClient {
  return scopedClient(createPrismaClient(testDatabaseUrl()), async () => contextUserId() ?? TEST_USER_ID);
}

/** Empties every table, so each test starts from a blank database, then adds the test student. */
export async function resetDatabase(scoped: PrismaClient): Promise<void> {
  const db = rawClientOf(scoped);
  await emptyDatabase(db);
  await db.user.create({ data: { id: TEST_USER_ID, email: TEST_USER_EMAIL } });
}

async function emptyDatabase(db: PrismaClient): Promise<void> {
  if (testsUseSqlite()) {
    const tables = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`;
    // SQLite has no TRUNCATE … CASCADE: the order doesn't matter with the checks off.
    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    // Built-in themes can't be deleted (see the init migration's trigger).
    await db.$executeRawUnsafe(`UPDATE "Theme" SET "builtIn" = false`);
    for (const { name } of tables) await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    return;
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
