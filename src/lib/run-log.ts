import { addDays, dayOf } from "@/lib/calendar-view";

// Phase 3 (tracking): the Runs & schedule page. The job agent keeps its own runs (Settings,
// agentRuns); auto-apply's work is read from its applications, day by day, in the student's time
// zone. Nothing here is a second record of what happened: it's what's already kept, laid out.

/** How many days of auto-apply activity the page shows. */
export const RUN_LOG_DAYS = 7;
/** How often auto-apply looks for new matches, and how often it plans (src/lib/apply/schedule.ts). */
export const MATCH_EVERY_MS = 24 * 3600_000;
export const PLAN_EVERY_MS = 30 * 60_000;

export type ApplyActivity = { createdAt: Date; appliedAt: Date | null; updatedAt: Date; state: string };

export type ApplyDay = {
  /** "2026-11-21", in the student's time zone. */
  day: string;
  /** Applications auto-apply started preparing that day. */
  prepared: number;
  /** Applications the job site confirmed (or the student marked) that day. */
  applied: number;
  /** Applications that came to wait on the student that day, and still do. */
  needsYou: number;
  /** Applications that couldn't be done, by the day they stopped. */
  failed: number;
};

const NEEDS_YOU = new Set(["NEEDS_STUDENT", "UNCERTAIN"]);

/** Auto-apply's last `days` days, newest first, every day listed even when nothing happened. */
export function applyDays(tasks: readonly ApplyActivity[], now: Date, timeZone: string, days = RUN_LOG_DAYS): ApplyDay[] {
  const today = dayOf(now, timeZone);
  const rows = new Map<string, ApplyDay>();
  for (let back = 0; back < days; back++) {
    const day = addDays(today, -back);
    rows.set(day, { day, prepared: 0, applied: 0, needsYou: 0, failed: 0 });
  }
  const on = (date: Date | null) => (date ? rows.get(dayOf(date, timeZone)) : undefined);
  for (const task of tasks) {
    const started = on(task.createdAt);
    if (started) started.prepared++;
    const applied = on(task.appliedAt);
    if (applied) applied.applied++;
    // Where it stands now, on the day it got there.
    const settled = on(task.updatedAt);
    if (settled && NEEDS_YOU.has(task.state)) settled.needsYou++;
    if (settled && task.state === "FAILED") settled.failed++;
  }
  return [...rows.values()];
}

/** When auto-apply next looks for matches: a day after the last look, or at its next round once that's past. */
export function nextMatchAt(lastMatch: Date | null, now: Date): Date {
  const due = lastMatch ? lastMatch.getTime() + MATCH_EVERY_MS : now.getTime();
  return new Date(Math.max(due, now.getTime()));
}

/** "3 prepared · 2 applied · 1 needs you", or null for a quiet day. */
export function daySummary(day: ApplyDay): string | null {
  const parts = [
    day.prepared ? `${day.prepared} prepared` : "",
    day.applied ? `${day.applied} applied` : "",
    day.needsYou ? `${day.needsYou} ${day.needsYou === 1 ? "needs" : "need"} you` : "",
    day.failed ? `${day.failed} couldn't apply` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
