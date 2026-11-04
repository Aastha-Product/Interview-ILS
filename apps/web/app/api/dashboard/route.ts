import { getDashboard } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { withUser } from "@/server/http";

/** GET /api/dashboard: applications sent, responses and response rate, overall and by week. */
export const GET = withUser(async ({ db }) => NextResponse.json(await getDashboard(db)));
