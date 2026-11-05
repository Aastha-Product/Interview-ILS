import { getConfig, isDemoSignInEnabled } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createDevSession,
  demoPasswordMatches,
  isEmailSignInEnabled,
  sessionCookieName,
} from "@/server/dev-sign-in";
import { ipHashFrom } from "@/server/request-ip";
import { signInLimitResponse } from "@/server/sign-in-limit";

const formSchema = z.object({
  email: z.email().max(200),
  password: z.string().max(200).optional(),
});

/**
 * POST /api/dev/sign-in: email sign-in for local development, or for demo sites with the shared
 * demo password. Returns 404 whenever neither is enabled.
 */
export async function POST(request: Request) {
  if (!isEmailSignInEnabled()) return new NextResponse("Not found", { status: 404 });

  // Same-origin form posts only. Browsers always send Origin on a form POST, so a missing one
  // means the request didn't come from this app's sign-in page.
  const origin = request.headers.get("origin");
  if (
    !origin ||
    (origin !== new URL(getConfig().APP_URL).origin && origin !== new URL(request.url).origin)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const limited = await signInLimitResponse(request);
  if (limited) return limited;

  const form = await request.formData();
  const parsed = formSchema.safeParse({
    email: form.get("email"),
    password: form.get("password") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/signin?error=dev-email", request.url), 303);
  }
  if (isDemoSignInEnabled() && !demoPasswordMatches(parsed.data.password ?? "")) {
    return NextResponse.redirect(new URL("/signin?error=demo-password", request.url), 303);
  }

  const { sessionToken, expires } = await createDevSession(
    parsed.data.email.toLowerCase(),
    ipHashFrom(request.headers),
  );
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
