import { authorizeLocalFileRequest, contentTypeForKey, getConfig } from "@pathfinder/core";
import { getCurrentUser } from "@/server/session";
import { getFileStorage } from "@/server/services";

export const runtime = "nodejs";

/**
 * GET /api/files?key=&exp=&name=&sig=: downloads a file stored by the local (development) storage
 * driver. Needs a signed-in student, a valid unexpired signature, and a file in that student's own
 * folder. In production (S3/R2) download links are presigned and never come here.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in again.", { status: 403 });

  const params = new URL(request.url).searchParams;
  const result = authorizeLocalFileRequest(
    { key: params.get("key"), exp: params.get("exp"), name: params.get("name"), sig: params.get("sig") },
    user.id,
    getConfig().AUTH_SECRET,
  );
  if (!result.ok) return new Response("This download link is invalid or has expired.", { status: 403 });

  let body: Uint8Array;
  try {
    body = await getFileStorage().get(result.key);
  } catch {
    return new Response("File not found.", { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForKey(result.key),
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${result.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
