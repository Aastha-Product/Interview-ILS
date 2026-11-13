import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { ApplicationStatus, ApplyState } from "@/generated/prisma/enums";
import { prisma, systemPrisma } from "@/lib/prisma";
import { applyStatusChange } from "@/lib/status-changes";

import type { Answer } from "./answers";
import { greenhouseAnswers } from "./greenhouse-answers";
import { loadAutoApply } from "./settings";

// Pathfinder (auto-apply step 5): the extension's side of an application. A browser leases one
// READY task at a time, fills the form, and reports how it went. Every move is one conditional
// update on the task's row (its state, and the lease for this browser), so two browsers, a late
// report, or a report from a lease that ran out can't move it the wrong way. Once the browser says
// it's pressing Submit, the task is never handed out again: no answer back means UNCERTAIN, for
// the student to check, never a second application.

/** How long a browser holds a task before pressing Submit. */
export const LEASE_MS = 10 * 60_000;
/** How long after "pressing Submit" it waits for the confirmation. */
export const SUBMIT_MS = 3 * 60_000;

export const UNCERTAIN_REASON = "Submit was pressed but Pathfinder didn't hear back. Check the employer's email or careers page, then mark it applied or skip it.";
export const DRY_RUN_REASON = "Dry run: the form was filled in your browser but not submitted. Check it in the open tab and submit it yourself, then mark it applied.";

export type LeasedTask = {
  taskId: string;
  leaseId: string;
  leaseUntil: string;
  applyUrl: string;
  system: string;
  title: string;
  company: string;
  dryRun: boolean;
  /** The form's answers by field name when the server could read the form (Greenhouse); null when the extension reads it. */
  answers: Record<string, Answer> | null;
  documents: { resume: boolean; coverLetter: boolean };
};

/**
 * Holds that ran out: a task leased but never submitted goes back to READY; one whose Submit was
 * pressed becomes UNCERTAIN. For every student (the scheduler) or only the current one (a lease).
 */
export async function sweepLeases(now = new Date(), { allStudents = false } = {}): Promise<{ released: number; uncertain: number }> {
  const db = allStudents ? systemPrisma : prisma;
  const released = await db.applyTask.updateMany({
    where: { state: ApplyState.LEASED, leaseUntil: { lt: now } },
    data: { state: ApplyState.READY, leaseId: null, leaseUntil: null },
  });
  const uncertain = await db.applyTask.updateMany({
    where: { state: ApplyState.SUBMITTING, leaseUntil: { lt: now } },
    data: { state: ApplyState.UNCERTAIN, reason: UNCERTAIN_REASON },
  });
  return { released: released.count, uncertain: uncertain.count };
}

/** The current student's next READY task for their browser, held for LEASE_MS; null when there's none or auto-apply is off. */
export async function leaseNext(now = new Date()): Promise<LeasedTask | null> {
  const settings = await loadAutoApply();
  if (!settings.enabled) return null;
  await sweepLeases(now);
  // Oldest first; a task another of the student's browsers took meanwhile is skipped.
  for (const candidate of await prisma.applyTask.findMany({ where: { state: ApplyState.READY }, orderBy: { updatedAt: "asc" }, take: 5, select: { id: true } })) {
    const leaseId = randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const { count } = await prisma.applyTask.updateMany({
      where: { id: candidate.id, state: ApplyState.READY },
      data: { state: ApplyState.LEASED, leaseId, leaseUntil, attempts: { increment: 1 } },
    });
    if (count === 0) continue;
    const task = await prisma.applyTask.findUniqueOrThrow({ where: { id: candidate.id }, include: { application: { select: { documents: { select: { kind: true } } } } } });
    const posting = await systemPrisma.sharedPosting.findUnique({
      where: { id: task.sharedPostingId },
      select: { applyUrl: true, system: true, title: true, companyName: true, location: true, externalId: true, closedAt: true, company: { select: { boardToken: true } } },
    });
    if (!posting || posting.closedAt) {
      await prisma.applyTask.updateMany({ where: { id: task.id, leaseId }, data: { state: ApplyState.SKIPPED, reason: "The job closed before it could be applied for.", leaseId: null, leaseUntil: null } });
      continue;
    }
    // Greenhouse answers were worked out when the task was prepared; re-answer now from the student's
    // current profile and saved answers, so an edit since then isn't submitted stale (QA M1). Lever and
    // Ashby forms the extension reads live when it opens them, so their answers are already current.
    let answers = (task.answers as Record<string, Answer> | null) ?? null;
    if (posting.system === "GREENHOUSE") {
      try {
        const fresh = await greenhouseAnswers(
          { boardToken: posting.company?.boardToken ?? "", externalId: posting.externalId, companyName: posting.companyName, location: posting.location },
          AbortSignal.timeout(15_000),
        );
        if (fresh.missing.length > 0) {
          // A required answer the student removed since preparing: don't submit stale — hand it back.
          await prisma.applyTask.updateMany({
            where: { id: task.id, leaseId },
            data: {
              state: ApplyState.NEEDS_STUDENT,
              reason: `Answer ${fresh.missing.length === 1 ? "this question" : "these questions"} to apply: ${fresh.missing.join("; ")}`,
              questions: fresh.questions.slice(0, 40),
              answers: fresh.answers ?? undefined,
              leaseId: null,
              leaseUntil: null,
            },
          });
          continue;
        }
        answers = fresh.answers;
      } catch {
        // Couldn't re-read Greenhouse's form (it's down or slow): fall back to the prepared answers.
      }
    }
    const kinds = new Set(task.application?.documents.map((document) => document.kind));
    return {
      taskId: task.id,
      leaseId,
      leaseUntil: leaseUntil.toISOString(),
      applyUrl: posting.applyUrl,
      system: posting.system,
      title: posting.title,
      company: posting.companyName,
      dryRun: settings.dryRun,
      answers,
      documents: { resume: kinds.has("RESUME"), coverLetter: kinds.has("COVER_LETTER") },
    };
  }
  return null;
}

/** The task a browser holds, while its lease lasts (or, once Submit was pressed, its row with that lease). */
export async function heldTask(taskId: string, leaseId: string, now = new Date()) {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId } });
  if (!task || task.leaseId !== leaseId) return null;
  if (task.state === ApplyState.LEASED && task.leaseUntil && task.leaseUntil > now) return task;
  return null;
}

export const reportSchema = z.discriminatedUnion("outcome", [
  /** About to press Submit: from here it's never handed out again. */
  z.object({ outcome: z.literal("submitting"), leaseId: z.string().min(1) }),
  /** The confirmation was seen. */
  z.object({ outcome: z.literal("applied"), leaseId: z.string().min(1), evidence: z.object({ url: z.string().max(2000), text: z.string().max(500) }) }),
  /** Filled in a dry run, not submitted. */
  z.object({ outcome: z.literal("dry-run"), leaseId: z.string().min(1) }),
  /** A puzzle, an emailed code, a question without an answer, or a form error. */
  z.object({ outcome: z.literal("needs-student"), leaseId: z.string().min(1), reason: z.string().min(1).max(500) }),
  /** Submit was pressed and no clear answer came back. */
  z.object({ outcome: z.literal("uncertain"), leaseId: z.string().min(1), reason: z.string().max(500).optional() }),
  /** The form couldn't be filled (not recognised, the page didn't load). */
  z.object({ outcome: z.literal("failed"), leaseId: z.string().min(1), reason: z.string().min(1).max(500) }),
  /** Not now (the browser is closing): back to READY, if Submit wasn't pressed. */
  z.object({ outcome: z.literal("release"), leaseId: z.string().min(1) }),
]);
export type Report = z.output<typeof reportSchema>;

/** Records what a browser reports; false when the report doesn't fit the task's state or lease (it's ignored). */
export async function reportOutcome(taskId: string, report: Report, now = new Date()): Promise<boolean> {
  const mine = { id: taskId, leaseId: report.leaseId };
  const held = { ...mine, state: ApplyState.LEASED, leaseUntil: { gt: now } };
  const move = async (where: Prisma.ApplyTaskWhereInput, data: Prisma.ApplyTaskUpdateManyMutationInput) => (await prisma.applyTask.updateMany({ where, data })).count > 0;

  switch (report.outcome) {
    case "submitting":
      return move(held, { state: ApplyState.SUBMITTING, leaseUntil: new Date(now.getTime() + SUBMIT_MS) });
    case "applied": {
      // Also after the wait ran out: a late confirmation still counts.
      const moved = await move({ ...mine, state: { in: [ApplyState.SUBMITTING, ApplyState.UNCERTAIN] } }, { state: ApplyState.APPLIED, appliedAt: now, reason: null, evidence: { ...report.evidence, at: now.toISOString() } });
      if (moved) await markApplicationSent(taskId, now);
      return moved;
    }
    case "dry-run":
      return move(held, { state: ApplyState.NEEDS_STUDENT, reason: DRY_RUN_REASON, leaseUntil: null });
    case "needs-student": {
      // Before Submit (LEASED): a question only the student can answer; they answer it and it's
      // prepared again (prepareAgain re-opens NEEDS_STUDENT).
      if (await move({ ...mine, state: ApplyState.LEASED }, { state: ApplyState.NEEDS_STUDENT, reason: report.reason, leaseUntil: null })) return true;
      // After Submit was pressed (SUBMITTING): the application may already have reached the employer
      // (a challenge, an emailed code or an error can appear after a real submit), so it must NEVER be
      // handed out again. It becomes uncertain for the student to check — not a retryable question —
      // the same as a submit that went quiet. This is what stops a second submission.
      return move({ ...mine, state: ApplyState.SUBMITTING }, { state: ApplyState.UNCERTAIN, reason: report.reason });
    }
    case "uncertain":
      return move({ ...mine, state: ApplyState.SUBMITTING }, { state: ApplyState.UNCERTAIN, reason: report.reason || UNCERTAIN_REASON });
    case "failed":
      return move(held, { state: ApplyState.FAILED, reason: report.reason, leaseUntil: null });
    case "release":
      return move(held, { state: ApplyState.READY, leaseId: null, leaseUntil: null });
  }
}

/** The application shows as sent in Applications, with its status history. */
async function markApplicationSent(taskId: string, now: Date): Promise<void> {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId }, select: { applicationId: true } });
  if (task?.applicationId) await applyStatusChange(prisma, task.applicationId, ApplicationStatus.SENT, now);
}

/** "Mark as applied", by the student: after a dry run they submitted themselves, or an uncertain one they checked. */
export async function markAppliedByStudent(taskId: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.applyTask.updateMany({
    where: { id: taskId, state: { in: [ApplyState.NEEDS_STUDENT, ApplyState.UNCERTAIN] } },
    data: { state: ApplyState.APPLIED, appliedAt: now, reason: null, evidence: { byStudent: true, at: now.toISOString() }, leaseId: null, leaseUntil: null },
  });
  if (count > 0) await markApplicationSent(taskId, now);
  return count > 0;
}
