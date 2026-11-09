import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { adminEmails, isAdmin } from "@/lib/admin";
import { loadAdminOverview } from "@/lib/admin-data";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase, TEST_USER_EMAIL, TEST_USER_ID } from "@/test/db";

import { setStudentAllowance } from "./actions";

// Pathfinder: the admin console. Only the people in PATHFINDER_ADMIN_EMAILS may see it or change
// a student's allowance, and it shows counts and costs, never a resume or an analysis.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const signedIn = vi.hoisted(() => ({ userId: "test-student" }));
vi.mock("@/lib/auth/session", () => {
  const session = () => ({ userId: signedIn.userId, persistent: false, version: 0, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  return { getSession: async () => session(), verifySession: async () => session() };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const env = vi.hoisted(() => ({ PATHFINDER_ADMIN_EMAILS: undefined as string | undefined, PATHFINDER_AI_DAILY_LIMIT: 10 as number | undefined }));
vi.mock("@/lib/env", () => ({ env }));

const raw = () => rawClientOf(db.client!);
const OTHER = "other-student";
const PRIVATE_TEXT = "A private sentence from the student's resume review";

beforeEach(async () => {
  env.PATHFINDER_ADMIN_EMAILS = undefined;
  signedIn.userId = TEST_USER_ID;
  await resetDatabase(db.client!);
  await raw().user.create({ data: { id: OTHER, email: "other@example.test", name: "Other Student" } });
});
afterAll(() => db.client!.$disconnect());

describe("who is an admin", () => {
  it("reads PATHFINDER_ADMIN_EMAILS as a comma-separated list, ignoring case and blanks", () => {
    expect([...adminEmails(" Owner@Example.com, ,ops@example.com ")]).toEqual(["owner@example.com", "ops@example.com"]);
    expect(adminEmails(undefined).size).toBe(0);
    expect(adminEmails("not-an-email").size).toBe(0);
  });

  it("is nobody until the setting names someone, then only the students it names", async () => {
    expect(await isAdmin(TEST_USER_ID)).toBe(false);
    env.PATHFINDER_ADMIN_EMAILS = TEST_USER_EMAIL.toUpperCase();
    expect(await isAdmin(TEST_USER_ID)).toBe(true);
    expect(await isAdmin(OTHER)).toBe(false);
    expect(await isAdmin("no-such-student")).toBe(false);
  });
});

describe("setting a student's free allowance", () => {
  it("refuses anyone who isn't an admin, even calling the action directly", async () => {
    const result = await setStudentAllowance({ userId: OTHER, analysesPerDay: 50 });
    expect(result).toEqual({ ok: false, error: "Only an admin can change a student's allowance." });
    expect((await raw().user.findUniqueOrThrow({ where: { id: OTHER } })).aiDailyLimit).toBeNull();
  });

  it("lets an admin set analyses a day for a student (two AI requests each), and put them back on the default", async () => {
    env.PATHFINDER_ADMIN_EMAILS = TEST_USER_EMAIL;
    expect(await setStudentAllowance({ userId: OTHER, analysesPerDay: 20 })).toMatchObject({ ok: true, toast: "Allowance set to 20 a day." });
    expect((await raw().user.findUniqueOrThrow({ where: { id: OTHER } })).aiDailyLimit).toBe(40);
    expect(await setStudentAllowance({ userId: OTHER, analysesPerDay: 0 })).toMatchObject({ ok: true });
    expect((await raw().user.findUniqueOrThrow({ where: { id: OTHER } })).aiDailyLimit).toBe(0);
    expect(await setStudentAllowance({ userId: OTHER, analysesPerDay: null })).toMatchObject({ ok: true, toast: "Back on the default allowance." });
    expect((await raw().user.findUniqueOrThrow({ where: { id: OTHER } })).aiDailyLimit).toBeNull();
  });

  it("says so when the student is gone, and refuses allowances out of range", async () => {
    env.PATHFINDER_ADMIN_EMAILS = TEST_USER_EMAIL;
    expect(await setStudentAllowance({ userId: "no-such-student", analysesPerDay: 5 })).toEqual({ ok: false, error: "That student no longer exists." });
    expect(await setStudentAllowance({ userId: OTHER, analysesPerDay: -1 })).toMatchObject({ ok: false });
    expect(await setStudentAllowance({ userId: OTHER, analysesPerDay: 501 })).toMatchObject({ ok: false });
  });
});

describe("the overview", () => {
  it("counts students, analyses and AI calls across students, with costs by model and per student", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await raw().user.update({ where: { id: OTHER }, data: { aiDailyLimit: 6 } });
    await raw().resumeAnalysis.createMany({
      data: [
        { userId: OTHER, fileName: "cv.pdf", profile: {}, review: { overview: PRIVATE_TEXT } },
        { userId: OTHER, fileName: "cv2.pdf", profile: {}, review: { overview: PRIVATE_TEXT }, createdAt: old },
      ],
    });
    await raw().aiCall.createMany({
      data: [
        { userId: OTHER, task: "extracted_profile", model: "claude-sonnet-5-5", inputTokens: 5000, outputTokens: 2000, costMicroUsd: 30_000, outcome: "ok" },
        { userId: OTHER, task: "resume_review", model: "claude-opus-5-5", inputTokens: 5000, outputTokens: 2000, costMicroUsd: 60_000, outcome: "ok" },
        { userId: TEST_USER_ID, task: "resume_review", model: "gemini-3.5-flash", inputTokens: 1000, outputTokens: 500, costMicroUsd: null, outcome: "busy" },
        { userId: TEST_USER_ID, task: "resume_review", model: "claude-opus-5-5", inputTokens: 9, outputTokens: 9, costMicroUsd: 999_999, outcome: "ok", createdAt: old },
      ],
    });
    const { limitDay } = await import("@/lib/ai/daily-limit");
    await raw().aiUsage.create({ data: { userId: OTHER, day: limitDay(now), count: 3 } });

    const overview = await loadAdminOverview(now);

    expect(overview.students).toEqual({ total: 2, newToday: 2, new7d: 2, activeToday: 1 });
    expect(overview.analyses).toEqual({ total: 2, today: 1, last7d: 1 });
    // The 40-day-old call is outside every period.
    expect(overview.ai.last30d).toEqual({ calls: 3, failed: 1, inputTokens: 11_000, outputTokens: 4500, costUsd: 0.09, unpriced: 1 });
    expect(overview.ai.byModel.map(({ model, calls, failed, costUsd, unpriced }) => ({ model, calls, failed, costUsd, unpriced }))).toEqual([
      { model: "claude-opus-5-5", calls: 1, failed: 0, costUsd: 0.06, unpriced: 0 },
      { model: "claude-sonnet-5-5", calls: 1, failed: 0, costUsd: 0.03, unpriced: 0 },
      { model: "gemini-3.5-flash", calls: 1, failed: 1, costUsd: 0, unpriced: 1 },
    ]);
    expect(overview.defaultAllowance).toBe(5);
    const other = overview.studentList.find((student) => student.id === OTHER);
    expect(other).toMatchObject({ email: "other@example.test", name: "Other Student", analyses: 2, requestsToday: 3, allowance: 3, costUsd30d: 0.09 });
    expect(overview.studentList.find((student) => student.id === TEST_USER_ID)).toMatchObject({ analyses: 0, requestsToday: 0, allowance: null });

    // Counts only: nothing a student wrote or uploaded.
    const shown = JSON.stringify(overview);
    expect(shown).not.toContain(PRIVATE_TEXT);
    expect(shown).not.toContain("cv.pdf");
  });
});
