import "server-only";

import { notFound } from "next/navigation";

import { verifySession, type Session } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { systemPrisma } from "@/lib/prisma";

// Pathfinder: the admin console (/admin) is for the people running the service. Who they are is a
// server setting, PATHFINDER_ADMIN_EMAILS, so no one can make themselves an admin from the app.

/** The admins' email addresses from PATHFINDER_ADMIN_EMAILS, lower-cased; empty when it's unset. */
export function adminEmails(source: string | undefined = env.PATHFINDER_ADMIN_EMAILS): Set<string> {
  return new Set(
    (source ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@")),
  );
}

/** Whether the student `userId` signs in with one of the admins' email addresses. */
export async function isAdmin(userId: string, admins: Set<string> = adminEmails()): Promise<boolean> {
  if (admins.size === 0) return false;
  const user = await systemPrisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user !== null && admins.has(user.email.toLowerCase());
}

/**
 * The session of an admin, for the admin pages. Anyone else gets "not found", so the console
 * doesn't show it exists.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await verifySession();
  if (!(await isAdmin(session.userId))) notFound();
  return session;
}
