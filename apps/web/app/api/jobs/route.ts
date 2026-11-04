import { getConfig, getProfile, searchJobs, UserFacingError } from "@pathfinder/core";
import { NextResponse } from "next/server";
import type { SearchResponse } from "@/lib/jobs";
import { withUser } from "@/server/http";
import { getFeedAdapters, scoreJobs } from "@/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/jobs?query=&location=: search licensed feeds (JSearch, Adzuna; fixtures in development).
 * Cached for 24 hours per search, one live search per student every 5 minutes, global daily budgets.
 */
export const GET = withUser(async ({ request, db }) => {
  const params = new URL(request.url).searchParams;
  if ((await getProfile(db)).version === 0) {
    throw new UserFacingError("NO_PROFILE", "Set up your profile first so we can compare it with jobs.", 409);
  }
  const result = await searchJobs(
    { db, adapters: getFeedAdapters(), config: getConfig() },
    { query: params.get("query") ?? "", location: params.get("location") ?? "" },
  );
  const body: SearchResponse = {
    results: await scoreJobs(db, result.listings),
    fromCache: result.fromCache,
    notices: result.notices,
  };
  return NextResponse.json(body);
});
