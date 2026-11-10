import { NextResponse } from "next/server";

import { leaseNext } from "@/lib/apply/lease";
import { extensionRoute } from "@/lib/extension/route";

/** Pathfinder (step 5): the next application for this browser to fill, held for it; 204 when there's none. */
export const POST = extensionRoute(async () => {
  const task = await leaseNext();
  return task ? NextResponse.json(task) : new Response(null, { status: 204 });
});
