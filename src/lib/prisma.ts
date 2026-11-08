import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/database";
import { env } from "@/lib/env";
import { currentUserId } from "@/lib/owner/current";
import { scopedClient } from "@/lib/owner/scope";

// Reuse one client across hot reloads in development instead of opening a new
// connection pool on every change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; scopedPrisma?: PrismaClient };

function rawClient(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(env.DATABASE_URL, env.PATHFINDER_DB_POOL);
  return globalForPrisma.prisma;
}

function scoped(): PrismaClient {
  globalForPrisma.scopedPrisma ??= scopedClient(rawClient(), currentUserId);
  return globalForPrisma.scopedPrisma;
}

/** A client created on first use rather than on import, so `next build` works without secrets. */
function lazy(get: () => PrismaClient): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_, key) {
      const target = get();
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * The database client for app code: it only sees and changes the current student's rows (see
 * src/lib/owner/scope.ts). Existing queries stay as they are.
 */
export const prisma: PrismaClient = lazy(scoped);

/**
 * Unscoped access for system code only: sign-in and accounts (User), the sign-in throttle,
 * schedulers that list students, health checks and migrations. Never for a student's data.
 */
export const systemPrisma: PrismaClient = lazy(rawClient);
