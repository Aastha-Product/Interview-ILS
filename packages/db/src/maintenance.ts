import { getPrisma } from "./client";

/**
 * Cross-user housekeeping for the worker. Each function does one narrow, data-safe job and returns
 * counts only, so callers never see another user's rows.
 */

export const STALE_TASK_REASON = "This took too long and was stopped. Please try again.";

/**
 * Fails tasks stuck in QUEUED or WORKING for longer than `olderThanMs` (a worker crashed, or a job
 * was lost). Without this they would count against the student's concurrent limit forever.
 */
export async function failStaleTasks(options: { olderThanMs: number; now?: Date }): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.olderThanMs);
  const result = await getPrisma().applicationTask.updateMany({
    where: { state: { in: ["QUEUED", "WORKING"] }, updatedAt: { lt: cutoff } },
    data: { state: "FAILED", reason: STALE_TASK_REASON, finishedAt: now },
  });
  return result.count;
}
