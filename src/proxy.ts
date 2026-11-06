import { NextResponse, type NextRequest } from "next/server";

import { decodeSession, SESSION_COOKIE, sessionTokenOptions } from "@/lib/auth/session";
import { contentSecurityPolicy, createNonce, GOOGLE_SIGN_IN_ORIGIN } from "@/lib/csp";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";
import { PRINT_TOKEN_HEADER, verifyPrintToken } from "@/lib/pdf/print-token";

/** Signing in with Google (Pathfinder): its start and Google's callback, before there's a session. */
const SIGN_IN_PATHS = /^\/api\/auth\/google(?:\/callback)?$/;

/** The Claude connector's endpoint, its sign-in and the metadata that points to them. */
const CONNECTOR_PATHS = /^\/(?:api\/(?:mcp|oauth)(?:\/|$)|\.well-known\/oauth-(?:authorization-server|protected-resource)(?:\/|$))/;

/** Startups' screen (#222); Pathfinder answers 404 for it unless PATHFINDER_STARTUPS=on. */
const STARTUPS_PATHS = /^\/startups(?:\/|$)/;

/**
 * Sends signed-out visitors to /login before a page renders (PRD AUTH-1),
 * and gives every page its Content-Security-Policy (E11-5). The sign-in check
 * is only the optimistic one (a valid, unexpired cookie; no database): pages,
 * layouts, actions and route handlers still check the session themselves, so
 * a matcher mistake can't expose data.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || SIGN_IN_PATHS.test(pathname)) return pass(request);
  // The Claude connector (#221) brings its own credentials, an OAuth token,
  // which its routes check; they answer 404 while it's off.
  if (CONNECTOR_PATHS.test(pathname)) return NextResponse.next();
  // Pathfinder: Startups is off unless PATHFINDER_STARTUPS=on. Its layout answers 404 too, but
  // only after the loading screen has started streaming, with a 200; this is a real 404.
  if (STARTUPS_PATHS.test(pathname) && env.PATHFINDER_STARTUPS !== "on") return pass(request, new URL("/_not-found", request.url));

  const session = await decodeSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionTokenOptions(),
  );
  if (session) return pass(request);

  // Server Actions answer a signed-out call with a friendly error themselves
  // (see action()); a redirect here would break their response.
  if (request.headers.has("next-action")) return pass(request);

  // The PDF renderer's headless Chromium opens print pages with a token
  // instead of a cookie; the page checks it again.
  if (
    pathname.startsWith("/print/") &&
    (await verifyPrintToken(request.headers.get(PRINT_TOKEN_HEADER), pathname))
  ) {
    return pass(request);
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: messages.signedOut }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

/**
 * Lets the request through. Pages get the policy on the response, and on the
 * request too: that's where Next.js finds the nonce for its scripts. API
 * answers (JSON, files) need none. With `rewrite`, the page shown is that one instead.
 */
function pass(request: NextRequest, rewrite?: URL): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  // Behind a reverse proxy that ends TLS, only the forwarded header knows.
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? request.nextUrl.protocol.replace(/:$/, "");
  // The end-to-end tests' fake Google stands in for Google's sign-in host.
  const formTargets = [env.DOSSIER_GOOGLE_TEST_BASE_URL ? new URL(env.DOSSIER_GOOGLE_TEST_BASE_URL).origin : GOOGLE_SIGN_IN_ORIGIN];
  const policy = contentSecurityPolicy(createNonce(), { dev: process.env.NODE_ENV === "development", https: protocol === "https", formTargets });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = rewrite ? NextResponse.rewrite(rewrite, { request: { headers } }) : NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except the health check, Next.js' own assets (scripts,
    // styles, fonts, images), the dev server's hot-reload socket and public
    // files.
    "/((?!api/health(?:/|$)|_next/static/|_next/image|_next/hmr|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
