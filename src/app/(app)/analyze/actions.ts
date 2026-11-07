"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { deleteResumeAnalysis } from "@/lib/resume-analysis";

/** Deletes one of the student's resume analyses (Pathfinder). Someone else's is "not found". */
export const deleteAnalysis = action(z.object({ id: z.string().min(1).max(64) }), async ({ id }) => {
  if (!(await deleteResumeAnalysis(id))) throw new ActionError("That analysis was already deleted.");
  revalidatePath("/analyze");
});
