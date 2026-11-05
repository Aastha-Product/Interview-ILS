import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "./server/csp";

/**
 * Runs before every page: sets a per-request nonce-based Content-Security-Policy. Next.js reads the
 * policy from the request headers and puts the nonce on its own scripts, which is why pages are
 * dynamically rendered (the root layout reads the headers). API routes return JSON and are skipped.
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
