import { configProblems } from "@pathfinder/core";
import { databaseIsUp } from "@pathfinder/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/health: for the host's health check and uptime monitors. No sign-in needed.
 * - 200 {"status":"ok"} when the configuration is valid and the database answers.
 * - 503 {"status":"misconfigured","settings":[...]} naming settings that are missing or wrong
 *   (names only, never values), so a deployment can be fixed without reading server logs.
 * - 503 {"status":"unavailable"} when the database doesn't answer within 5 s (a suspended free
 *   database can take a few seconds to wake).
 * Failures also say which commit is running, to tell an old deployment from a new one.
 */
export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const settings = configProblems();
  if (settings.length) {
    return Response.json(
      { status: "misconfigured", settings, version },
      { status: 503, headers: NO_STORE },
    );
  }
  const ok = await databaseIsUp(5_000);
  if (!ok)
    return Response.json({ status: "unavailable", version }, { status: 503, headers: NO_STORE });
  return Response.json({ status: "ok" }, { status: 200, headers: NO_STORE });
}
