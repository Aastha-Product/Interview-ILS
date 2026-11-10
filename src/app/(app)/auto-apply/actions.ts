"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplyState } from "@/generated/prisma/enums";
import { ActionError, toolAction } from "@/lib/action";
import { planApplications } from "@/lib/apply/prepare";
import { AutoApplyNotReady, giveConsent, loadAutoApply, saveAutoApply, setAutoApplyEnabled, settingsInputSchema } from "@/lib/apply/settings";
import { startMatchRun } from "@/lib/match/jobs";
import { prisma } from "@/lib/prisma";

// Pathfinder (auto-apply step 4): the auto-apply screens' actions. Nothing here submits anything:
// that's the extension's, from the student's own browser (step 5).

const PATHS = ["/auto-apply", "/auto-apply/setup"];
const refresh = () => PATHS.forEach((path) => revalidatePath(path));

/** Set up job search: what to look for, the answers forms ask for, and the limits. */
export const saveJobSearch = toolAction(settingsInputSchema, async (input, { toast }) => {
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

/** Skip: the job won't be applied for. Not once the browser may be submitting it. */
export const skipApplication = toolAction(z.object({ taskId: z.string().min(1) }), async ({ taskId }) => {
  const { count } = await prisma.applyTask.updateMany({
    where: { id: taskId, state: { in: [ApplyState.PREPARING, ApplyState.READY, ApplyState.NEEDS_STUDENT, ApplyState.FAILED] } },
    data: { state: ApplyState.SKIPPED, reason: "You skipped it." },
  });
  if (count === 0) throw new ActionError("That application can't be skipped now.");
  refresh();
  return null;
});
