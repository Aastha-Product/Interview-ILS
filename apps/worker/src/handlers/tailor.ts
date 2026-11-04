import type { AiClient } from "@pathfinder/ai";
import * as core from "@pathfinder/core";
import { enqueuePdf, getLogger, markTaskDone, markTaskFailed, markTaskWorking, UserFacingError, type TailorJobData } from "@pathfinder/core";
import { scopedDb, type ScopedDb } from "@pathfinder/db";
import type { JobInfo } from "./pdf";

/** Signature agreed with the drafting track (packages/core/src/applications/tailor.ts). */
export type GenerateDrafts = (
  deps: { db: ScopedDb; ai: AiClient },
  applicationId: string,
) => Promise<{ resumeDocumentId: string; answersDocumentId: string; needsInput: boolean; removedCount: number }>;

function resolveGenerateDrafts(): GenerateDrafts {
  const fn = (core as unknown as { generateDrafts?: GenerateDrafts }).generateDrafts;
  if (!fn) throw new Error("generateDrafts is not available in @pathfinder/core");
  return fn;
}

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
  await markTaskWorking(db, taskId, job.retryCount + 1);

  try {
    const generateDrafts = deps.generateDrafts ?? resolveGenerateDrafts();
    const started = Date.now();
    const result = await generateDrafts({ db, ai: deps.ai }, applicationId);
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
