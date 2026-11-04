import type { ApplicationStatus, ScopedDb } from "@pathfinder/db";
import { normaliseCompany, normaliseTitle } from "@pathfinder/feeds";
import { z } from "zod";
import { UserFacingError } from "../errors";
import { answersContentSchema, resumeContentSchema } from "./draft-schema";
import { getTasks, type TaskView } from "./tasks";
import type { AnswersContent, FactCheckReport, ResumeContent } from "./types";

export const APPLICATION_STATUSES = ["DRAFT", "APPLIED", "RESPONSE", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"] as const;
/** Statuses that mean the employer replied. Moving into one sets responseAt (once). */
const RESPONSE_STATUSES = new Set<ApplicationStatus>(["RESPONSE", "INTERVIEW", "OFFER", "REJECTED"]);
const SIMILAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export interface ApplicationJobView {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  source: string;
  applyUrl: string | null;
  description: string;
}

export interface DocumentView<C> {
  documentId: string;
  version: number;
  content: C;
  factCheck: FactCheckReport | null;
  editedByStudent: boolean;
  profileVersion: number;
  pdfReady: boolean;
  createdAt: string;
}

export interface ApplicationView {
  id: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  responseAt: string | null;
  notes: string;
  createdAt: string;
  job: ApplicationJobView;
  resume: DocumentView<ResumeContent> | null;
  answers: DocumentView<AnswersContent> | null;
  tasks: TaskView[];
  events: Array<{ type: string; at: string; note: string }>;
}

export interface ApplicationSummary {
  id: string;
  status: ApplicationStatus;
  title: string;
  company: string;
  location: string;
  appliedAt: string | null;
  responseAt: string | null;
  updatedAt: string;
  hasDraft: boolean;
}

/**
 * Starts an application for a job. Blocks a second application for the same job, and asks for
 * confirmation if the student applied for the same title at the same company in the last 30 days.
 */
export async function createApplication(
  db: ScopedDb,
  jobListingId: string,
  options: { confirmSimilar?: boolean; now?: Date } = {},
): Promise<{ applicationId: string }> {
  const now = options.now ?? new Date();
  const listing = await db.jobListing.findUnique({ where: { id: jobListingId } });
  if (!listing) throw new UserFacingError("JOB_NOT_FOUND", "We couldn't find that job.", 404);

  const existing = await db.application.findUnique({
    where: { userId_jobListingId: { userId: db.userId, jobListingId } },
  });
  if (existing) {
    throw new UserFacingError(
      "ALREADY_STARTED",
      existing.appliedAt
        ? `You already applied for this job on ${formatDate(existing.appliedAt)}.`
        : "You've already started an application for this job.",
      409,
      undefined,
      { applicationId: existing.id },
    );
  }

  if (!options.confirmSimilar) {
    const recent = await db.application.findMany({
      where: { appliedAt: { gte: new Date(now.getTime() - SIMILAR_WINDOW_MS) } },
      include: { jobListing: { select: { title: true, company: true } } },
      orderBy: { appliedAt: "desc" },
    });
    const company = normaliseCompany(listing.company);
    const title = normaliseTitle(listing.title);
    const similar = recent.find(
      (a) => normaliseCompany(a.jobListing.company) === company && normaliseTitle(a.jobListing.title) === title,
    );
    if (similar) {
      throw new UserFacingError(
        "SIMILAR_APPLICATION",
        `You applied for ${similar.jobListing.title} at ${similar.jobListing.company} on ${formatDate(similar.appliedAt!)}. Do you want to apply for this one as well?`,
        409,
        undefined,
        { applicationId: similar.id },
      );
    }
  }

  try {
    const application = await db.application.create({ data: { userId: db.userId, jobListingId } });
    await db.applicationEvent.create({ data: { userId: db.userId, applicationId: application.id, type: "CREATED" } });
    return { applicationId: application.id };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new UserFacingError("ALREADY_STARTED", "You've already started an application for this job.", 409);
    }
    throw error;
  }
}

function toDocView<C>(doc: {
  id: string;
  version: number;
  content: unknown;
  factCheck: unknown;
  editedByStudent: boolean;
  profileVersion: number;
  pdfStorageKey: string | null;
  createdAt: Date;
}): DocumentView<C> {
  return {
    documentId: doc.id,
    version: doc.version,
    content: doc.content as C,
    factCheck: (doc.factCheck as FactCheckReport | null) ?? null,
    editedByStudent: doc.editedByStudent,
    profileVersion: doc.profileVersion,
    pdfReady: Boolean(doc.pdfStorageKey),
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function getApplication(db: ScopedDb, applicationId: string): Promise<ApplicationView> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: {
      jobListing: true,
      events: { orderBy: { at: "desc" }, take: 30 },
    },
  });
  if (!app) throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);
  const [resume, answers, tasks] = await Promise.all([
    db.generatedDocument.findFirst({ where: { applicationId, kind: "RESUME" }, orderBy: { version: "desc" } }),
    db.generatedDocument.findFirst({ where: { applicationId, kind: "ANSWERS" }, orderBy: { version: "desc" } }),
    getTasks(db, applicationId),
  ]);
  const job = app.jobListing;
  return {
    id: app.id,
    status: app.status,
    appliedAt: app.appliedAt?.toISOString() ?? null,
    responseAt: app.responseAt?.toISOString() ?? null,
    notes: app.notes,
    createdAt: app.createdAt.toISOString(),
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      remote: job.remote,
      source: job.source,
      applyUrl: job.applyUrl,
      description: job.description,
    },
    resume: resume ? toDocView<ResumeContent>(resume) : null,
    answers: answers ? toDocView<AnswersContent>(answers) : null,
    tasks,
    events: app.events.map((e) => ({ type: e.type, at: e.at.toISOString(), note: e.note })),
  };
}

export async function listApplications(db: ScopedDb): Promise<ApplicationSummary[]> {
  const apps = await db.application.findMany({
    include: {
      jobListing: { select: { title: true, company: true, location: true } },
      documents: { select: { id: true }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
  return apps.map((a) => ({
    id: a.id,
    status: a.status,
    title: a.jobListing.title,
    company: a.jobListing.company,
    location: a.jobListing.location,
    appliedAt: a.appliedAt?.toISOString() ?? null,
    responseAt: a.responseAt?.toISOString() ?? null,
    updatedAt: a.updatedAt.toISOString(),
    hasDraft: a.documents.length > 0,
  }));
}

export const updateApplicationSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Changes status and/or notes. appliedAt is set the first time an application leaves DRAFT;
 * responseAt the first time it reaches a response status. Moving back clears them, so a mistaken
 * drag doesn't distort the response rate.
 */
export async function updateApplication(
  db: ScopedDb,
  applicationId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<void> {
  const data = updateApplicationSchema.parse(input);
  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);

  const patch: { status?: ApplicationStatus; appliedAt?: Date | null; responseAt?: Date | null; notes?: string } = {};
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.status && data.status !== app.status) {
    const next = data.status;
    patch.status = next;
    if (next === "DRAFT") {
      patch.appliedAt = null;
      patch.responseAt = null;
    } else {
      if (!app.appliedAt && next !== "WITHDRAWN") patch.appliedAt = now;
      if (RESPONSE_STATUSES.has(next)) {
        if (!app.responseAt) patch.responseAt = now;
      } else if (next === "APPLIED") {
        patch.responseAt = null;
      }
    }
  }
  if (Object.keys(patch).length === 0) return;

  await db.application.update({ where: { id: applicationId }, data: patch });
  if (patch.status) {
    await db.applicationEvent.create({
      data: { userId: db.userId, applicationId, type: "STATUS_CHANGED", note: `${app.status} → ${patch.status}`, at: now },
    });
  }
}

/**
 * Saves the student's own edits as a new document version. Edited bullets and answers are marked
 * "edited by you". Student edits aren't fact-checked: the student is the author, and the review
 * screen says so. Returns the new resume document id (if the resume changed) so a PDF can be rendered.
 */
export async function saveDraftEdits(
  db: ScopedDb,
  applicationId: string,
  input: { resume?: unknown; answers?: unknown },
): Promise<{ resumeDocumentId: string | null; answersDocumentId: string | null }> {
  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);
  const out = { resumeDocumentId: null as string | null, answersDocumentId: null as string | null };

  for (const kind of ["RESUME", "ANSWERS"] as const) {
    const raw = kind === "RESUME" ? input.resume : input.answers;
    if (raw === undefined) continue;
    const previous = await db.generatedDocument.findFirst({ where: { applicationId, kind }, orderBy: { version: "desc" } });
    if (!previous) throw new UserFacingError("NO_DRAFT", "There's no draft to edit yet.", 409);

    let content: ResumeContent | AnswersContent;
    if (kind === "RESUME") {
      const next = resumeContentSchema.parse(raw) as ResumeContent;
      const before = previous.content as unknown as ResumeContent;
      const oldBullets = new Map(
        [...before.experiences, ...before.projects].flatMap((i) => i.bullets).map((b) => [b.id, b.text]),
      );
      for (const item of [...next.experiences, ...next.projects]) {
        for (const b of item.bullets) {
          if (oldBullets.get(b.id) !== b.text) b.editedByStudent = true;
        }
        item.bullets = item.bullets.filter((b) => b.text.length > 0);
      }
      if (next.summary.text !== before.summary.text) next.summary.editedByStudent = true;
      content = next;
    } else {
      const next = answersContentSchema.parse(raw) as AnswersContent;
      const before = new Map((previous.content as unknown as AnswersContent).answers.map((a) => [a.id, a.answer]));
      for (const a of next.answers) {
        if (before.get(a.id) !== a.answer) a.editedByStudent = true;
        if (a.answer.length > 0) a.needsInput = false;
      }
      content = next;
    }
    if (JSON.stringify(content) === JSON.stringify(previous.content)) continue;

    const doc = await db.generatedDocument.create({
      data: {
        userId: db.userId,
        applicationId,
        kind,
        version: previous.version + 1,
        content: content as never,
        profileVersion: previous.profileVersion,
        factCheck: previous.factCheck ?? undefined,
        editedByStudent: true,
      },
    });
    if (kind === "RESUME") out.resumeDocumentId = doc.id;
    else out.answersDocumentId = doc.id;
  }
  if (out.resumeDocumentId || out.answersDocumentId) {
    await db.applicationEvent.create({ data: { userId: db.userId, applicationId, type: "DRAFT_EDITED" } });
  }
  return out;
}

/** The latest resume document that has a rendered PDF. */
export async function getLatestResumePdf(db: ScopedDb, applicationId: string) {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { jobListing: { select: { company: true } } },
  });
  if (!app) throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);
  const doc = await db.generatedDocument.findFirst({
    where: { applicationId, kind: "RESUME" },
    orderBy: { version: "desc" },
  });
  if (!doc?.pdfStorageKey) {
    throw new UserFacingError("PDF_NOT_READY", "Your PDF is still being prepared. It usually takes a few seconds.", 409);
  }
  const user = await db.user.findFirst({ select: { name: true } });
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  const filename = `${safe(user?.name ?? "Resume") || "Resume"}_${safe(app.jobListing.company) || "Job"}_Resume.pdf`;
  return { storageKey: doc.pdfStorageKey, filename, version: doc.version };
}
