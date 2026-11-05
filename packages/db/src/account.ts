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
