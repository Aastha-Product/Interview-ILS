import { type NextRequest, NextResponse } from "next/server";

import { beginSignIn, SIGN_IN_COOKIE, SIGN_IN_PATH, SIGN_IN_TTL_SECONDS, signInClient, signInMode, signInRedirectUri } from "@/lib/auth/google-sign-in";
import { safeNextPath } from "@/lib/auth/next-path";
import { isHttps } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/google/origin";

/**
 * Starts signing in with Google (Pathfinder): `?next=/path&remember=on` from the sign-in page.
 * Signed-out visitors come here, so it can't be a route(); it only sends this browser to Google
 * with a cookie that the callback checks, and touches no data.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  const client = signInClient();
  if (signInMode() !== "google" || !client) {
    return NextResponse.redirect(new URL("/login?error=not-configured", origin));
  }
  const params = request.nextUrl.searchParams;
  const { url, cookie } = await beginSignIn({
    clientId: client.id,
    redirect: signInRedirectUri(origin),
    next: safeNextPath(params.get("next")),
    remember: params.get("remember") === "on",
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(SIGN_IN_COOKIE, cookie, {
    httpOnly: true,
    // Lax: it must come back on Google's top-level redirect to the callback.
    sameSite: "lax",
    path: SIGN_IN_PATH,
    secure: await isHttps(),
    maxAge: SIGN_IN_TTL_SECONDS,
  });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
