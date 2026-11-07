"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ActionError, publicAction } from "@/lib/action";
import { clientIp } from "@/lib/auth/client-ip";
import { firebaseIdentity, FirebaseSignInError } from "@/lib/auth/firebase";
import { signInMode } from "@/lib/auth/google-sign-in";
import { studentForFirebase } from "@/lib/auth/students";
import { logServerError } from "@/lib/log";
import { loginWaitMs, PER_IP_ONLY, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { safeNextPath } from "@/lib/auth/next-path";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { runAsUser } from "@/lib/owner/context";
import { systemPrisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { loginMessages } from "./messages";

/**
 * Signs a student in by email and the shared access code that DOSSIER_PASSWORD is a hash of
 * (Pathfinder). Anyone with the code can sign in as any email, so it only works while
 * PATHFINDER_SIGN_IN is "code" (trials); otherwise students sign in with Google.
 * Failed attempts are rate-limited per IP and globally (AUTH-5). Returns
 * where to go next: the requested page if it's on this site, or the dashboard.
 */
export const signIn = publicAction(
  z.object({
    email: z.email({ error: loginMessages.email }).max(200),
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ email, password, remember, next }, { toast }) => {
    if (signInMode() !== "code") throw new ActionError(loginMessages.useGoogle);
    const ip = clientIp(await headers());
    const wait = await loginWaitMs(systemPrisma, ip);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    if (!password) throw new ActionError(loginMessages.empty);
    if (!(await passwordMatches(password))) {
      await recordLoginFailure(systemPrisma, ip);
      throw new ActionError(loginMessages.wrong);
    }
    await recordLoginSuccess(systemPrisma, ip);

    const user = await systemPrisma.user.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase() },
      update: {},
    });
    await startSession({ persistent: remember, userId: user.id });
    const firstName = (await runAsUser(user.id, () => loadProfileName())).trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);

/**
 * Signs a student in with the ID token Firebase gave their browser (Pathfinder): checks it, links
 * or creates the student (their email address must be verified) and starts the session. Tokens
 * that don't check out count as failed attempts, like a wrong access code.
 */
export const signInWithFirebase = publicAction(
  z.object({ idToken: z.string().min(1).max(8192), remember: z.boolean(), next: z.string().optional() }),
  async ({ idToken, remember, next }, { toast }) => {
    if (signInMode() !== "firebase") throw new ActionError(loginMessages.notFirebase);
    const ip = clientIp(await headers());
    // Per IP only: a Firebase token can't be guessed, and an all-IPs count would let junk tokens lock everyone out.
    const wait = await loginWaitMs(systemPrisma, ip, undefined, PER_IP_ONLY);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    let userId: string;
    try {
      userId = await studentForFirebase(await firebaseIdentity(idToken));
    } catch (error) {
      if (!(error instanceof FirebaseSignInError)) {
        logServerError("firebase sign-in", error);
        throw new ActionError(loginMessages.firebaseFailed);
      }
      if (error.kind === "invalid") await recordLoginFailure(systemPrisma, ip, undefined, PER_IP_ONLY);
      throw new ActionError(error.message);
    }
    await recordLoginSuccess(systemPrisma, ip);
    await startSession({ persistent: remember, userId });
    const firstName = (await runAsUser(userId, () => loadProfileName())).trim().split(/\s+/)[0];
    toast(firstName ? `Welcome, ${firstName}.` : "Welcome.");
    return { redirectTo: safeNextPath(next) };
  },
);

/** What the sign-in form shows after a submit that `signInWithForm` handled. */
export type SignInFormState = { error: string } | null;

/**
 * `signIn` for the form's own submit, which the browser makes before the
 * page's scripts have run or when they're off (#187). It posts, so the
 * password never ends up in the URL. Goes on to the next page, or returns the
 * error for the page to show. There's no welcome toast this way.
 */
export async function signInWithForm(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const result = await signIn({
    email: text(form, "email"),
    password: text(form, "password"),
    remember: form.get("remember") === "on",
    next: text(form, "next") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(result.data.redirectTo);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
