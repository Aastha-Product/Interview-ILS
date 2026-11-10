import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobContext } from "@/lib/jobs/runner";
import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { MockProvider } from "../ai/providers/mock";

import { EMPTY_ANSWERS, type FormField } from "./answers";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
// Jobs started here stay queued: the tests run the preparation themselves.
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return { ...original, env: new Proxy(original.env, { get: (target, key) => (key === "PATHFINDER_ROLE" ? "web" : Reflect.get(target, key)) }) };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
// The form each Greenhouse job has, as the test sets it.
const form = vi.hoisted(() => ({ fields: [] as unknown[], asked: 0 }));
vi.mock("./greenhouse-form", () => ({
  greenhouseForm: async () => {
    form.asked++;
    return form.fields;
  },
}));
// A fake AI that answers each step of reading and writing.
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        switch (call.json?.name) {
          case "extracted_posting":
            return {
              title: "Data Analyst · Acme",
              company: "Acme",
              role: "Data Analyst",
              location: "Pune",
              mode: "On-site",
              salary: "",
              deadline: null,
              requirements: [{ text: "SQL", kind: "skill", skill: "SQL", years: null, language: null }],
              asksForReferences: false,
              language: "English",
            };
          case "requirement_matches":
            return { matches: [] };
          case "tailored_resume":
            return { summary: "Analyst who turns data into decisions.", roles: [], projects: [], skills: [], education: [] };
          case "cover_letter":
            return { recipient: "Acme · Hiring team", greeting: "Dear Acme team,", paragraphs: [{ label: "Opening", text: "I enjoy analysis." }], signOff: "Regards," };
          default:
            throw new Error(`No answer for ${call.json?.name}`);
        }
      },
    }),
}));

const { giveConsent, loadAutoApply, saveAutoApply, setAutoApplyEnabled, AutoApplyNotReady, CONSENT_VERSION } = await import("./settings");
const { autoApplySummary, planApplications, prepareApplicationJob } = await import("./prepare");
const { autoApplyRound, autoApplyRounds } = await import("./schedule");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());
const context = (): JobContext => ({ id: "prepare-job", step: async () => {}, signal: new AbortController().signal, finalAttempt: true });

const preferences = { titles: ["Data Analyst"], skills: ["SQL"], countries: ["in"], cities: [], remoteOk: true, level: "entry" as const, employmentTypes: [] };
const answers = { ...EMPTY_ANSWERS, workAuthorized: true, needsSponsorship: false, relativesAtCompany: false, backgroundCheckConsent: true, acceptPrivacyNotices: true };

async function switchedOn(overrides: Partial<{ minTier: "STRONG" | "GOOD"; dailyLimit: number; perCompanyLimit: number }> = {}) {
  await saveAutoApply({ preferences, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 2, dryRun: true, answers, ...overrides });
  await giveConsent();
  await setAutoApplyEnabled(true);
}

let companies: Record<string, string> = {};
async function job(id: string, company: "acme" | "zeta" | "lever", options: { tier?: "STRONG" | "GOOD" | "PARTIAL"; score?: number; closed?: boolean } = {}) {
  const posting = await raw().sharedPosting.create({
    data: {
      companyId: companies[company],
      system: company === "lever" ? "LEVER" : "GREENHOUSE",
      externalId: id,
      title: "Data Analyst",
      companyName: company === "zeta" ? "Zeta" : "Acme",
      location: "Pune",
      country: "in",
      description: "We need SQL.",
      url: `https://acme.example/${id}`,
      applyUrl: `https://job-boards.greenhouse.io/${company}/jobs/${id}`,
      closedAt: options.closed ? new Date() : null,
      dedupeKey: id,
      contentHash: "v1",
    },
  });
  const tier = options.tier ?? "STRONG";
  const match = await prisma().jobMatch.create({
    data: { sharedPostingId: posting.id, rank: 1, status: "SCORED", score: options.score ?? (tier === "STRONG" ? 85 : tier === "GOOD" ? 70 : 55), tier },
  });
  return { posting, match };
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await raw().applyTask.deleteMany();
  await raw().autoApplySettings.deleteMany();
  await raw().jobMatch.deleteMany();
  await raw().sharedPosting.deleteMany();
  await raw().company.deleteMany();
  companies = {};
  for (const [key, system] of [["acme", "GREENHOUSE"], ["zeta", "GREENHOUSE"], ["lever", "LEVER"]] as const) {
    companies[key] = (await raw().company.create({ data: { name: key, system, boardToken: key } })).id;
  }
  // Trimming renders PDFs: not what these tests are about.
  await saveSettings({ pageLimit: "none" });
  form.fields = [];
  form.asked = 0;
});
afterAll(() => prisma().$disconnect());

describe("auto-apply settings (auto-apply step 4)", () => {
  it("starts off, as a dry run, with nothing answered", async () => {
    expect(await loadAutoApply()).toEqual({
      enabled: false,
      consented: false,
      consentOutdated: false,
      preferences: null,
      minTier: "GOOD",
      dailyLimit: 10,
      perCompanyLimit: 2,
      dryRun: true,
      answers: EMPTY_ANSWERS,
    });
  });

  it("switches on only after consent and a job search set up, and off at any time", async () => {
    await expect(setAutoApplyEnabled(true)).rejects.toBeInstanceOf(AutoApplyNotReady);
    await giveConsent();
    await expect(setAutoApplyEnabled(true)).rejects.toThrow("Set up your job search first");
    await saveAutoApply({ preferences, minTier: "STRONG", dailyLimit: 5, perCompanyLimit: 1, dryRun: false, answers });
    expect(await setAutoApplyEnabled(true)).toMatchObject({ enabled: true, consented: true, minTier: "STRONG", dailyLimit: 5, dryRun: false, preferences });
    expect(await setAutoApplyEnabled(false)).toMatchObject({ enabled: false });
  });

  it("asks again when the consent's wording changes", async () => {
    await switchedOn();
    await raw().autoApplySettings.updateMany({ data: { consentVersion: "2026-01-01" } });
    expect(await loadAutoApply()).toMatchObject({ enabled: false, consented: false, consentOutdated: true });
    expect(CONSENT_VERSION).not.toBe("2026-01-01");
  });

  it("refuses limits and preferences out of range", async () => {
    await expect(saveAutoApply({ preferences: { ...preferences, titles: [] }, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 2, dryRun: true, answers })).rejects.toThrow();
    await expect(saveAutoApply({ preferences, minTier: "GOOD", dailyLimit: 500, perCompanyLimit: 2, dryRun: true, answers })).rejects.toThrow();
  });
});

describe("planning applications (auto-apply step 4)", () => {
  it("does nothing until auto-apply is on", async () => {
    await job("1", "acme");
    expect(await planApplications()).toBe(0);
    expect(await prisma().applyTask.count()).toBe(0);
  });

  it("makes a task for each Strong and Good match, best first, within the per-company limit, and starts preparing it", async () => {
    await switchedOn({ perCompanyLimit: 2 });
    await job("a1", "acme", { score: 90 });
    await job("a2", "acme", { score: 88 });
    await job("a3", "acme", { score: 86 });
    await job("z1", "zeta", { tier: "GOOD" });
    await job("p1", "zeta", { tier: "PARTIAL" });
    await job("c1", "zeta", { closed: true });
    expect(await planApplications()).toBe(3);
    const tasks = await prisma().applyTask.findMany({ include: { sharedPosting: { select: { externalId: true } } } });
    expect(tasks.map((task) => task.sharedPosting.externalId).sort()).toEqual(["a1", "a2", "z1"]);
    expect(tasks.every((task) => task.state === "PREPARING")).toBe(true);
    const jobs = await prisma().job.findMany({ where: { type: "prepare-application" }, select: { key: true, priority: true, queue: true, maxAttempts: true } });
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ queue: "ai", maxAttempts: 3 });
    // Planning again changes nothing.
    expect(await planApplications()).toBe(0);
    expect(await prisma().applyTask.count()).toBe(3);
  });

  it("keeps to the daily limit and the tier chosen", async () => {
    await switchedOn({ dailyLimit: 2, minTier: "STRONG" });
    await job("1", "acme");
    await job("2", "zeta");
    await job("3", "lever");
    await job("4", "lever", { tier: "GOOD" });
    expect(await planApplications()).toBe(2);
    expect(await planApplications()).toBe(0);
    // A day later there's room again, for the Strong match left.
    expect(await planApplications(new Date(Date.now() + 25 * 3600_000))).toBe(1);
    expect(await prisma().applyTask.count()).toBe(3);
  });
});

describe("the auto-apply schedule (auto-apply step 4)", () => {
  it("runs matching once a day for a student who switched auto-apply on, and plans each round", async () => {
    await autoApplyRound();
    expect(await prisma().job.count({ where: { type: "match-jobs" } })).toBe(0);

    await switchedOn();
    await job("1", "acme");
    await autoApplyRound();
    expect(await prisma().job.count({ where: { type: "match-jobs" } })).toBe(1);
    expect(await prisma().applyTask.count()).toBe(1);
    // Within the day: no second match run.
    await prisma().job.updateMany({ where: { type: "match-jobs" }, data: { status: "DONE" } });
    await autoApplyRound();
    expect(await prisma().job.count({ where: { type: "match-jobs" } })).toBe(1);
    // A day on: another.
    await autoApplyRound(new Date(Date.now() + 25 * 3600_000));
    expect(await prisma().job.count({ where: { type: "match-jobs" } })).toBe(2);
  });

  it("goes round only the students who switched it on", async () => {
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    await runAsUser("other-student", () => switchedOn());
    await autoApplyRounds();
    expect(await runAsUser("other-student", () => prisma().job.count({ where: { type: "match-jobs" } }))).toBe(1);
    expect(await prisma().job.count({ where: { type: "match-jobs" } })).toBe(0);
  });
});

describe("preparing an application (auto-apply step 4)", () => {
  const groww: FormField[] = [
    { key: "first_name", label: "First Name", required: true, type: "text", options: [] },
    { key: "email", label: "Email", required: true, type: "text", options: [] },
    { key: "resume", label: "Resume/CV", required: true, type: "file", options: [] },
    {
      key: "question_1",
      label: "Do you provide your consent for us to conduct your background verification?",
      required: true,
      type: "single",
      options: [
        { label: "Yes", value: "1" },
        { label: "No", value: "0" },
      ],
    },
  ];

  async function plannedTask(company: "acme" | "lever" = "acme", options: { closed?: boolean } = {}) {
    await switchedOn();
    const { posting } = await job("1", company);
    await planApplications();
    if (options.closed) await raw().sharedPosting.update({ where: { id: posting.id }, data: { closedAt: new Date() } });
    return prisma().applyTask.findFirstOrThrow();
  }

  it("writes the tailored documents and answers a Greenhouse form: ready for the extension", async () => {
    form.fields = groww;
    const task = await plannedTask();
    expect(await prepareApplicationJob.run({ taskId: task.id }, context())).toEqual({ state: "READY" });
    const ready = await prisma().applyTask.findUniqueOrThrow({ where: { id: task.id }, include: { application: { include: { documents: true } } } });
    expect(ready.state).toBe("READY");
    expect(ready.reason).toBeNull();
    expect(ready.application).toMatchObject({ origin: "AUTO_APPLY", agentScore: 85, awaitingReview: false, company: "Acme" });
    expect(ready.application!.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "RESUME"]);
    expect(ready.answers).toMatchObject({ resume: { kind: "file", file: "resume" }, question_1: { kind: "option", label: "Yes" } });
  });

  it("waits for the student when the form asks something it can't answer", async () => {
    form.fields = [...groww, { key: "question_2", label: "Why do you want to join Acme?", required: true, type: "textarea", options: [] }];
    const task = await plannedTask();
    expect(await prepareApplicationJob.run({ taskId: task.id }, context())).toEqual({ state: "NEEDS_STUDENT" });
    expect((await prisma().applyTask.findUniqueOrThrow({ where: { id: task.id } })).reason).toBe("Answer this question to apply: Why do you want to join Acme?");
  });

  it("leaves forms the server can't read for the extension, and skips jobs that closed", async () => {
    const lever = await plannedTask("lever");
    expect(await prepareApplicationJob.run({ taskId: lever.id }, context())).toEqual({ state: "READY" });
    expect(form.asked).toBe(0);
    await raw().applyTask.deleteMany();
    await raw().autoApplySettings.deleteMany();
    await raw().jobMatch.deleteMany();
    await raw().sharedPosting.deleteMany();
    const closed = await plannedTask("acme", { closed: true });
    expect(await prepareApplicationJob.run({ taskId: closed.id }, context())).toEqual({ state: "SKIPPED" });
  });

  it("never makes a second application, however often it runs", async () => {
    form.fields = groww;
    const task = await plannedTask();
    await prepareApplicationJob.run({ taskId: task.id }, context());
    // As if it ran again after a crash between writing the application and finishing.
    await prisma().applyTask.update({ where: { id: task.id }, data: { state: "PREPARING" } });
    await prepareApplicationJob.run({ taskId: task.id }, context());
    await prepareApplicationJob.run({ taskId: task.id }, context());
    expect(await prisma().application.count({ where: { origin: "AUTO_APPLY" } })).toBe(1);
  });

  it("counts matches and tasks for the dashboard", async () => {
    form.fields = groww;
    const task = await plannedTask();
    await prepareApplicationJob.run({ taskId: task.id }, context());
    await job("2", "zeta", { tier: "PARTIAL" });
    const summary = await autoApplySummary();
    expect(summary.matches).toMatchObject({ STRONG: 1, PARTIAL: 1, GOOD: 0 });
    expect(summary.tasks).toMatchObject({ READY: 1, PREPARING: 0, APPLIED: 0 });
  });

  it("keeps each student's settings and tasks to themselves", async () => {
    await plannedTask();
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    expect(await runAsUser("other-student", () => prisma().applyTask.count())).toBe(0);
    expect(await runAsUser("other-student", () => loadAutoApply())).toMatchObject({ enabled: false, preferences: null });
    expect(await runAsUser("other-student", () => planApplications())).toBe(0);
  });
});
