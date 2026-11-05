import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "../src/client";
import { claimCooldown, deleteStaleRateLimits, hitRateLimit } from "../src/rate-limit";
import { resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

const at = (iso: string) => new Date(iso);

describe("hitRateLimit", () => {
  it("allows up to the limit in a window, refuses the next, and resets in the next window", async () => {
    const opts = { limit: 3, windowSeconds: 60 };
    const t = at("2026-11-05T10:00:10Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit("api:u1", { ...opts, now: t }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ count: 4, retryAfterSeconds: 50 });

    // Another key is independent.
    expect((await hitRateLimit("api:u2", { ...opts, now: t })).allowed).toBe(true);
    // The next minute starts again.
    expect(await hitRateLimit("api:u1", { ...opts, now: at("2026-11-05T10:01:00Z") })).toMatchObject({ allowed: true, count: 1 });
  });

  it("can't be beaten by requests sent at the same moment", async () => {
    const t = at("2026-11-05T10:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hitRateLimit("signin:ip", { limit: 10, windowSeconds: 60, now: t })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});

describe("claimCooldown", () => {
  it("lets exactly one of several simultaneous callers through, then reopens after the cooldown", async () => {
    const t = at("2026-11-05T10:00:00Z");
    const results = await Promise.all(Array.from({ length: 8 }, () => claimCooldown("search:u1", { cooldownMs: 300_000, now: t })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed).every((r) => r.retryAfterSeconds === 300)).toBe(true);

    expect(await claimCooldown("search:u1", { cooldownMs: 300_000, now: at("2026-11-05T10:04:00Z") })).toEqual({
      claimed: false,
      retryAfterSeconds: 60,
    });
    expect((await claimCooldown("search:u1", { cooldownMs: 300_000, now: at("2026-11-05T10:05:00Z") })).claimed).toBe(true);
  });
});

describe("deleteStaleRateLimits", () => {
  it("drops counters not touched since the cutoff", async () => {
    await hitRateLimit("old", { limit: 1, windowSeconds: 60, now: at("2026-11-05T09:00:00Z") });
    await hitRateLimit("new", { limit: 1, windowSeconds: 60, now: at("2026-11-05T10:00:00Z") });
    expect(await deleteStaleRateLimits(at("2026-11-05T09:30:00Z"))).toBe(1);
    expect((await getPrisma().rateLimit.findMany()).map((r) => r.key)).toEqual(["new"]);
  });
});
