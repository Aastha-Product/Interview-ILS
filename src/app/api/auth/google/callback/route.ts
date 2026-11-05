import { type NextRequest, NextResponse } from "next/server";

import {
  finishSignIn,
  GoogleSignInError,
  openPendingSignIn,
  SIGN_IN_COOKIE,
  SIGN_IN_PATH,
  signInClient,
  signInMode,
  signInRedirectUri,
  type SignInError,
} from "@/lib/auth/google-sign-in";
import { safeNextPath } from "@/lib/auth/next-path";
import { startSession } from "@/lib/auth/session";
import { studentForGoogle } from "@/lib/auth/students";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/**
 * Where Google sends the browser back after a student signs in (Pathfinder). It comes from
 * Google's site before anyone is signed in, so it can't be a route(): the encrypted cookie from
 * /api/auth/google, matched against Google's state, proves this browser started the sign-in.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  const done = (to: string) => {
    const response = NextResponse.redirect(new URL(to, origin));
    response.cookies.set(SIGN_IN_COOKIE, "", { path: SIGN_IN_PATH, maxAge: 0 });
    response.headers.set("cache-control", "private, no-store");
    return response;
  };
  const fail = (error: SignInError) => done(`/login?error=${error}`);

  const params = request.nextUrl.searchParams;
  const pending = await openPendingSignIn(request.cookies.get(SIGN_IN_COOKIE)?.value, params.get("state"));
  if (!pending) return fail("expired");
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "denied" : "failed");
  const client = signInClient();
  if (signInMode() !== "google" || !client) return fail("not-configured");
  const code = params.get("code");
  if (!code) return fail("failed");

  try {
    const identity = await finishSignIn({ code, pending, client, redirect: signInRedirectUri(origin) });
    const userId = await studentForGoogle(identity);
    await startSession({ persistent: pending.remember, userId });
    return done(safeNextPath(pending.next));
  } catch (error) {
    if (error instanceof GoogleSignInError) return fail(error.kind);
    logServerError("google sign-in", error);
    return fail("failed");
  }
}
