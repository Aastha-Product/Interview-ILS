"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { importCounts } from "@/lib/profile-import";
import { applyImportedProfile } from "@/lib/profile-import-apply";
import { deleteResumeAnalysis, getResumeAnalysis } from "@/lib/resume-analysis";

const analysisId = z.object({ id: z.string().min(1).max(64) });

/** Deletes one of the student's resume analyses (Pathfinder). Someone else's is "not found". */
export const deleteAnalysis = action(analysisId, async ({ id }) => {
  if (!(await deleteResumeAnalysis(id))) throw new ActionError("That analysis was already deleted.");
  revalidatePath("/analyze");
});

/**
 * Merges a saved resume analysis into the student's existing profile (Pathfinder, Phase C). The
 * auto-fill on upload only runs when the profile is still empty, so a returning student who uploads
 * a newer resume gets nothing. This adds what the resume found to the profile they already have:
 * blanks are filled and new entries added, in "merge" mode, so nothing they've written is removed.
 * The read profile is taken from the saved analysis, not the browser, and is owner-scoped already.
 */
export const importAnalysisIntoProfile = action(analysisId, async ({ id }, { toast }) => {
  const analysis = await getResumeAnalysis(id);
  if (!analysis) throw new ActionError("That analysis was already deleted.");
  await applyImportedProfile(prisma, analysis.profile, "merge");
  revalidatePath("/", "layout");
  toast(`Added to your profile: ${importCounts(analysis.profile)}.`);
  return null;
});
