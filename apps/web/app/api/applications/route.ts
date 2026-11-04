import { createApplication, enqueueTailor, listApplications } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withUser } from "@/server/http";

export const runtime = "nodejs";

const createSchema = z.object({ jobListingId: z.string().min(1).max(64), confirmSimilar: z.boolean().optional() });

/** GET /api/applications: every application, for the tracker. */
export const GET = withUser(async ({ db }) => NextResponse.json(await listApplications(db)));

/**
 * POST /api/applications { jobListingId, confirmSimilar? }: start an application and queue the
 * tailored draft. 409 ALREADY_STARTED for the same job; 409 SIMILAR_APPLICATION to confirm a repeat.
 */
export const POST = withUser(async ({ request, db }) => {
  const body = createSchema.parse(await readJson(request));
  const { applicationId } = await createApplication(db, body.jobListingId, { confirmSimilar: body.confirmSimilar });
  await enqueueTailor(db, applicationId);
  return NextResponse.json({ applicationId }, { status: 201 });
});
