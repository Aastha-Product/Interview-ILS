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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long each kind of data is kept (technical plan §13). Personal data is kept until the student deletes it. */
export const RETENTION = {
  /** Per-call AI records; the daily totals stay in UsageRecord. */
  aiRunDays: 30,
  /** Scores are recomputed on demand, so old ones can go. */
  jobMatchDays: 90,
  /** Closed listings nobody applied to (listings with applications are never deleted). */
  closedListingDays: 90,
  /** Search history only drives the 5-minute cooldown. */
  feedSearchDays: 90,
  /** Expired search-cache entries. */
  feedCacheGraceDays: 1,
  /** Daily usage totals, kept for later pricing and limits. */
  usageDays: 730,
} as const;

export type RetentionReport = Record<
  "aiRuns" | "jobMatches" | "closedListings" | "feedSearches" | "feedCache" | "usageRecords",
  number
>;

/**
 * The nightly cleanup.retention job. Deletes only derived or expired data, never profiles,
 * applications, documents or the audit log. Returns counts, never rows.
 */
export async function runRetention(options: { now?: Date } = {}): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const prisma = getPrisma();
  const [aiRuns, jobMatches, closedListings, feedSearches, feedCache, usageRecords] = [
    await prisma.aiRun.deleteMany({ where: { createdAt: { lt: ago(RETENTION.aiRunDays) } } }),
    await prisma.jobMatch.deleteMany({ where: { updatedAt: { lt: ago(RETENTION.jobMatchDays) } } }),
    // The Application foreign key is RESTRICT as well, so a listing someone applied to can't go.
    await prisma.jobListing.deleteMany({
      where: { closedAt: { lt: ago(RETENTION.closedListingDays) }, applications: { none: {} } },
    }),
    await prisma.feedSearch.deleteMany({ where: { createdAt: { lt: ago(RETENTION.feedSearchDays) } } }),
    await prisma.feedCache.deleteMany({ where: { expiresAt: { lt: ago(RETENTION.feedCacheGraceDays) } } }),
    await prisma.usageRecord.deleteMany({ where: { day: { lt: ago(RETENTION.usageDays) } } }),
  ];
  return {
    aiRuns: aiRuns.count,
    jobMatches: jobMatches.count,
    closedListings: closedListings.count,
    feedSearches: feedSearches.count,
    feedCache: feedCache.count,
    usageRecords: usageRecords.count,
  };
}
