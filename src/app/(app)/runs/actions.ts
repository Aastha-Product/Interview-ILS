"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActionError, toolAction } from "@/lib/action";
import { pauseAll, resumeAll } from "@/lib/pause-all";

// Pathfinder (Phase 3): Pause everything and Resume, on Runs & schedule.

const refresh = () => revalidatePath("/", "layout");

export const pauseEverything = toolAction(z.object({}), async (_input, { toast }) => {
  if (!(await pauseAll())) throw new ActionError("Nothing is running to pause.");
  refresh();
  toast("Paused. Nothing new is prepared, submitted or searched until you resume.");
  return null;
});

export const resumeEverything = toolAction(z.object({}), async (_input, { toast }) => {
  const { resumed, problem } = await resumeAll();
  refresh();
  if (problem) toast(`${resumed.length > 0 ? "The job agent is back on. " : ""}Auto-apply stays off: ${problem}`);
  else toast(resumed.length > 0 ? "Resumed. Everything that was running is back on." : "Resumed.");
  return null;
});
