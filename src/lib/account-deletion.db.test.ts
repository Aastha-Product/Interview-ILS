import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { deleteAccount } from "./account-deletion";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const google = vi.hoisted(() => ({ disconnectedFor: [] as string[] }));
vi.mock("@/lib/google/account", async () => {
  const { contextUserId } = await import("@/lib/owner/context");
  return { disconnectGoogle: async () => void google.disconnectedFor.push(contextUserId() ?? "nobody") };
});
const dataDir = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({ env: { get DOSSIER_DATA_DIR() { return dataDir.path; }, DOSSIER_SECRET: "s".repeat(32) } }));

const prisma = () => db.client!;
const system = () => rawClientOf(prisma());
const now = new Date(2026, 10, 7, 12);
const STUDENTS = ["test-student", "other-student"] as const;

/** Rows per student in every table that has a userId column: the whole of what a student owns. */
async function ownedRows(userId: string): Promise<Record<string, number>> {
  const tables = await system().$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'userId' ORDER BY table_name`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [{ n }] = await system().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table_name}" WHERE "userId" = $1`, userId);
    counts[table_name] = n;
  }
  return counts;
}
const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

beforeEach(async () => {
  dataDir.path = await mkdtemp(path.join(tmpdir(), "pathfinder-delete-account-"));
  google.disconnectedFor = [];
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await system().user.upsert({ where: { id: "other-student" }, create: { id: "other-student", email: "other@example.test" }, update: {} });
  for (const student of STUDENTS) {
    await runAsUser(student, async () => {
      await seedDemo(prisma(), { now });
      await prisma().setting.create({ data: { key: "paper", value: "LETTER" } });
      await prisma().job.create({ data: { type: "refine", key: `refine:${student}`, status: "DONE", input: {} } });
      await prisma().feedback.create({ data: { message: "Nice", page: "/analyze" } });
      await prisma().aiUsage.create({ data: { day: "2026-11-07", count: 2 } });
      await prisma().aiCall.create({ data: { task: "review-resume", model: "m", outcome: "ok" } });
    });
    await mkdir(path.join(dataDir.path, "students", student, "backups"), { recursive: true });
    await writeFile(path.join(dataDir.path, "students", student, "backups", "dossier-backup-nightly.json"), "{}");
  }
});
afterAll(async () => {
  await rm(dataDir.path, { recursive: true, force: true });
  await prisma().$disconnect();
});

describe("deleteAccount (QA M-3)", () => {
  it("deletes the account and every row the student owns, in every table", async () => {
    const before = await ownedRows("test-student");
    // The demo data reaches well beyond the profile: applications, documents, settings, jobs, feedback, AI use.
    expect(Object.values(before).filter((n) => n > 0).length).toBeGreaterThanOrEqual(10);

    await deleteAccount("test-student");

    expect(await system().user.findUnique({ where: { id: "test-student" } })).toBeNull();
    const after = await ownedRows("test-student");
    expect(total(after)).toBe(0);
  });

  it("removes the student's folder and disconnects their Google account", async () => {
    await deleteAccount("test-student");
    expect(await readdir(path.join(dataDir.path, "students"))).toEqual(["other-student"]);
    expect(google.disconnectedFor).toEqual(["test-student"]);
  });

  it("leaves other students' accounts, data and files alone", async () => {
    const before = await ownedRows("other-student");
    await deleteAccount("test-student");
    expect(await ownedRows("other-student")).toEqual(before);
    expect(await system().user.findUnique({ where: { id: "other-student" } })).not.toBeNull();
    expect(await readdir(path.join(dataDir.path, "students", "other-student", "backups"))).toHaveLength(1);
    // The built-in themes are shared and stay.
    expect(await system().theme.count({ where: { builtIn: true } })).toBe(12);
  });

  it("cancels the student's unfinished work first", async () => {
    await runAsUser("test-student", () => prisma().job.create({ data: { type: "refine", key: "refine:queued", status: "QUEUED", input: {} } }));
    await deleteAccount("test-student");
    expect(await system().job.count({ where: { userId: "test-student" } })).toBe(0);
  });

  it("refuses an id that could reach outside the student's folder", async () => {
    await expect(deleteAccount("../other-student")).rejects.toThrow();
    expect(await system().user.count()).toBe(2);
  });
});
