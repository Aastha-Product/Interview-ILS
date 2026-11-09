"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isAdmin } from "@/lib/admin";
import { limitFromAllowance } from "@/lib/admin-data";
import { systemPrisma } from "@/lib/prisma";

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
