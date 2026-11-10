import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_ANSWERS } from "@/lib/apply/answers";
import { loadAutoApplyScreen } from "@/lib/apply/view";
import { startJob } from "@/lib/jobs/runner";
import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { agreeToAutoApply, findMatchesNow, saveJobSearch, skipApplication, switchAutoApply } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ userId: "test-student", persistent: false, version: 0, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
// Jobs are only queued here; what they do has its own tests.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "match-run"),
}));

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());
const jobSearch = {
  preferences: { titles: ["Data Analyst"], skills: ["SQL"], countries: ["in"], cities: ["Pune"], remoteOk: true, level: "entry" as const, employmentTypes: [] },
  minTier: "GOOD" as const,
  dailyLimit: 5,
  perCompanyLimit: 2,
  dryRun: true,
  answers: { ...EMPTY_ANSWERS, workAuthorized: true },
};

async function taskIn(state: "READY" | "NEEDS_STUDENT" | "SUBMITTING" | "APPLIED") {
  const company = await raw().company.create({ data: { name: "Acme", system: "GREENHOUSE", boardToken: `acme-${state}` } });
  const posting = await raw().sharedPosting.create({
    data: { companyId: company.id, system: "GREENHOUSE", externalId: state, title: `Analyst ${state}`, companyName: "Acme", location: "Pune", country: "in", description: "", url: "https://acme.example/job", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1", dedupeKey: state, contentHash: "v1" },
  });
  const match = await prisma().jobMatch.create({ data: { sharedPostingId: posting.id, rank: 1, status: "SCORED", score: 85, tier: "STRONG" } });
  return prisma().applyTask.create({ data: { jobMatchId: match.id, sharedPostingId: posting.id, state, reason: state === "NEEDS_STUDENT" ? "Answer this question to apply: Why us?" : null } });
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await raw().applyTask.deleteMany();
  await raw().autoApplySettings.deleteMany();
  await raw().jobMatch.deleteMany();
  await raw().sharedPosting.deleteMany();
  await raw().company.deleteMany();
  vi.mocked(startJob).mockClear();
});
afterAll(() => prisma().$disconnect());

describe("the auto-apply screens' actions (auto-apply step 4)", () => {
  it("saves the job search and keeps auto-apply off until switched on", async () => {
    expect(await saveJobSearch(jobSearch)).toMatchObject({ ok: true, toast: "Job search saved." });
    const view = await loadAutoApplyScreen();
    expect(view.settings).toMatchObject({ enabled: false, consented: false, dailyLimit: 5, preferences: jobSearch.preferences });
    expect(view.preferences).toEqual(jobSearch.preferences);
  });

  it("refuses a job search without a role, in words for the form", async () => {
    const result = await saveJobSearch({ ...jobSearch, preferences: { ...jobSearch.preferences, titles: [] } });
    expect(result.ok).toBe(false);
  });

  it("switches on only after agreeing, and starts finding matches at once", async () => {
    await saveJobSearch(jobSearch);
    expect(await switchAutoApply({ enabled: true })).toMatchObject({ ok: false, error: "Read and agree to how auto-apply works first." });
    await agreeToAutoApply({});
    expect(await switchAutoApply({ enabled: true })).toMatchObject({ ok: true, toast: "Auto-apply is on. Finding jobs that fit you now." });
    expect(vi.mocked(startJob)).toHaveBeenCalledWith(expect.objectContaining({ type: "match-jobs" }), expect.anything(), expect.anything());
    expect((await loadAutoApplyScreen()).settings.enabled).toBe(true);
    expect(await switchAutoApply({ enabled: false })).toMatchObject({ ok: true });
    expect((await loadAutoApplyScreen()).settings.enabled).toBe(false);
  });

  it("finds matches now only once the job search is set up", async () => {
    expect(await findMatchesNow({})).toMatchObject({ ok: false, error: "Set up your job search first." });
    await saveJobSearch(jobSearch);
    expect(await findMatchesNow({})).toMatchObject({ ok: true, data: { jobId: "match-run" } });
  });

  it("skips an application, but not one the browser may be submitting", async () => {
    const waiting = await taskIn("NEEDS_STUDENT");
    const submitting = await taskIn("SUBMITTING");
    expect(await skipApplication({ taskId: waiting.id })).toMatchObject({ ok: true });
    expect(await prisma().applyTask.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ state: "SKIPPED", reason: "You skipped it." });
    expect(await skipApplication({ taskId: submitting.id })).toMatchObject({ ok: false, error: "That application can't be skipped now." });
  });

  it("shows what waits on the student first, with the job's details", async () => {
    await taskIn("APPLIED");
    await taskIn("NEEDS_STUDENT");
    await taskIn("READY");
    const view = await loadAutoApplyScreen();
    expect(view.tasks.map((task) => task.state)[0]).toBe("NEEDS_STUDENT");
    expect(view.tasks[0]).toMatchObject({ title: "Analyst NEEDS_STUDENT", company: "Acme", tier: "STRONG", score: 85, reason: "Answer this question to apply: Why us?" });
    expect(view.summary.tasks).toMatchObject({ APPLIED: 1, NEEDS_STUDENT: 1, READY: 1 });
    expect(view.openJobs).toBe(3);
  });

  it("doesn't let one student skip or see another's applications", async () => {
    const mine = await taskIn("READY");
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    expect(await runAsUser("other-student", () => loadAutoApplyScreen())).toMatchObject({ tasks: [] });
    await runAsUser("other-student", () => skipApplication({ taskId: mine.id }));
    expect((await prisma().applyTask.findUniqueOrThrow({ where: { id: mine.id } })).state).toBe("READY");
  });
});
