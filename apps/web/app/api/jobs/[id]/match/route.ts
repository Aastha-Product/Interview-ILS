import { getMatch } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { withUser } from "@/server/http";
import { getAi } from "@/server/services";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/jobs/:id/match: score, reasons, gaps and a short explanation for the signed-in student. */
export const GET = withUser<{ id: string }>(async ({ db, params }) =>
  NextResponse.json(await getMatch({ db, ai: getAi() }, params.id, { explain: true })),
);
