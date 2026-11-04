import { randomBytes } from "node:crypto";
import { getConfig, isDevSignInEnabled, recordAudit } from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { SESSION_MAX_AGE_SECONDS } from "./auth";

/**
 * Development-only sign-in, for when no Google OAuth client is configured (local work, CI, e2e).
 * Creates a normal Auth.js database session, so everything downstream behaves as after Google sign-in.
 * Refuses to run in production or once Google sign-in is set up.
 */
export async function createDevSession(email: string, ipHash: string | null) {
  if (!isDevSignInEnabled()) throw new Error("Dev sign-in is disabled");
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
