"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplyState } from "@/generated/prisma/enums";
import { ActionError, toolAction } from "@/lib/action";
import { markAppliedByStudent } from "@/lib/apply/lease";
import { planApplications, prepareAgain } from "@/lib/apply/prepare";
import { answerQuestions } from "@/lib/apply/questions";
import { createExtensionToken, revokeExtensionToken } from "@/lib/extension/tokens";
import { missingAnswersMessage } from "@/lib/apply/answers";
import { AutoApplyNotReady, giveConsent, loadAutoApply, missingIn, saveAutoApply, setAutoApplyEnabled, settingsInputSchema } from "@/lib/apply/settings";
import { startMatchRun } from "@/lib/match/jobs";
import { prisma } from "@/lib/prisma";

// Pathfinder (auto-apply step 4): the auto-apply screens' actions. Nothing here submits anything:
// that's the extension's, from the student's own browser (step 5).

const PATHS = ["/auto-apply", "/auto-apply/setup", "/auto-apply/extension"];
const refresh = () => PATHS.forEach((path) => revalidatePath(path));

/** Set up job search: what to look for, the answers forms ask for, and the limits. */
export const saveJobSearch = toolAction(settingsInputSchema, async (input, { toast }) => {
  // Every starred answer is required (the page checks too): without them applications stop at
  // questions nearly every form asks.
  const missing = missingIn(input);
  if (missing.length > 0) throw new ActionError(missingAnswersMessage(missing));
  await saveAutoApply(input);
  refresh();
  toast("Job search saved.");
  return null;
});

/** "I agree" to the current consent wording. */
export const agreeToAutoApply = toolAction(z.object({}), async () => {
  await giveConsent();
  refresh();
  return null;
});

/** Switches auto-apply on or off; switching on finds matches straight away. */
export const switchAutoApply = toolAction(z.object({ enabled: z.boolean() }), async ({ enabled }, { toast }) => {
  try {
    await setAutoApplyEnabled(enabled);
  } catch (error) {
    if (error instanceof AutoApplyNotReady) throw new ActionError(error.message);
    throw error;
  }
  if (enabled) {
    const { preferences } = await loadAutoApply();
    await startMatchRun(preferences);
    await planApplications();
    toast("Auto-apply is on. Finding jobs that fit you now.");
  } else {
    toast("Auto-apply is off. Nothing new will be prepared or submitted.");
  }
  refresh();
  return null;
});

/** Find matches now, rather than at the next daily run. */
export const findMatchesNow = toolAction(z.object({}), async () => {
  const { preferences } = await loadAutoApply();
  if (!preferences) throw new ActionError("Set up your job search first.");
  const jobId = await startMatchRun(preferences);
  refresh();
  return { jobId };
});

/** Try again, after updating the answers or the profile. */
export const prepareApplicationAgain = toolAction(z.object({ taskId: z.string().min(1) }), async ({ taskId }, { toast }) => {
  if (!(await prepareAgain(taskId))) throw new ActionError("That application can't be tried again now.");
  refresh();
  toast("Preparing it again with your latest answers.");
  return null;
});

/**
 * Answer and try again: the student's answers to the questions an application is waiting on.
 * They're kept by each question's wording, for later forms that ask the same, and the application
 * is prepared again.
 */
export const answerApplicationQuestions = toolAction(
  z.object({
    taskId: z.string().min(1),
    answers: z.record(z.string().max(300), z.union([z.string().max(2000), z.array(z.string().max(500)).max(50)])),
  }),
  async ({ taskId, answers }, { toast }) => {
    const outcome = await answerQuestions(taskId, answers);
    if (outcome === "nothing") throw new ActionError("Answer at least one of the questions first.");
    if (outcome === "gone") throw new ActionError("That application isn't waiting for answers any more.");
    refresh();
    toast("Saved. Preparing it again with your answers.");
    return null;
  },
);

/** Mark as applied: after a dry run the student submitted themselves, or an uncertain one they checked. */
export const markApplied = toolAction(z.object({ taskId: z.string().min(1) }), async ({ taskId }, { toast }) => {
  if (!(await markAppliedByStudent(taskId))) throw new ActionError("That application can't be marked applied now.");
  refresh();
  toast("Marked as applied.");
  return null;
});

/**
 * Connect the extension: a token for this browser's Pathfinder extension. The page hands it to the
 * extension and never shows it; it's the only time it exists outside the extension.
 */
export const connectExtension = toolAction(z.object({ label: z.string().max(100) }), async ({ label }) => {
  const { token } = await createExtensionToken(label);
  refresh();
  return { token };
});

/** Disconnect a browser: its extension is refused from now on. */
export const disconnectExtension = toolAction(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  if (!(await revokeExtensionToken(id))) throw new ActionError("That browser is already disconnected.");
  refresh();
  toast("Disconnected.");
  return null;
});

/**
 * Skip: the job won't be applied for. Not while a browser holds it or may be submitting it; an
 * uncertain one the student checked and found not sent can be.
 */
export const skipApplication = toolAction(z.object({ taskId: z.string().min(1) }), async ({ taskId }) => {
  const { count } = await prisma.applyTask.updateMany({
    where: { id: taskId, state: { in: [ApplyState.PREPARING, ApplyState.READY, ApplyState.NEEDS_STUDENT, ApplyState.FAILED, ApplyState.UNCERTAIN] } },
    data: { state: ApplyState.SKIPPED, reason: "You skipped it." },
  });
  if (count === 0) throw new ActionError("That application can't be skipped now.");
  refresh();
  return null;
});
