import "server-only";

import { contextUserId } from "@/lib/owner/context";
import { OwnerScopeError } from "@/lib/owner/scope";

/**
 * The student the current code acts for: the one set by runAsUser (jobs, schedulers), else the
 * signed-in student of the current request. Throws when there is none.
 */
export async function currentUserId(): Promise<string> {
  const fromContext = contextUserId();
  if (fromContext) return fromContext;
  // Imported here, not at the top: the session module reads request cookies (next/headers).
  const { getSession } = await import("@/lib/auth/session");
  // Outside a request (startup, timers) there are no cookies to read: no student either.
  const session = await getSession().catch(() => null);
  if (session?.userId) return session.userId;
  throw new OwnerScopeError("No signed-in student for this database call");
}
