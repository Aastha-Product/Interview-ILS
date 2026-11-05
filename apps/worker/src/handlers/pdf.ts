import {
  handlePdf as coreHandlePdf,
  resumeToHtml,
  type JobInfo,
  type PdfJobData,
} from "@pathfinder/core";
import { renderPdf } from "../pdf/browser";

export { pdfStorageKey, type JobInfo } from "@pathfinder/core";

/** pdf.render in the worker: the shared handler, rendering with Chromium. */
export async function handlePdf(
  job: JobInfo<PdfJobData>,
  deps: { render?: typeof renderPdf } = {},
): Promise<void> {
  const render = deps.render ?? renderPdf;
  await coreHandlePdf(job, { renderResume: (content) => render(resumeToHtml(content)) });
}
