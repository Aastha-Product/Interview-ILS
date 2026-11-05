import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current student is, for code that runs outside a signed-in request: background jobs,
 * schedulers, imports. `runAsUser(userId, fn)` makes every database call inside `fn` act for that
 * student. Inside a request the student comes from the session instead (see src/lib/owner/current.ts).
 */
const store = new AsyncLocalStorage<{ userId: string }>();

/**
 * Runs `fn` as the student. Always async: Prisma queries are lazy and only start when awaited,
 * so `fn`'s result is awaited inside the student's context. (Returning an unawaited query from a
 * plain callback would otherwise run it after the context ended.)
 */
export function runAsUser<T>(userId: string, fn: () => T | Promise<T>): Promise<T> {
  if (!userId) return Promise.reject(new Error("runAsUser needs a user id"));
  return store.run({ userId }, async () => await fn());
}

/** The student set by runAsUser, if any. */
export function contextUserId(): string | undefined {
  return store.getStore()?.userId;
}
