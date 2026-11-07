import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

import { afterFailure, GLOBAL, PER_IP, waitMs } from "./throttle";

// Rate limiting for sign-in (PRD AUTH-5), stored in Postgres so limits survive
// restarts without Redis. Each failure counts for the client IP and, for the
// shared access code, for all IPs together (the key "*").
//
// Pathfinder: the all-IPs backstop protects a secret that can be guessed (the
// access code) when X-Forwarded-For can be faked. A Google or Firebase token
// can't be guessed, since its signature is checked, so those sign-ins count per
// IP only: otherwise anyone could send 30 junk tokens and lock out every
// student (QA H-3).

export const GLOBAL_KEY = "*";
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Whether the all-IPs backstop applies: only to the access code, which can be guessed. */
export type ThrottleScope = { global: boolean };
const WITH_GLOBAL: ThrottleScope = { global: true };
/** For sign-ins whose credential can't be guessed (Google, Firebase). */
export const PER_IP_ONLY: ThrottleScope = { global: false };

/** Milliseconds the client must wait before trying again; 0 when it may try now. */
export async function loginWaitMs(db: PrismaClient, ip: string, now = new Date(), scope: ThrottleScope = WITH_GLOBAL): Promise<number> {
  const rows = await db.loginThrottle.findMany({ where: { key: { in: scope.global ? [ip, GLOBAL_KEY] : [ip] } } });
  return Math.max(0, ...rows.map((row) => waitMs(row, now)));
}

/** Counts a failed attempt for the IP (and globally, for the access code), and prunes stale rows. */
export async function recordLoginFailure(db: PrismaClient, ip: string, now = new Date(), scope: ThrottleScope = WITH_GLOBAL): Promise<void> {
  const counters = scope.global
    ? ([
        [ip, PER_IP],
        [GLOBAL_KEY, GLOBAL],
      ] as const)
    : ([[ip, PER_IP]] as const);
  await db.$transaction(async (tx) => {
    // Always the IP first, then the global row, so concurrent failures can't deadlock.
    for (const [key, policy] of counters) {
      // Creates the row, or locks it with a write that changes nothing, so
      // concurrent failures take turns (in PostgreSQL and SQLite alike).
      await tx.$executeRaw`
        INSERT INTO "LoginThrottle" (key, "windowStart", "updatedAt")
        VALUES (${key}, ${now}, ${now})
        ON CONFLICT (key) DO UPDATE SET key = excluded.key`;
      const row = await tx.loginThrottle.findUniqueOrThrow({
        where: { key },
        select: { failures: true, windowStart: true, blockedUntil: true },
      });
      const next = afterFailure(row.failures === 0 ? null : row, now, policy);
      await tx.loginThrottle.update({ where: { key }, data: { ...next, updatedAt: now } });
    }
    await tx.loginThrottle.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - PRUNE_AFTER_MS) } },
    });
  });
}

/** A successful sign-in resets the IP's counter (the global one runs out by itself). */
export async function recordLoginSuccess(db: PrismaClient, ip: string): Promise<void> {
  await db.loginThrottle.deleteMany({ where: { key: ip } });
}
