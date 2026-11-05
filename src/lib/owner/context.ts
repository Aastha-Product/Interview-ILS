import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current student is, for code that runs outside a signed-in request: background jobs,
 * schedulers, imports. `runAsUser(userId, fn)` makes every database call inside `fn` act for that
 * student. Inside a request the student comes from the session instead (see src/lib/prisma.ts).
 */
const store = new AsyncLocalStorage<{ userId: string }>();

export function runAsUser<T>(userId: string, fn: () => T): T {
  if (!userId) throw new Error("runAsUser needs a user id");
  return store.run({ userId }, fn);
}

/** The student set by runAsUser, if any. */
export function contextUserId(): string | undefined {
  return store.getStore()?.userId;
}
