import type { AiRecorder } from "@pathfinder/ai";
import type { ScopedDb } from "@pathfinder/db";
import { getLogger } from "./logger";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's calendar date in India Standard Time, as a UTC-midnight Date for a DATE column. */
export function istDay(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Writes an AiRun row and adds to today's UsageRecord for every model call. */
export function createAiRecorder(db: ScopedDb): AiRecorder {
  return {
    async record(run) {
      const day = istDay();
      try {
        await db.$transaction([
          db.aiRun.create({ data: { ...run, userId: db.userId } }),
          db.usageRecord.upsert({
            where: { userId_day: { userId: db.userId, day } },
            create: { userId: db.userId, day, aiCalls: 1, aiInputTokens: run.inputTokens, aiOutputTokens: run.outputTokens },
            update: {
              aiCalls: { increment: 1 },
              aiInputTokens: { increment: run.inputTokens },
              aiOutputTokens: { increment: run.outputTokens },
            },
          }),
        ]);
      } catch (error) {
        // Usage tracking must never break the student's request.
        getLogger().warn({ err: (error as Error).name, task: run.task }, "failed to record AI usage");
      }
    },
  };
}

/** Adds one search or PDF render to today's UsageRecord. Never throws. */
export async function incrementUsage(db: ScopedDb, field: "searches" | "pdfs", now: Date = new Date()): Promise<void> {
  const day = istDay(now);
  try {
    await db.usageRecord.upsert({
      where: { userId_day: { userId: db.userId, day } },
      create: field === "searches" ? { userId: db.userId, day, searches: 1 } : { userId: db.userId, day, pdfs: 1 },
      update: field === "searches" ? { searches: { increment: 1 } } : { pdfs: { increment: 1 } },
    });
  } catch (error) {
    getLogger().warn({ err: (error as Error).name, field }, "failed to record usage");
  }
}
