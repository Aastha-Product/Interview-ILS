import { getProfile, saveProfile, saveProfileRequestSchema } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { readJson, withUser } from "@/server/http";

/** GET /api/profile: the signed-in student's profile (version 0 if they have none yet). */
export const GET = withUser(async ({ db }) => NextResponse.json(await getProfile(db)));

/** PUT /api/profile: replace the whole profile. Body: { expectedVersion, profile }. */
export const PUT = withUser(async ({ request, db }) => {
  const body = saveProfileRequestSchema.parse(await readJson(request));
  return NextResponse.json(await saveProfile(db, body.profile, body.expectedVersion));
});
