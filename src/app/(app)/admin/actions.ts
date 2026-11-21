"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isAdmin } from "@/lib/admin";
import { limitFromAllowance } from "@/lib/admin-data";
import { addJobBoards, parseCountries, setJobBoardActive } from "@/lib/crawl/boards-admin";
import { systemPrisma } from "@/lib/prisma";

/**
 * Admin → Job boards (Phase 2): adds the boards in pasted careers links, each checked live first.
 * Only an admin may.
 */
export const addJobBoardsFromLinks = action(z.object({ links: z.string().max(20_000), countries: z.string().max(100) }), async ({ links, countries }, { session }) => {
  if (!(await isAdmin(session.userId))) throw new ActionError("Only an admin can add job boards.");
  const result = await addJobBoards(links, parseCountries(countries));
  if (result.results.length === 0 && result.unread.length === 0) throw new ActionError("Paste at least one careers link first.");
  revalidatePath("/admin");
  return result;
});

/** Pauses a job board, or crawls it again. Only an admin may. */
export const switchJobBoard = action(z.object({ id: z.string().min(1).max(64), active: z.boolean() }), async ({ id, active }, { session, toast }) => {
  if (!(await isAdmin(session.userId))) throw new ActionError("Only an admin can pause or resume job boards.");
  if (!(await setJobBoardActive(id, active))) throw new ActionError("That job board no longer exists.");
  revalidatePath("/admin");
  toast(active ? "Crawled again from the next look." : "Paused: it won't be crawled until you resume it.");
  return null;
});

/** The most analyses a day an admin can give one student. */
const MAX_ALLOWANCE = 500;

/**
 * Sets one student's free analyses a day (Pathfinder admin console); null puts them back on the
 * server's default. Only an admin may: anyone else is refused, even calling it directly.
 */
export const setStudentAllowance = action(
  z.object({ userId: z.string().min(1).max(64), analysesPerDay: z.number().int().min(0).max(MAX_ALLOWANCE).nullable() }),
  async ({ userId, analysesPerDay }, { session, toast }) => {
    if (!(await isAdmin(session.userId))) throw new ActionError("Only an admin can change a student's allowance.");
    const { count } = await systemPrisma.user.updateMany({ where: { id: userId }, data: { aiDailyLimit: limitFromAllowance(analysesPerDay) } });
    if (count === 0) throw new ActionError("That student no longer exists.");
    revalidatePath("/admin");
    toast(analysesPerDay === null ? "Back on the default allowance." : `Allowance set to ${analysesPerDay} a day.`);
  },
);
