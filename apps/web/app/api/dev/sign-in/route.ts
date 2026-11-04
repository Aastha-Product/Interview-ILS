import { getConfig, isDevSignInEnabled } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createDevSession, sessionCookieName } from "@/server/dev-sign-in";
import { ipHashFrom } from "@/server/request-ip";

const formSchema = z.object({ email: z.email().max(200) });

/** POST /api/dev/sign-in: development-only sign-in. Returns 404 whenever it is disabled. */
export async function POST(request: Request) {
  if (!isDevSignInEnabled()) return new NextResponse("Not found", { status: 404 });

  // Same-origin form posts only.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(getConfig().APP_URL).origin && origin !== new URL(request.url).origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const parsed = formSchema.safeParse({ email: (await request.formData()).get("email") });
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/signin?error=dev-email", request.url), 303);
  }

  const { sessionToken, expires } = await createDevSession(parsed.data.email.toLowerCase(), ipHashFrom(request.headers));
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieName().startsWith("__Secure-"),
    path: "/",
    expires,
  });
  return response;
}
