// Pathfinder: a check of the whole auto-apply pipeline against the real job boards, run by hand
// (PATHFINDER_PIPELINE_CHECK=1), never in CI: it reads every starter company's public board, which
// takes several minutes. The AI is a stand-in, so no key is used and nothing is spent; the job
// boards, Postgres, the queue, ranking, planning, preparation and answering are all real.
//
//   $env:PATHFINDER_PIPELINE_CHECK = "1"
//   corepack yarn vitest run --project db src/lib/pipeline-check.db.test.ts --reporter=verbose --silent=false
//
// Each part prints a "CHECK" line with what it measured.

import { afterAll, describe, expect, it, vi } from "vitest";

import { EMPTY_ANSWERS } from "@/lib/apply/answers";
import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";

import { MockProvider } from "./ai/providers/mock";

const LIVE = process.env.PATHFINDER_PIPELINE_CHECK === "1";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
// Jobs run in this process, up to 20 at once, as on a worker with a hosted AI.
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  const overrides: Record<string, unknown> = { PATHFINDER_ROLE: "all", PATHFINDER_JOB_CONCURRENCY: 20, PATHFINDER_JOBS_PER_STUDENT: 2 };
  return { ...original, env: new Proxy(original.env, { get: (target, key) => (typeof key === "string" && key in overrides ? overrides[key] : Reflect.get(target, key)) }) };
});
vi.mock("@/lib/ai/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/config")>()), loadAiConfig: async () => ({ provider: "ANTHROPIC" }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
// The stand-in scorer: a job whose title shares a word with the target roles fits.
const scoring = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/scoring", () => ({
  loadPostingScorer: async () => async (posting: { title: string }) => {
    scoring.calls++;
    const score = /analyst|analytics|data/i.test(posting.title) ? 86 : /engineer|developer/i.test(posting.title) ? 70 : 45;
    return { data: { score, reasons: ["Stand-in reason"], redFlags: [] }, scoredWith: "stand-in" };
  },
}));
// The stand-in writer, for reading postings and writing the documents.
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        switch (call.json?.name) {
          case "extracted_posting":
            return { title: "Job", company: "Company", role: "Role", location: "India", mode: "", salary: "", deadline: null, requirements: [], asksForReferences: false, language: "English" };
          case "requirement_matches":
            return { matches: [] };
          case "tailored_resume":
            return { summary: "Stand-in summary.", roles: [], projects: [], skills: [], education: [] };
          case "cover_letter":
            return { recipient: "Hiring team", greeting: "Dear team,", paragraphs: [{ label: "Opening", text: "Stand-in letter." }], signOff: "Regards," };
          default:
            throw new Error(`No answer for ${call.json?.name}`);
        }
      },
    }),
}));

// Loads the mocked database module, which creates the client; nothing else here imports it up front.
await import("@/lib/prisma");
const raw = () => rawClientOf(db.client!);
afterAll(() => db.client?.$disconnect());

const preferences = { titles: ["Data Analyst", "Software Engineer"], skills: ["SQL", "Python", "Excel", "Java"], countries: ["in"], cities: ["Bengaluru", "Pune", "Hyderabad", "Mumbai", "Gurugram", "Noida", "Delhi", "Chennai"], remoteOk: true, level: "entry" as const, employmentTypes: [] };
const fullAnswers = {
  ...EMPTY_ANSWERS,
  onsiteOk: true,
  workAuthorized: true,
  needsSponsorship: false,
  noticePeriod: "immediate" as const,
  // What a fresher writes for current pay.
  currentSalary: "0",
  expectedSalary: "6 LPA",
  relativesAtCompany: false,
  backgroundCheckConsent: true,
  acceptPrivacyNotices: true,
  outsideActivities: false,
  willingToRelocate: true,
  graduationYear: "2026",
  adult: true,
  employmentRestrictions: false,
  governmentOfficial: false,
  relativeOfGovernmentOfficial: false,
  referredByEmployee: false,
};

/** A fresher's profile as forms see it: an internship, a university and an address. */
const fresher = {
  basics: { name: "Asha Verma", email: "asha@example.com", phone: "+91 98765 43210", city: "Pune", country: "India", linkedin: "https://linkedin.com/in/asha", website: "https://asha.dev", address: "12 MG Road, Pune 411001", dob: "2004-05-17" },
  pastEmployers: ["Persistent Systems"],
  currentCompany: "Persistent Systems",
  currentTitle: "Data Analyst Intern",
  university: "Savitribai Phule Pune University",
  // A six-month internship.
  experienceMonths: 6,
  experienceMonthsWithoutInternships: 0,
  graduationYear: "2026",
};

// PATHFINDER_PIPELINE_REUSE=1 keeps the jobs already crawled into this database, to check the rest
// again without the crawl's 12 minutes.
const REUSE = process.env.PATHFINDER_PIPELINE_REUSE === "1";

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// The parts build on each other and run in order, as tests in one file do.
describe.skipIf(!LIVE)("the auto-apply pipeline against the real job boards", () => {
  it("1. crawls every starter company", { timeout: 40 * 60_000 }, async () => {
    if (REUSE && (await raw().sharedPosting.count({ where: { closedAt: null } })) > 0) {
      // The students' side starts again; the shared jobs stay.
      for (const table of ["applyTask", "autoApplySettings", "jobMatch", "job", "application", "providerBudget"] as const) await (raw()[table] as { deleteMany: () => Promise<unknown> }).deleteMany();
      await raw().user.deleteMany({ where: { id: { startsWith: "load-student-" } } });
      // As a crawl now stores them: our name for the company, not the board's.
      await raw().$executeRaw`UPDATE "SharedPosting" p SET "companyName" = c.name FROM "Company" c WHERE p."companyId" = c.id AND p.system = 'GREENHOUSE'`;
      console.log(`CHECK crawl: reused ${await raw().sharedPosting.count({ where: { closedAt: null } })} open jobs already crawled`);
      return;
    }
    await resetDatabase(db.client!);
    await seedBuiltIns(db.client!);
    for (const table of ["applyTask", "autoApplySettings", "jobMatch", "sharedPosting", "company", "providerBudget"] as const) await (raw()[table] as { deleteMany: () => Promise<unknown> }).deleteMany();
    const { addStarterCompanies, crawlAndRecord } = await import("@/lib/crawl/crawl");
    await addStarterCompanies();
    const companies = await raw().company.findMany({ orderBy: { system: "asc" } });
    const started = Date.now();
    // Four at a time: the systems' shared rate limits pace them.
    const queue = [...companies];
    const results: string[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let company = queue.shift(); company; company = queue.shift()) {
          const outcome = await crawlAndRecord(company);
          const row = await raw().company.findUniqueOrThrow({ where: { id: company.id } });
          results.push(`${company.system}:${company.boardToken}=${outcome ? row.openJobs : `FAILED (${row.lastError})`}`);
        }
      }),
    );
    const open = await raw().sharedPosting.count({ where: { closedAt: null } });
    const failed = results.filter((line) => line.includes("FAILED"));
    console.log(`CHECK crawl: ${companies.length} companies, ${open} open jobs kept, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
    console.log(`CHECK crawl detail: ${results.sort().join(" | ")}`);
    expect(open).toBeGreaterThan(0);
  });

  it("2. answers real Greenhouse forms", { timeout: 20 * 60_000 }, async () => {
    const { greenhouseForm } = await import("@/lib/apply/greenhouse-form");
    const { answerForm } = await import("@/lib/apply/answers");
    const postings = await raw().sharedPosting.findMany({ where: { system: "GREENHOUSE", closedAt: null }, include: { company: { select: { boardToken: true } } } });
    // A few jobs from each company, so one company's form doesn't decide the result.
    const byCompany = new Map<string, typeof postings>();
    for (const posting of postings) byCompany.set(posting.companyId, [...(byCompany.get(posting.companyId) ?? []), posting].slice(0, 5));
    const sample = [...byCompany.values()].flat();
    const unanswered = new Map<string, number>();
    let complete = 0;
    let failed = 0;
    for (const posting of sample) {
      try {
        const fields = await greenhouseForm(posting.company.boardToken, posting.externalId, AbortSignal.timeout(60_000));
        const { missing } = answerForm(fields, { ...fresher, company: posting.companyName, saved: fullAnswers });
        if (missing.length === 0) complete++;
        for (const label of missing) {
          const key = label.toLowerCase().replace(/\s+/g, " ").slice(0, 90);
          unanswered.set(key, (unanswered.get(key) ?? 0) + 1);
        }
      } catch {
        failed++;
      }
    }
    const top = [...unanswered.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`CHECK forms: ${sample.length} forms from ${byCompany.size} companies, ${complete} answerable in full (${Math.round((100 * complete) / Math.max(1, sample.length - failed))}%), ${failed} couldn't be read`);
    console.log(`CHECK forms unanswered: ${top.map(([label, count]) => `${count}× ${label}`).join(" | ")}`);
    expect(sample.length).toBeGreaterThan(0);
  });

  it("3. matches and prepares applications for one student", { timeout: 20 * 60_000 }, async () => {
    const { saveAutoApply, giveConsent, setAutoApplyEnabled } = await import("@/lib/apply/settings");
    const { startMatchRun } = await import("@/lib/match/jobs");
    const { getJob, startWorker } = await import("@/lib/jobs/runner");
    const { autoApplySummary } = await import("@/lib/apply/prepare");
    const { saveSettings } = await import("@/lib/settings-data");
    startWorker();
    await saveSettings({ pageLimit: "none" });
    await saveAutoApply({ preferences, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 2, dryRun: true, answers: fullAnswers });
    await giveConsent();
    await setAutoApplyEnabled(true);
    const started = Date.now();
    const run = await startMatchRun(preferences);
    await until(async () => (await getJob(run))?.status === "DONE", 120_000);
    const done = await until(async () => (await raw().job.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) === 0, 10 * 60_000);
    const summary = await autoApplySummary();
    const failures = await raw().job.findMany({ where: { status: "FAILED" }, select: { type: true, error: true } });
    console.log(`CHECK one student: run ${JSON.stringify((await getJob(run))?.result)}, settled ${done}, ${Math.round((Date.now() - started) / 1000)} s`);
    console.log(`CHECK one student matches ${JSON.stringify(summary.matches)} tasks ${JSON.stringify(summary.tasks)}`);
    const waiting = await raw().applyTask.findMany({ where: { state: "NEEDS_STUDENT" }, select: { reason: true } });
    console.log(`CHECK one student needs-you: ${waiting.map((task) => task.reason).join(" || ") || "none"}`);
    console.log(`CHECK one student failed jobs: ${failures.map((job) => `${job.type}: ${job.error}`).join(" | ") || "none"}`);
    expect(failures).toEqual([]);
  });

  it("4. runs 100 students at once without duplicates or crossed data", { timeout: 40 * 60_000 }, async () => {
    const { saveAutoApply, giveConsent, setAutoApplyEnabled } = await import("@/lib/apply/settings");
    const { startMatchRun } = await import("@/lib/match/jobs");
    const { saveSettings } = await import("@/lib/settings-data");
    const students = Array.from({ length: 100 }, (_, index) => `load-student-${index}`);
    await raw().user.createMany({ data: students.map((id) => ({ id, email: `${id}@example.test` })) });
    const callsBefore = scoring.calls;
    const started = Date.now();
    // Every student sets up and starts at the same moment.
    await Promise.all(
      students.map((id) =>
        runAsUser(id, async () => {
          await saveSettings({ pageLimit: "none" });
          await saveAutoApply({ preferences, minTier: "GOOD", dailyLimit: 5, perCompanyLimit: 2, dryRun: true, answers: fullAnswers });
          await giveConsent();
          await setAutoApplyEnabled(true);
          await startMatchRun(preferences, 10);
        }),
      ),
    );
    const settled = await until(async () => (await raw().job.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) === 0, 35 * 60_000);
    const seconds = Math.round((Date.now() - started) / 1000);
    const failed = await raw().job.groupBy({ by: ["type", "error"], where: { status: "FAILED", userId: { in: students } }, _count: { _all: true } });
    const tasks = await raw().applyTask.findMany({ where: { userId: { in: students } }, select: { userId: true, sharedPostingId: true, jobMatchId: true, state: true, applicationId: true } });
    const matches = new Map((await raw().jobMatch.findMany({ where: { userId: { in: students } }, select: { id: true, userId: true } })).map((match) => [match.id, match.userId]));
    const applications = new Map(
      (await raw().application.findMany({ where: { userId: { in: students }, origin: "AUTO_APPLY" }, select: { id: true, userId: true } })).map((application) => [application.id, application.userId]),
    );
    const duplicates = tasks.length - new Set(tasks.map((task) => `${task.userId}:${task.sharedPostingId}`)).size;
    const crossed = tasks.filter((task) => matches.get(task.jobMatchId) !== task.userId || (task.applicationId && applications.get(task.applicationId) !== task.userId)).length;
    const perStudent = students.map((id) => tasks.filter((task) => task.userId === id).length);
    const states = tasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.state]: (counts[task.state] ?? 0) + 1 }), {});
    console.log(`CHECK 100 students: settled ${settled} in ${seconds} s; ${scoring.calls - callsBefore} scorings; ${tasks.length} tasks ${JSON.stringify(states)}; ${applications.size} applications`);
    console.log(`CHECK 100 students: duplicates ${duplicates}, crossed between students ${crossed}, most tasks for one student ${Math.max(...perStudent)} (limit 5), failed jobs ${JSON.stringify(failed.map((row) => ({ type: row.type, error: row.error, count: row._count._all })))}`);
    expect(duplicates).toBe(0);
    expect(crossed).toBe(0);
    expect(Math.max(...perStudent)).toBeLessThanOrEqual(5);
  });
});
