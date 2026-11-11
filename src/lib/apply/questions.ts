import "server-only";

import { z } from "zod";

import { ApplyState } from "@/generated/prisma/enums";
import { CURRENT_USER } from "@/lib/owner/scope";
import { prisma } from "@/lib/prisma";

import { askableHere, customKey, savedAnswersSchema, type SavedAnswers } from "./answers";
import { prepareAgain } from "./prepare";

// Pathfinder (auto-apply): answering an application's questions on the Auto-apply page. When a
// form asks something the profile and Set up job search don't cover ("Have you used PyTorch?"),
// the questions are kept with the task (ApplyTask.questions). The student answers them here
// instead of in the job site's tab; the answers are kept by each question's wording, so a later
// form asking the same thing gets them too, and the application is prepared again.
//
// The questions come from job sites: they're shown as plain text, and only an answer that's one
// of a question's own options is kept for a question with options.

/** How many of a task's questions are kept and shown. */
export const QUESTIONS_KEPT = 40;
/** How many answers a student keeps by wording; the oldest go first. */
const CUSTOM_KEPT = 300;

const stored = z
  .array(
    z.object({
      key: z.string().min(1).max(300),
      label: z.string().max(2000),
      required: z.boolean().catch(true),
      type: z.enum(["text", "textarea", "file", "single", "multi", "hidden"]),
      options: z.array(z.object({ label: z.string().max(500), value: z.string().max(500) })).max(300).catch([]),
    }),
  )
  .max(200)
  .catch([]);

/** A question as the Auto-apply page shows it. */
export type TaskQuestion = {
  key: string;
  label: string;
  type: "text" | "textarea" | "single" | "multi" | "file" | "hidden";
  /** The choices, by their words, for a question with some. */
  options: string[];
  /** Whether it can be answered on the page; a file, a signature or a question about who the student is can't. */
  here: boolean;
};

/** A task's kept questions, read back. */
export function taskQuestions(json: unknown): TaskQuestion[] {
  return stored
    .parse(json ?? [])
    .slice(0, QUESTIONS_KEPT)
    .map((field) => ({ key: field.key, label: field.label.trim().slice(0, 500), type: field.type, options: field.options.map((option) => option.label), here: askableHere(field) }));
}

export type GivenAnswers = Record<string, string | string[]>;

/**
 * Keeps the student's answers to a waiting application's questions and prepares it again.
 * "gone" when the application isn't waiting any more; "nothing" when no answer was given that
 * fits a question.
 */
export async function answerQuestions(taskId: string, given: GivenAnswers): Promise<"answered" | "nothing" | "gone"> {
  const task = await prisma.applyTask.findUnique({ where: { id: taskId }, select: { state: true, questions: true } });
  if (!task || task.state !== ApplyState.NEEDS_STUDENT) return "gone";

  const custom: SavedAnswers["custom"] = {};
  for (const question of taskQuestions(task.questions)) {
    if (!question.here) continue;
    const answer = given[question.key];
    const chosen = (Array.isArray(answer) ? answer : [answer ?? ""]).map((value) => value.trim()).filter(Boolean);
    if (chosen.length === 0) continue;
    if (question.type === "single" || question.type === "multi") {
      // Only the form's own choices; one for a question that takes one.
      const options = question.options.filter((option) => chosen.includes(option));
      if (options.length > 0) custom[customKey(question.label)] = { label: question.label, options: question.type === "single" ? options.slice(0, 1) : options };
    } else {
      custom[customKey(question.label)] = { label: question.label, text: chosen[0].slice(0, 2000) };
    }
  }
  if (Object.keys(custom).length === 0) return "nothing";

  const row = await prisma.autoApplySettings.findUnique({ where: { userId: CURRENT_USER }, select: { answers: true } });
  const saved = savedAnswersSchema.parse(row?.answers ?? {});
  // The newest last, so the oldest are the ones dropped past the limit.
  const merged = Object.entries({ ...Object.fromEntries(Object.entries(saved.custom).filter(([key]) => !(key in custom))), ...custom }).slice(-CUSTOM_KEPT);
  const answers = { ...saved, custom: Object.fromEntries(merged) };
  await prisma.autoApplySettings.upsert({ where: { userId: CURRENT_USER }, create: { answers }, update: { answers } });

  return (await prepareAgain(taskId)) ? "answered" : "gone";
}
