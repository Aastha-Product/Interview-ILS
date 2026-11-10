import "server-only";

import { findLatestJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { MATCH_RUN_KEY, startMatchRun } from "@/lib/match/jobs";
import { forEachStudent } from "@/lib/owner/students";
import { systemPrisma } from "@/lib/prisma";

import { planApplications } from "./prepare";
import { loadAutoApply } from "./settings";

// Pathfinder (auto-apply step 4): auto-apply keeps going without the student. Every half hour,
// for each student who switched it on: a match run when the last one is a day old (the crawler
// brings new jobs every 6 hours), and planning, which picks up matches scored meanwhile and room
// that opened up in their daily limit.

const EVERY_MS = 30 * 60_000;
const MATCH_EVERY_MS = 24 * 3600_000;

/** One round for the current student: match when due, then plan. */
export async function autoApplyRound(now = new Date()): Promise<void> {
  const settings = await loadAutoApply();
  if (!settings.enabled || !settings.preferences) return;
  const last = await findLatestJob(MATCH_RUN_KEY);
  const lastRun = last ? (await systemPrisma.job.findUnique({ where: { id: last.id }, select: { createdAt: true } }))?.createdAt : null;
  if (!lastRun || now.getTime() - lastRun.getTime() >= MATCH_EVERY_MS) await startMatchRun(settings.preferences);
  await planApplications(now);
}

/** One round for every student who switched auto-apply on. */
export async function autoApplyRounds(): Promise<void> {
  // Only the students who switched it on: a cheap query, so the round costs nothing for the rest.
  const enabled = new Set((await systemPrisma.autoApplySettings.findMany({ where: { enabled: true }, select: { userId: true } })).map((row) => row.userId));
  if (enabled.size === 0) return;
  await forEachStudent("auto-apply", async (userId) => {
    if (enabled.has(userId)) await autoApplyRound();
  });
}

type ScheduleState = { timer?: NodeJS.Timeout };
const globalForSchedule = globalThis as unknown as { autoApplySchedule?: ScheduleState };
const state: ScheduleState = (globalForSchedule.autoApplySchedule ??= {});

/** Called once at startup where this process runs jobs. */
export function startAutoApplySchedule(): void {
  if (state.timer) return;
  const tick = () => void autoApplyRounds().catch((error: unknown) => logServerError("auto-apply", error));
  state.timer = setInterval(tick, EVERY_MS);
  state.timer.unref?.();
  tick();
}

export function stopAutoApplySchedule(): void {
  clearInterval(state.timer);
  state.timer = undefined;
}
