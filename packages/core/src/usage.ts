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
          db.aiRun.create({ data: run as never }),
          db.usageRecord.upsert({
            where: { userId_day: { userId: db.userId, day } },
            create: { day, aiCalls: 1, aiInputTokens: run.inputTokens, aiOutputTokens: run.outputTokens } as never,
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
