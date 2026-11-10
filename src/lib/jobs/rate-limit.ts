import "server-only";

import { systemPrisma } from "@/lib/prisma";

import { RetryLater } from "./retry-later";

// Pathfinder (auto-apply step 1): a shared rate limit per outside service, so every worker together
// stays within what a job board or an AI provider allows, however many students' jobs run at once.
// A token bucket in Postgres (ProviderBudget): it holds up to `burst` tokens and refills at
// `perMinute`; each request takes one. The row lock makes takers line up, and the database clock
// is the only clock, so workers on different machines agree.

export type RateLimit = {
  /** Requests a minute, on average. */
  perMinute: number;
  /** Requests allowed at once after a quiet spell; `perMinute` unless given. */
  burst?: number;
};

/**
 * Takes one request's worth from `provider`'s allowance. Returns 0 when it's granted, else how many
 * milliseconds until a token will be there (nothing is taken then).
 */
export async function takeToken(provider: string, { perMinute, burst = perMinute }: RateLimit): Promise<number> {
  if (!(perMinute > 0) || !(burst >= 1)) throw new Error(`Invalid rate limit for ${provider}.`);
  const perSecond = perMinute / 60;
  await systemPrisma.$executeRaw`
    INSERT INTO "ProviderBudget" (provider, tokens, "updatedAt") VALUES (${provider}, ${burst}, clock_timestamp())
    ON CONFLICT (provider) DO NOTHING`;
  const [row] = await systemPrisma.$queryRaw<{ available: number }[]>`
    WITH current AS (
      SELECT provider,
        LEAST(${burst}::float8, tokens + EXTRACT(EPOCH FROM (clock_timestamp() - "updatedAt")) * ${perSecond}::float8) AS available
      FROM "ProviderBudget" WHERE provider = ${provider}
      FOR UPDATE
    )
    UPDATE "ProviderBudget" b
    SET tokens = CASE WHEN current.available >= 1 THEN current.available - 1 ELSE current.available END,
        "updatedAt" = clock_timestamp()
    FROM current WHERE b.provider = current.provider
    RETURNING current.available::float8 AS available`;
  const available = Number(row?.available ?? 0);
  if (available >= 1) return 0;
  return Math.ceil(((1 - available) / perSecond) * 1000);
}

/**
 * Runs `work` once `provider`'s allowance has room. A short wait (up to `maxWaitMs`) is waited out
 * here; a longer one throws RetryLater, so a background job gives its worker back and runs again
 * later instead of holding it.
 */
export async function withRateLimit<T>(
  provider: string,
  limit: RateLimit,
  work: () => Promise<T>,
  { maxWaitMs = 5_000, signal }: { maxWaitMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  let waited = 0;
  for (;;) {
    signal?.throwIfAborted();
    const wait = await takeToken(provider, limit);
    if (wait === 0) return work();
    if (waited + wait > maxWaitMs) throw new RetryLater(`Waiting for ${provider}, which limits how often it may be asked.`, wait);
    waited += wait;
    await sleep(wait, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
