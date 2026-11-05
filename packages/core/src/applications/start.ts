import type { ScopedDb } from "@pathfinder/db";
import { createApplication } from "./service";
import { enqueueTailor, type TaskLimits, type TaskView } from "./tasks";

/**
 * Starts an application and queues its first draft, as one step: if the draft can't be queued
 * (a limit is hit, or the queue is down) the new application is removed again and the error is
 * passed on. Without this, a 429 left an application behind and the retry said "already started".
 */
export async function startApplication(
  db: ScopedDb,
  jobListingId: string,
  options: { confirmSimilar?: boolean; now?: Date; limits?: TaskLimits } = {},
): Promise<{ applicationId: string; task: TaskView }> {
  const { applicationId } = await createApplication(db, jobListingId, options);
  try {
    const task = await enqueueTailor(db, applicationId, { limits: options.limits, now: options.now });
    return { applicationId, task };
  } catch (error) {
    // Cascades to the CREATED event and any FAILED task row the enqueue attempt wrote.
    await db.application.delete({ where: { id: applicationId } }).catch(() => {});
    throw error;
  }
}
