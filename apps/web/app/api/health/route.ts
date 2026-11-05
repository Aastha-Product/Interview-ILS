import { databaseIsUp } from "@pathfinder/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health: for the host's health check and uptime monitors. No sign-in, no details:
 * 200 when the app can reach its database, 503 when it can't.
 */
export async function GET() {
  const ok = await databaseIsUp();
  return Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
