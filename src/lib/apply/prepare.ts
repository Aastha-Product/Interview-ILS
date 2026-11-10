import "server-only";

import { z } from "zod";

import { ApplyState, MatchStatus, MatchTier } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";
import { createApplicationFromDocuments, type ApplicationDetails } from "@/lib/application-create";
import type { Extracted } from "@/lib/application-data";
import { postingText } from "@/lib/job-search/search";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { defineJob, JOB_MESSAGES, passing, startJob, type JobContext } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { studentMessage } from "@/lib/managed";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

import { answerForm, type AnswerContext, type FormAnswers } from "./answers";
import { greenhouseForm } from "./greenhouse-form";
import { loadAutoApply } from "./settings";

// Pathfinder (auto-apply step 4): preparing applications. Once a student has switched auto-apply
// on, their best matches (Strong, or Strong and Good) become apply tasks, within their limits: so
// many a day, and so many per company in 30 days. Each task gets a "prepare-application" job that
// writes the tailored resume and cover letter the way New application does (the fact guard
// included), makes the application, and answers the form. A task whose form asks something the
// profile and saved answers don't cover waits for the student; the rest are READY for the
// extension (step 5).

const DAY_MS = 24 * 3600_000;
const COMPANY_WINDOW_MS = 30 * DAY_MS;
/** States that count against the limits: everything except what never went anywhere. */
const COUNTED = [ApplyState.PREPARING, ApplyState.READY, ApplyState.LEASED, ApplyState.SUBMITTING, ApplyState.APPLIED, ApplyState.NEEDS_STUDENT, ApplyState.UNCERTAIN];

export const prepareJobKey = (taskId: string) => `apply:${taskId}`;

/**
 * Turns the current student's best scored matches into apply tasks, as many as their limits allow
 * now, and starts preparing them. Safe to call often: a match becomes a task once. Returns how
 * many it started.
 */
export async function planApplications(now = new Date()): Promise<number> {
  const settings = await loadAutoApply();
  if (!settings.enabled) return 0;

  const today = await prisma.applyTask.count({ where: { state: { in: COUNTED }, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
  let room = settings.dailyLimit - today;
  if (room <= 0) return 0;

  const tiers = settings.minTier === MatchTier.STRONG ? [MatchTier.STRONG] : [MatchTier.STRONG, MatchTier.GOOD];
  const matches = await prisma.jobMatch.findMany({
    where: { status: MatchStatus.SCORED, tier: { in: tiers }, applyTask: null },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    take: 200,
  });
  if (matches.length === 0) return 0;

  // The jobs are shared; which company each is at decides the per-company limit.
  const postings = new Map(
    (
      await systemPrisma.sharedPosting.findMany({
        where: { id: { in: matches.map((match) => match.sharedPostingId) } },
        select: { id: true, companyId: true, closedAt: true },
      })
    ).map((posting) => [posting.id, posting]),
  );
  const recent = await prisma.applyTask.findMany({
    where: { state: { in: COUNTED }, createdAt: { gte: new Date(now.getTime() - COMPANY_WINDOW_MS) } },
    select: { sharedPostingId: true },
  });
  const recentCompanies = new Map<string, number>();
  for (const posting of await systemPrisma.sharedPosting.findMany({ where: { id: { in: recent.map((task) => task.sharedPostingId) } }, select: { companyId: true } })) {
    recentCompanies.set(posting.companyId, (recentCompanies.get(posting.companyId) ?? 0) + 1);
  }

  let started = 0;
  for (const match of matches) {
    if (room <= 0) break;
    const posting = postings.get(match.sharedPostingId);
    if (!posting || posting.closedAt) continue;
    if ((recentCompanies.get(posting.companyId) ?? 0) >= settings.perCompanyLimit) continue;
    // One task per student and job, ever (a unique key); another run may have made it meanwhile.
    const task = await prisma.applyTask
      .create({ data: { jobMatchId: match.id, sharedPostingId: match.sharedPostingId }, select: { id: true } })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "P2002") return null;
        throw error;
      });
    if (!task) continue;
    await startJob(prepareApplicationJob, { taskId: task.id }, { key: prepareJobKey(task.id), priority: match.score ?? 0 });
    recentCompanies.set(posting.companyId, (recentCompanies.get(posting.companyId) ?? 0) + 1);
    room--;
    started++;
  }
  return started;
}

/** The application's details from what was read, as New application fills them in. */
function detailsFrom(extracted: Extracted, fallback: { title: string; company: string; location: string }): ApplicationDetails {
  return {
    title: extracted.title ?? ([extracted.role, extracted.company].filter(Boolean).join(" · ") || fallback.title),
    company: extracted.company ?? fallback.company,
    role: extracted.role ?? fallback.title,
    location: extracted.location ?? fallback.location,
    mode: extracted.mode ?? "",
    salary: extracted.salary ?? "",
    deadline: extracted.deadline ?? "",
  };
}

/** What the answers can draw on, from the profile and the saved answers. */
async function answerContext(company: string): Promise<AnswerContext> {
  const [profile, settings] = await Promise.all([loadProfile(), loadAutoApply()]);
  const years = profile.education.map((entry) => (entry.current ? null : entry.endYear)).filter((year): year is number => year !== null);
  return {
    basics: {
      name: profile.basics.name,
      email: profile.basics.email,
      phone: profile.basics.phone,
      city: profile.basics.city,
      country: profile.basics.country,
      linkedin: profile.basics.linkedin,
      website: profile.basics.website,
    },
    pastEmployers: profile.experience.map((entry) => entry.company).filter(Boolean),
    graduationYear: years.length > 0 ? String(Math.max(...years)) : "",
    company,
    saved: settings.answers,
  };
}

/** Writes a task's documents and application, unless an earlier run of the job already did. */
async function writeApplication(taskId: string, posting: { title: string; companyName: string; location: string; remote: boolean | null; salary: string; description: string; url: string }, score: number, context: JobContext): Promise<string> {
  const text = postingText({ title: posting.title, company: posting.companyName, place: posting.location, remote: posting.remote, salary: posting.salary, description: posting.description });
  await context.step(`Reading the posting from ${posting.companyName}`);
  const reading = await readPostingJob.run({ posting: text }, context);
  await context.step(`Tailoring your resume and cover letter for ${posting.companyName}`);
  const settings = await loadSettings();
  const documents = await writeDocumentsJob.run({ readJobId: context.id, posting: text, extracted: reading.extracted, match: reading.match, tone: settings.defaultTone, note: "" }, context);
  return createApplicationFromDocuments({
    reading: { posting: text, ...reading },
    documents,
    match: reading.match,
    details: detailsFrom(reading.extracted, { title: posting.title, company: posting.companyName, location: posting.location }),
    postingUrl: posting.url,
    tone: settings.defaultTone,
    note: "",
    claim: { kind: "auto-apply", taskId, score },
  });
}

/** The words for a task waiting on the student's answers. */
export const needsAnswers = (missing: string[]) => `Answer ${missing.length === 1 ? "this question" : "these questions"} to apply: ${missing.join("; ")}`;

export const prepareApplicationJob = defineJob({
  type: "prepare-application",
  input: z.object({ taskId: z.string().min(1) }),
  result: z.object({ state: z.enum(ApplyState) }),
  queue: "ai",
  attempts: 3,
  async run({ taskId }, context) {
    const task = await prisma.applyTask.findUnique({ where: { id: taskId }, include: { jobMatch: { select: { score: true } } } });
    if (!task || task.state !== ApplyState.PREPARING) return { state: task?.state ?? ApplyState.SKIPPED };
    const posting = await systemPrisma.sharedPosting.findUnique({ where: { id: task.sharedPostingId }, include: { company: { select: { boardToken: true } } } });

    const finish = async (state: ApplyState, data: { reason?: string | null; answers?: FormAnswers["answers"] | null } = {}) => {
      await prisma.applyTask.updateMany({
        where: { id: taskId, state: ApplyState.PREPARING },
        data: { state, reason: data.reason ?? null, ...(data.answers !== undefined ? { answers: data.answers ?? undefined } : {}) },
      });
      return { state };
    };
    if (!posting || posting.closedAt) return finish(ApplyState.SKIPPED, { reason: "The job closed before its application was ready." });

    try {
      if (!task.applicationId) await writeApplication(taskId, posting, task.jobMatch.score ?? 0, context);

      // Greenhouse publishes its forms, so they're answered now; the extension reads other forms
      // when it opens them and asks for answers then (step 5).
      if (posting.system !== "GREENHOUSE") return finish(ApplyState.READY);
      await context.step("Answering the application form");
      const fields = await greenhouseForm(posting.company.boardToken, posting.externalId, context.signal);
      const { answers, missing } = answerForm(fields, await answerContext(posting.companyName));
      if (missing.length > 0) return finish(ApplyState.NEEDS_STUDENT, { reason: needsAnswers(missing), answers });
      return finish(ApplyState.READY, { answers });
    } catch (error) {
      // A failure that's final, or that waiting won't fix, is kept with the task in the student's words.
      if (!context.signal.aborted && (context.finalAttempt || !passing(error))) {
        const message = error instanceof AiError ? studentMessage(error.message) : error instanceof ActionError ? error.message : JOB_MESSAGES.failed;
        await finish(ApplyState.FAILED, { reason: message }).catch(() => {});
      }
      throw error;
    }
  },
});

export type AutoApplySummary = {
  matches: Record<"STRONG" | "GOOD" | "PARTIAL" | "NOT_RECOMMENDED" | "pending" | "failed", number>;
  tasks: Record<ApplyState, number>;
};

/** What the dashboard counts for the current student. */
export async function autoApplySummary(): Promise<AutoApplySummary> {
  const [byTier, byStatus, byState] = await Promise.all([
    prisma.jobMatch.groupBy({ by: ["tier"], where: { status: MatchStatus.SCORED }, _count: { _all: true } }),
    prisma.jobMatch.groupBy({ by: ["status"], where: { status: { not: MatchStatus.SCORED } }, _count: { _all: true } }),
    prisma.applyTask.groupBy({ by: ["state"], _count: { _all: true } }),
  ]);
  const matches: AutoApplySummary["matches"] = { STRONG: 0, GOOD: 0, PARTIAL: 0, NOT_RECOMMENDED: 0, pending: 0, failed: 0 };
  for (const row of byTier) if (row.tier) matches[row.tier] = row._count._all;
  for (const row of byStatus) matches[row.status === MatchStatus.FAILED ? "failed" : "pending"] += row._count._all;
  const tasks = Object.fromEntries(Object.values(ApplyState).map((state) => [state, 0])) as Record<ApplyState, number>;
  for (const row of byState) tasks[row.state] = row._count._all;
  return { matches, tasks };
}
