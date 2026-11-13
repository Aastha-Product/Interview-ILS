import "server-only";

import { z } from "zod";

import { ApplyState, MatchStatus, MatchTier } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";
import { createApplicationFromDocuments, type ApplicationDetails } from "@/lib/application-create";
import type { Extracted } from "@/lib/application-data";
import { postingText } from "@/lib/job-search/search";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { RetryLater } from "@/lib/jobs/retry-later";
import { outsideDailyLimit } from "@/lib/ai/daily-limit";
import { defineJob, JOB_MESSAGES, passing, startJob, type JobContext } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { studentMessage } from "@/lib/managed";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { extensionCanApply } from "./appliable";
import { type FormAnswers, type FormField } from "./answers";
import { greenhouseAnswers } from "./greenhouse-answers";
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
        select: { id: true, companyId: true, closedAt: true, system: true, url: true, applyUrl: true },
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
    // Only forms the extension can fill: no AI spent on documents for one it would hand back.
    if (!posting || posting.closedAt || !extensionCanApply(posting)) continue;
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
  // Auto-apply's AI isn't counted towards the daily limit (src/lib/ai/daily-limit.ts).
  run: (input, context) => outsideDailyLimit(() => prepare(input, context)),
});

async function prepare({ taskId }: { taskId: string }, context: JobContext): Promise<{ state: ApplyState }> {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId }, include: { jobMatch: { select: { score: true } } } });
  if (!task || task.state !== ApplyState.PREPARING) return { state: task?.state ?? ApplyState.SKIPPED };
  const posting = await systemPrisma.sharedPosting.findUnique({ where: { id: task.sharedPostingId }, include: { company: { select: { boardToken: true } } } });

  const finish = async (state: ApplyState, data: { reason?: string | null; answers?: FormAnswers["answers"] | null; questions?: FormField[] } = {}) => {
    await prisma.applyTask.updateMany({
      where: { id: taskId, state: ApplyState.PREPARING },
      // The questions it waits on, for the student to answer on the Auto-apply page (questions.ts).
      data: { state, reason: data.reason ?? null, questions: (data.questions ?? []).slice(0, 40), ...(data.answers !== undefined ? { answers: data.answers ?? undefined } : {}) },
    });
    return { state };
  };
  if (!posting || posting.closedAt) return finish(ApplyState.SKIPPED, { reason: "The job closed before its application was ready." });

  try {
    // Greenhouse publishes its forms, so they're answered first: a form asking something the
    // student hasn't answered waits for them before any AI is spent tailoring documents for it.
    // The extension reads other forms when it opens them and asks for answers then (step 5).
    let answers: FormAnswers["answers"] | null = null;
    if (posting.system === "GREENHOUSE") {
      await context.step("Reading the application form");
      const form = await greenhouseAnswers({ boardToken: posting.company.boardToken, externalId: posting.externalId, companyName: posting.companyName, location: posting.location }, context.signal);
      if (form.missing.length > 0) return finish(ApplyState.NEEDS_STUDENT, { reason: needsAnswers(form.missing), answers: form.answers, questions: form.questions });
      answers = form.answers;
    }
    if (!task.applicationId) await writeApplication(taskId, posting, task.jobMatch.score ?? 0, context);
    return finish(ApplyState.READY, { answers });
  } catch (error) {
    // A failure that's final, or that waiting won't fix, is kept with the task in the student's
    // words. A wait for a rate limit isn't one: the runner queues the job again.
    if (!context.signal.aborted && !(error instanceof RetryLater) && (context.finalAttempt || !passing(error))) {
      const message = error instanceof AiError ? studentMessage(error.message) : error instanceof ActionError ? error.message : JOB_MESSAGES.failed;
      await finish(ApplyState.FAILED, { reason: message }).catch(() => {});
    }
    throw error;
  }
}

/**
 * Try again: an application waiting for the student, or that failed, is prepared again, with
 * their answers and profile as they are now. Returns false when it's in no state to.
 */
export async function prepareAgain(taskId: string): Promise<boolean> {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId }, include: { jobMatch: { select: { score: true } } } });
  if (!task) return false;
  const { count } = await prisma.applyTask.updateMany({
    where: { id: taskId, state: { in: [ApplyState.NEEDS_STUDENT, ApplyState.FAILED] } },
    data: { state: ApplyState.PREPARING, reason: null, questions: [] },
  });
  if (count === 0) return false;
  await startJob(prepareApplicationJob, { taskId }, { key: prepareJobKey(taskId), priority: task.jobMatch.score ?? 0 });
  return true;
}

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
