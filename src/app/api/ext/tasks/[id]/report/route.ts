import { NextResponse } from "next/server";

import { reportOutcome, reportSchema } from "@/lib/apply/lease";
import { extensionError, extensionRoute } from "@/lib/extension/route";

/**
 * Pathfinder (step 5): how filling the form went: about to submit, applied, a dry run, needs the
 * student, uncertain, failed, or released. A report that doesn't fit the task's state or this
 * browser's lease changes nothing and answers 409.
 */
export const POST = extensionRoute<RouteContext<"/api/ext/tasks/[id]/report">>(async (request, { params }) => {
  const report = reportSchema.safeParse(await request.json().catch(() => null));
  if (!report.success) return extensionError(400, "That report couldn't be read.");
  const recorded = await reportOutcome((await params).id, report.data);
  return recorded ? NextResponse.json({ ok: true }) : extensionError(409, "This application isn't held by this browser any more.");
});
