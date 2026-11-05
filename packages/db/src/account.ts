import { getPrisma } from "./client";

/**
 * Deletes one user and, through ON DELETE CASCADE, every row they own: profile and its sections,
 * resume file records, preferences, matches, applications with their events, documents and tasks,
 * AI run and usage records, the audit log, feed search history, and Auth.js accounts and sessions
 * (so every signed-in browser is signed out at once). Shared job listings are not user data and stay.
 *
 * The scoped client refuses User deletes on purpose; this is the one place that does it.
 * Callers must delete the user's files first (see deleteAccount in @pathfinder/core).
 */
export async function deleteUserCascade(userId: string): Promise<boolean> {
  const result = await getPrisma().user.deleteMany({ where: { id: userId } });
  return result.count === 1;
}

/** The id of the user with this email, or null. For admin scripts such as demo seeding. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const user = await getPrisma().user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * Creates (or finds) a local user by email. Development only: with Google sign-in, a user created
 * this way has no linked Google account, and Auth.js then refuses that email's Google sign-in.
 */
export async function ensureLocalUser(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const user = await getPrisma().user.upsert({
    where: { email: normalised },
    update: {},
    create: { email: normalised, name: normalised.split("@")[0] },
    select: { id: true },
  });
  return user.id;
}
