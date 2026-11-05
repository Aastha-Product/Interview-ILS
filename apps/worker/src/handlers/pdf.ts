import {
  getConfig,
  getLogger,
  getStorage,
  incrementUsage,
  markTaskDone,
  markTaskFailed,
  markTaskWorking,
  resumeContentSchema,
  resumeToHtml,
  type PdfJobData,
} from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import { renderPdf } from "../pdf/browser";

export interface JobInfo<T> {
  id: string;
  data: T;
  retryCount: number;
  retryLimit: number;
}

export function pdfStorageKey(userId: string, applicationId: string, version: number): string {
  return `users/${userId}/applications/${applicationId}/resume-v${version}.pdf`;
}

/** pdf.render: one resume version → PDF in storage. Errors other than "not found" are retried. */
export async function handlePdf(job: JobInfo<PdfJobData>, deps: { render?: typeof renderPdf } = {}): Promise<void> {
  const { userId, applicationId, documentId, taskId } = job.data;
  const log = getLogger().child({ queue: "pdf.render", jobId: job.id, taskId });
  const db = scopedDb(userId);
  if (!(await markTaskWorking(db, taskId, job.retryCount + 1))) {
    log.info("task already finished or removed; skipping");
    return;
  }

  const doc = await db.generatedDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.kind !== "RESUME" || doc.applicationId !== applicationId) {
    await markTaskFailed(db, taskId, "We couldn't find this draft. Prepare it again, then download.");
    return;
  }
  const parsed = resumeContentSchema.safeParse(doc.content);
  if (!parsed.success) {
    await markTaskFailed(db, taskId, "This draft couldn't be turned into a PDF. Check it for empty sections, save, and try again.");
    return;
  }

  try {
    const started = Date.now();
    const bytes = await (deps.render ?? renderPdf)(resumeToHtml(parsed.data));
    const key = pdfStorageKey(userId, applicationId, doc.version);
    await getStorage(getConfig()).put(key, bytes, "application/pdf");
    await db.generatedDocument.update({ where: { id: doc.id }, data: { pdfStorageKey: key, pdfRenderedAt: new Date() } });
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
