import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig, isDemoSignInEnabled, isDevSignInEnabled, recordAudit } from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { SESSION_MAX_AGE_SECONDS } from "./auth";

/** True when the dev form (local) or the demo form (demo sites, with the demo password) is available. */
export function isEmailSignInEnabled(): boolean {
  return isDevSignInEnabled() || isDemoSignInEnabled();
}

/** Constant-time check of the shared demo password. */
export function demoPasswordMatches(given: string): boolean {
  const expected = getConfig().DEMO_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Email sign-in without Google: the local dev form, or the demo form on demo sites (which also
 * needs the shared DEMO_PASSWORD, checked by the route). Creates a normal Auth.js database session,
 * so everything downstream behaves as after Google sign-in. Refuses to run anywhere else.
 */
export async function createDevSession(email: string, ipHash: string | null) {
  if (!isEmailSignInEnabled()) throw new Error("Email sign-in is disabled");
  const prisma = getPrisma();
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: email.split("@")[0] },
    update: {},
  });
  if (user.deletedAt) throw new Error("Account deleted");
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });
  await recordAudit(scopedDb(user.id), "SIGN_IN", ipHash);
  return { sessionToken, expires };
}

/** Auth.js's cookie name: the __Secure- prefix applies when the app runs on https. */
export function sessionCookieName(): string {
  return new URL(getConfig().APP_URL).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}
