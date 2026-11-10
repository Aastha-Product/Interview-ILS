import { DocumentKind } from "@/generated/prisma/enums";
import { heldTask } from "@/lib/apply/lease";
import { extensionError, extensionRoute } from "@/lib/extension/route";
import { resolveFileName } from "@/lib/file-name";
import { pdfDownload } from "@/lib/pdf/downloads";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

const KINDS = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;

/**
 * Pathfinder (step 5): the tailored resume (?kind=resume) or cover letter (?kind=letter) as a PDF,
 * for the extension to attach to the form. Only for the browser holding the task (?lease=…).
 */
export const GET = extensionRoute<RouteContext<"/api/ext/tasks/[id]/document">>(async (request, { params }) => {
  const search = request.nextUrl.searchParams;
  const kind = search.get("kind");
  if (kind !== "resume" && kind !== "letter") return extensionError(400, "There's no such document.");
  const task = await heldTask((await params).id, search.get("lease") ?? "");
  if (!task?.applicationId) return extensionError(409, "This application isn't held by this browser any more.");
  const application = await prisma.application.findUnique({
    where: { id: task.applicationId },
    select: { company: true, role: true, documents: { where: { kind: KINDS[kind] }, select: { id: true } } },
  });
  if (!application || application.documents.length === 0) return extensionError(404, kind === "resume" ? "This application has no tailored resume." : "This application has no cover letter.");
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const pdf = await renderPdf(`/print/${kind}/${task.applicationId}`);
  return pdfDownload(pdf, resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: KINDS[kind], date: new Date() }));
});
