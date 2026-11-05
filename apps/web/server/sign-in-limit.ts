import "server-only";
import { checkSignInLimit } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { ipHashFrom } from "./request-ip";

/**
 * Applies the per-IP sign-in limit (10 a minute) to a sign-in request. Sign-in is a browser
 * navigation, not an API call, so an over-limit attempt is sent back to the sign-in page with a
 * friendly message (and a Retry-After header) instead of a JSON 429.
 */
export async function signInLimitResponse(request: Request): Promise<NextResponse | null> {
  const retryAfter = await checkSignInLimit(ipHashFrom(request.headers));
  if (retryAfter === null) return null;
  const response = NextResponse.redirect(new URL("/signin?error=too-many", request.url), 303);
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

/** Auth.js paths that start or finish a sign-in (the others, like /session, aren't attempts). */
export function isSignInAttempt(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return /^\/api\/auth\/(signin|callback)(\/|$)/.test(pathname);
}
