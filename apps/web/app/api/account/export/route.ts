import { exportAccount } from "@pathfinder/core";
import { withUser } from "@/server/http";
import { ipHashFrom } from "@/server/request-ip";

export const runtime = "nodejs";

/**
 * POST /api/account/export: everything Pathfinder holds about the signed-in student, as a JSON
 * download. POST (not GET) so it can't be triggered by a link or prefetch; each export is audited.
 */
export const POST = withUser(async ({ request, db }) => {
  const now = new Date();
  const data = await exportAccount(db, { ipHash: ipHashFrom(request.headers), now });
  const day = now.toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pathfinder-export-${day}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
