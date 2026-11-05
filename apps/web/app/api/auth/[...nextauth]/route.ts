import type { NextRequest } from "next/server";
import { handlers } from "@/server/auth";
import { isSignInAttempt, signInLimitResponse } from "@/server/sign-in-limit";

/** Auth.js, with the per-IP sign-in limit on the requests that start or finish a sign-in. */
export async function GET(request: NextRequest) {
  if (isSignInAttempt(request)) {
    const limited = await signInLimitResponse(request);
    if (limited) return limited;
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  if (isSignInAttempt(request)) {
    const limited = await signInLimitResponse(request);
    if (limited) return limited;
  }
  return handlers.POST(request);
}
