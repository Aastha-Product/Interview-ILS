import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});

const { loadStudentPlan } = await import("./plans-data");

const users = () => rawClientOf(db.client!).user;
const now = new Date("2026-11-22T10:00:00Z");

beforeEach(() => resetDatabase(db.client!));
afterAll(() => db.client!.$disconnect());

describe("the current student's plan (Phase 4)", () => {
  it("is Free until an admin sets one, then that plan until it ends, with any allowance", async () => {
    expect(await loadStudentPlan(now)).toEqual({ plan: "FREE", until: null, allowance: null });
    const until = new Date("2026-12-22T10:00:00Z");
    await users().update({ where: { id: TEST_USER_ID }, data: { plan: "MONTHLY", planUntil: until, aiDailyLimit: 8 } });
    expect(await loadStudentPlan(now)).toEqual({ plan: "MONTHLY", until, allowance: 8 });
    // Once it has ended, Free again, and no end date to show.
    expect(await loadStudentPlan(new Date("2027-01-01T00:00:00Z"))).toEqual({ plan: "FREE", until: null, allowance: 8 });
  });

  it("is Free for a student who no longer exists", async () => {
    expect(await runAsUser("gone-student", () => loadStudentPlan(now))).toEqual({ plan: "FREE", until: null, allowance: null });
  });
});
