import { listApplications, startApplication } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withUser } from "@/server/http";

export const runtime = "nodejs";
// On demo sites drafting and the PDF run in this function after it responds (see server/inline-jobs.ts).
export const maxDuration = 120;

const createSchema = z.object({
  jobListingId: z.string().min(1).max(64),
  confirmSimilar: z.boolean().optional(),
});

/** GET /api/applications: every application, for the tracker. */
export const GET = withUser(async ({ db }) => NextResponse.json(await listApplications(db)));

/**
 * POST /api/applications { jobListingId, confirmSimilar? }: start an application and queue the
 * tailored draft, as one step (if the draft can't be queued, nothing is kept).
 * 409 ALREADY_STARTED for the same job; 409 SIMILAR_APPLICATION to confirm a repeat; 429 at a limit.
 */
export const POST = withUser(async ({ request, db }) => {
  const body = createSchema.parse(await readJson(request));
  const { applicationId } = await startApplication(db, body.jobListingId, {
    confirmSimilar: body.confirmSimilar,
  });
  return NextResponse.json({ applicationId }, { status: 201 });
});
