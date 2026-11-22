import "server-only";

import { currentUserId } from "@/lib/owner/current";
import { systemPrisma } from "@/lib/prisma";

import { effectivePlan, type PlanId } from "./plans";

export type StudentPlan = { plan: PlanId; until: Date | null; allowance: number | null };

/** The current student's plan in effect, when it ends, and any allowance an admin set; Free without a student. */
export async function loadStudentPlan(now = new Date()): Promise<StudentPlan> {
  const userId = await currentUserId().catch(() => null);
  if (!userId) return { plan: "FREE", until: null, allowance: null };
  // The user row is the account itself, outside any student's scope.
  const user = await systemPrisma.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, aiDailyLimit: true } });
  if (!user) return { plan: "FREE", until: null, allowance: null };
  const plan = effectivePlan(user, now);
  return { plan, until: plan === "FREE" ? null : user.planUntil, allowance: user.aiDailyLimit };
}
