import { getPrisma } from "./client";

/**
 * Rate limits and cooldowns kept in Postgres, so every web instance shares them. Each check is a
 * single atomic statement (insert or update with a condition), so two requests racing each other
 * can't both slip under the limit.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests counted in the current window, including this one. */
  count: number;
  /** Seconds until the window resets (always at least 1). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter: counts one hit against `key` and says whether it is within `limit` hits per
 * `windowSeconds`. Hits over the limit are still counted, so hammering doesn't reset anything early.
 */
export async function hitRateLimit(
  key: string,
  options: { limit: number; windowSeconds: number; now?: Date },
): Promise<RateLimitResult> {
  const now = options.now ?? new Date();
  const windowMs = options.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "updatedAt")
    VALUES (${key}, ${windowStart}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = EXCLUDED."windowStart" THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  return { allowed: count <= options.limit, count, retryAfterSeconds };
}

/**
 * Cooldown: claims `key` if it hasn't been claimed in the last `cooldownMs`. Exactly one of several
 * concurrent callers gets `claimed: true`; the others get the time left.
 */
export async function claimCooldown(
  key: string,
  options: { cooldownMs: number; now?: Date },
): Promise<{ claimed: boolean; retryAfterSeconds: number }> {
  const now = options.now ?? new Date();
  const reopensBefore = new Date(now.getTime() - options.cooldownMs);
  const prisma = getPrisma();
  const claimed = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "updatedAt")
    VALUES (${key}, ${now}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = EXCLUDED."windowStart", "count" = 1, "updatedAt" = EXCLUDED."updatedAt"
      WHERE "RateLimit"."windowStart" <= ${reopensBefore}
    RETURNING "key"`;
  if (claimed.length === 1) return { claimed: true, retryAfterSeconds: 0 };
  const row = await prisma.rateLimit.findUnique({ where: { key }, select: { windowStart: true } });
  const reopensAt = (row?.windowStart.getTime() ?? now.getTime()) + options.cooldownMs;
  return { claimed: false, retryAfterSeconds: Math.max(1, Math.ceil((reopensAt - now.getTime()) / 1000)) };
}

/** Housekeeping: drops counters not touched since `before`. */
export async function deleteStaleRateLimits(before: Date): Promise<number> {
  return (await getPrisma().rateLimit.deleteMany({ where: { updatedAt: { lt: before } } })).count;
}
