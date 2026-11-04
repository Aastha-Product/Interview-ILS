import { getPreferences, savePreferences } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { readJson, withUser } from "@/server/http";

/** GET /api/preferences: job preferences, or null before onboarding sets them. */
export const GET = withUser(async ({ db }) => NextResponse.json(await getPreferences(db)));

/** PUT /api/preferences: create or replace job preferences. */
export const PUT = withUser(async ({ request, db }) =>
  NextResponse.json(await savePreferences(db, await readJson(request))),
);
