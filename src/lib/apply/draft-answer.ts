import "server-only";

import { ApplyState } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { draftFormAnswer } from "@/lib/ai/tasks/draft-form-answer";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { taskQuestions } from "./questions";

// Pathfinder (Phase 1): "Draft with AI" on a question an application is waiting on. It writes a
// first draft from the profile and the posting and hands it back to fill the field; nothing is
// saved. The student edits it and saves it with the rest of their answers (questions.ts), which is
// their approval.

export type DraftAnswerOutcome =
  | { kind: "drafted"; text: string }
  /** The profile doesn't give what the question needs: the student answers it themself. */
  | { kind: "empty" }
  /** The application isn't waiting for answers, or the question isn't one to write. */
  | { kind: "gone" }
  | { kind: "no-ai" };

/** Whether a question is one an AI draft can help with: written, not chosen, and askable here. */
export const draftable = (question: { type: string; here: boolean }) => question.here && (question.type === "text" || question.type === "textarea");

/** A draft answer to one of a waiting application's questions, by the question's key. */
export async function draftAnswer(taskId: string, questionKey: string, signal?: AbortSignal): Promise<DraftAnswerOutcome> {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId }, select: { state: true, questions: true, sharedPostingId: true } });
  if (!task || task.state !== ApplyState.NEEDS_STUDENT) return { kind: "gone" };
  const question = taskQuestions(task.questions).find((entry) => entry.key === questionKey);
  if (!question || !draftable(question)) return { kind: "gone" };
  if (!(await isAiConfigured())) return { kind: "no-ai" };

  // Shared postings belong to no student, so they're read outside the student's scope.
  const posting = await systemPrisma.sharedPosting.findUnique({ where: { id: task.sharedPostingId }, select: { title: true, companyName: true, description: true } });
  if (!posting) return { kind: "gone" };

  const [provider, profile, options] = await Promise.all([getAiProvider(), loadProfile(), loadTaskOptions()]);
  const { data } = await draftFormAnswer(
    provider,
    { profile, question: question.label, long: question.type === "textarea", job: { title: posting.title, company: posting.companyName, description: posting.description } },
    { ...options, signal },
  );
  return data ? { kind: "drafted", text: data } : { kind: "empty" };
}
