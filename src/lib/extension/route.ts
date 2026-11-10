import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { logServerError } from "@/lib/log";
import { runAsUser } from "@/lib/owner/context";
import { toolsEnabled } from "@/lib/tools";

import { verifyExtensionToken } from "./tokens";

// Pathfinder (auto-apply step 5): route handlers for the Pathfinder extension. The extension has no
// session cookie: it sends its token (Authorization: Bearer …), and the handler runs as the student
// it belongs to, so every query sees only their rows, as with route() for pages.

export type ExtensionContext = { userId: string; tokenId: string };

/** A JSON error the extension shows or acts on. */
export const extensionError = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export function extensionRoute<Context = unknown>(
  handler: (request: NextRequest, context: Context, extension: ExtensionContext) => Promise<Response>,
): (request: NextRequest, context: Context) => Promise<Response> {
  return async (request, context) => {
    if (!toolsEnabled()) return new Response(null, { status: 404 });
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const extension = await verifyExtensionToken(token);
    if (!extension) return extensionError(401, "Connect the extension to Pathfinder again: Auto-apply → Connect the extension.");
    let response: Response;
    try {
      response = await runAsUser(extension.userId, () => handler(request, context, extension));
    } catch (error) {
      unstable_rethrow(error);
      logServerError(`${request.method} ${request.nextUrl.pathname}`, error);
      response = extensionError(500, "Pathfinder ran into a problem. It will try again.");
    }
    if (!response.headers.has("cache-control")) {
      try {
        response.headers.set("cache-control", "private, no-store");
      } catch {
        // Some responses have immutable headers.
      }
    }
    return response;
  };
}
