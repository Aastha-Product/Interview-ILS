import { enqueueTailor, getApplication } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { withUser } from "@/server/http";

export const runtime = "nodejs";
// On demo sites drafting and the PDF run in this function after it responds (see server/inline-jobs.ts).
export const maxDuration = 120;

/**
 * POST /api/applications/:id/tailor: queue a (re)draft. Idempotent per profile version, so a
 * double-click or a repeat without profile changes returns the existing task.
 */
export const POST = withUser<{ id: string }>(async ({ db, params }) => {
  await getApplication(db, params.id); // 404 for someone else's application
  const task = await enqueueTailor(db, params.id);
  return NextResponse.json(task, { status: 202 });
});
