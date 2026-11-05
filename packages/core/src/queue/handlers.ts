import type { AiClient } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { generateDrafts as coreGenerateDrafts } from "../applications/tailor";
import { enqueuePdf, markTaskDone, markTaskFailed, markTaskWorking } from "../applications/tasks";
import type { ResumeContent } from "../applications/types";
import { resumeContentSchema } from "../applications/draft-schema";
import { getConfig } from "../config";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { getStorage } from "../storage";
import { incrementUsage } from "../usage";
import { QUEUE_SETTINGS, type PdfJobData, type TailorJobData } from "./names";

/**
 * The work behind the two queues, shared by the worker (pg-boss) and demo sites (run inside the
 * web app). Retries: the caller passes how many attempts were made and allowed; the last attempt
 * marks the task failed with a plain-English reason.
 */

export interface JobInfo<T> {
  id: string;
  data: T;
  retryCount: number;
  retryLimit: number;
}

export type GenerateDrafts = typeof coreGenerateDrafts;

/**
 * Time kept back from the queue's expiry for saving drafts and queueing the PDF. AI calls get the
 * rest, so a run always ends before pg-boss expires the job and hands it to a second worker.
 */
const SAVE_MARGIN_MS = 15_000;
export const TAILOR_BUDGET_MS = QUEUE_SETTINGS["ai.tailor"].expireInSeconds * 1000 - SAVE_MARGIN_MS;

export function pdfStorageKey(userId: string, applicationId: string, version: number): string {
  return `users/${userId}/applications/${applicationId}/resume-v${version}.pdf`;
}

/**
 * ai.tailor: drafts a tailored resume and answers (fact-checked against the profile), then queues
 * the PDF. A UserFacingError (e.g. profile missing) fails the task with its message, without retry.
 * Anything else is retried; the last attempt marks the task failed.
 */
export async function handleTailor(
  job: JobInfo<TailorJobData>,
  deps: { ai: AiClient; generateDrafts?: GenerateDrafts; budgetMs?: number },
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
    const result = await generateDrafts(
      { db, ai: deps.ai, deadline: started + (deps.budgetMs ?? TAILOR_BUDGET_MS) },
      applicationId,
    );
    await enqueuePdf(db, result.resumeDocumentId, { fromWorker: true });
    await markTaskDone(db, taskId, {
      documentId: result.resumeDocumentId,
      needsInput: result.needsInput,
      reason: result.needsInput ? "A few answers need your input." : "",
    });
    log.info(
      { ms: Date.now() - started, removed: result.removedCount, needsInput: result.needsInput },
      "drafts ready",
    );
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

/** pdf.render: one resume version → PDF in storage. Errors other than "not found" are retried. */
export async function handlePdf(
  job: JobInfo<PdfJobData>,
  deps: { renderResume: (content: ResumeContent) => Promise<Uint8Array> },
): Promise<void> {
  const { userId, applicationId, documentId, taskId } = job.data;
  const log = getLogger().child({ queue: "pdf.render", jobId: job.id, taskId });
  const db = scopedDb(userId);
  if (!(await markTaskWorking(db, taskId, job.retryCount + 1))) {
    log.info("task already finished or removed; skipping");
    return;
  }

  const doc = await db.generatedDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.kind !== "RESUME" || doc.applicationId !== applicationId) {
    await markTaskFailed(
      db,
      taskId,
      "We couldn't find this draft. Prepare it again, then download.",
    );
    return;
  }
  const parsed = resumeContentSchema.safeParse(doc.content);
  if (!parsed.success) {
    await markTaskFailed(
      db,
      taskId,
      "This draft couldn't be turned into a PDF. Check it for empty sections, save, and try again.",
    );
    return;
  }

  try {
    const started = Date.now();
    const bytes = await deps.renderResume(parsed.data as ResumeContent);
    const key = pdfStorageKey(userId, applicationId, doc.version);
    await getStorage(getConfig()).put(key, bytes, "application/pdf");
    await db.generatedDocument.update({
      where: { id: doc.id },
      data: { pdfStorageKey: key, pdfRenderedAt: new Date() },
    });
    await incrementUsage(db, "pdfs");
    await markTaskDone(db, taskId, { documentId: doc.id });
    log.info({ ms: Date.now() - started, bytes: bytes.byteLength }, "pdf rendered");
  } catch (error) {
    log.warn({ errName: (error as Error).name, attempt: job.retryCount + 1 }, "pdf render failed");
    if (job.retryCount >= job.retryLimit) {
      await markTaskFailed(db, taskId, "We couldn't create the PDF. Please try downloading again.");
    }
    throw error;
  }
}
