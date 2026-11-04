import { enqueuePdf, getApplication, saveDraftEdits, updateApplication } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withUser } from "@/server/http";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional(),
  resume: z.unknown().optional(),
  answers: z.unknown().optional(),
});

/** GET /api/applications/:id: the application, its latest drafts, task states and history. */
export const GET = withUser<{ id: string }>(async ({ db, params }) => NextResponse.json(await getApplication(db, params.id)));

/**
 * PATCH /api/applications/:id { status?, notes?, resume?, answers? }: change status or notes, or
 * save edited drafts as a new version (a new PDF is rendered for an edited resume).
 */
export const PATCH = withUser<{ id: string }>(async ({ request, db, params }) => {
  const body = patchSchema.parse(await readJson(request));
  if (body.status !== undefined || body.notes !== undefined) {
    await updateApplication(db, params.id, { status: body.status, notes: body.notes });
  }
  if (body.resume !== undefined || body.answers !== undefined) {
    const saved = await saveDraftEdits(db, params.id, { resume: body.resume, answers: body.answers });
    if (saved.resumeDocumentId) await enqueuePdf(db, saved.resumeDocumentId);
  }
  return NextResponse.json(await getApplication(db, params.id));
});
