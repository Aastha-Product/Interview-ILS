import { getConfig, importJob } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { readJson, withUser } from "@/server/http";
import { toMatchSummary } from "@/server/jobs";
import { getAi } from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/jobs/import { url?, text?, title?, company?, location? }: add a job the student found.
 * With only a link, the one page is fetched (robots.txt respected); otherwise the pasted text is used.
 */
export const POST = withUser(async ({ request, db }) => {
  const result = await importJob(
    { db, ai: getAi(), fetchOptions: { appUrl: getConfig().APP_URL } },
    (await readJson(request)) as never,
  );
  return NextResponse.json({ jobListingId: result.jobListingId, match: toMatchSummary(result.match) });
});
