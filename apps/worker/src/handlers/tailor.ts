import type { AiClient } from "@pathfinder/ai";
import {
  enqueuePdf,
  generateDrafts as coreGenerateDrafts,
  getLogger,
  markTaskDone,
  markTaskFailed,
  markTaskWorking,
  QUEUE_SETTINGS,
  UserFacingError,
  type TailorJobData,
} from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import type { JobInfo } from "./pdf";

export type GenerateDrafts = typeof coreGenerateDrafts;

/**
 * Time kept back from the queue's expiry for saving drafts and queueing the PDF. AI calls get the
 * rest, so a run always ends before pg-boss expires the job and hands it to a second worker.
 */
const SAVE_MARGIN_MS = 15_000;
export const TAILOR_BUDGET_MS = QUEUE_SETTINGS["ai.tailor"].expireInSeconds * 1000 - SAVE_MARGIN_MS;

/**
 * ai.tailor: drafts a tailored resume and answers (fact-checked against the profile), then queues
 * the PDF. A UserFacingError (e.g. profile missing) fails the task with its message, without retry.
 * Anything else is retried by pg-boss; the last attempt marks the task failed.
 */
export async function handleTailor(
  job: JobInfo<TailorJobData>,
  deps: { ai: AiClient; generateDrafts?: GenerateDrafts },
): Promise<void> {
  const { userId, applicationId, taskId } = job.data;
  const log = getLogger().child({ queue: "ai.tailor", jobId: job.id, taskId });
  const db = scopedDb(userId);
  if (!(await markTaskWorking(db, taskId, job.retryCount + 1))) {
    log.info("task already finished or removed; skipping");
    return;
  }

  try {
    const generateDrafts = deps.generateDrafts ?? coreGenerateDrafts;
    const started = Date.now();
    const result = await generateDrafts({ db, ai: deps.ai, deadline: started + TAILOR_BUDGET_MS }, applicationId);
    await enqueuePdf(db, result.resumeDocumentId, { fromWorker: true });
    await markTaskDone(db, taskId, {
      documentId: result.resumeDocumentId,
      needsInput: result.needsInput,
      reason: result.needsInput ? "A few answers need your input." : "",
    });
    log.info({ ms: Date.now() - started, removed: result.removedCount, needsInput: result.needsInput }, "drafts ready");
  } catch (error) {
    if (error instanceof UserFacingError) {
      await markTaskFailed(db, taskId, error.message);
      return; // completes the job: retrying won't help
    }
    log.warn({ errName: (error as Error).name, attempt: job.retryCount + 1 }, "tailor failed");
    if (job.retryCount >= job.retryLimit) {
      await markTaskFailed(db, taskId, "We couldn't prepare this draft. Please try again.");
    }
    throw error;
  }
}
