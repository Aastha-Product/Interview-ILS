import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { takeToken, withRateLimit } from "./rate-limit";
import { RetryLater } from "./runner";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: "LOCAL" }) }));

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  await rawClientOf(prisma()).providerBudget.deleteMany();
});
afterAll(() => prisma().$disconnect());

describe("shared rate limits (auto-apply step 1)", () => {
  it("grants the burst at once, then says how long until the next token", async () => {
    const limit = { perMinute: 60, burst: 2 };
    expect(await takeToken("board", limit)).toBe(0);
    expect(await takeToken("board", limit)).toBe(0);
    const wait = await takeToken("board", limit);
    // One a second: the next token is under a second away.
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(1_000);
  });

  it("keeps each service's allowance apart", async () => {
    const limit = { perMinute: 1, burst: 1 };
    expect(await takeToken("one", limit)).toBe(0);
    expect(await takeToken("two", limit)).toBe(0);
    expect(await takeToken("one", limit)).toBeGreaterThan(0);
  });

  it("grants exactly the allowance to many workers asking at once", async () => {
    const limit = { perMinute: 1, burst: 5 };
    const waits = await Promise.all(Array.from({ length: 20 }, () => takeToken("busy-board", limit)));
    expect(waits.filter((wait) => wait === 0)).toHaveLength(5);
  });

  it("waits out a short wait, and hands a long one back to the queue", async () => {
    const quick = { perMinute: 600, burst: 1 };
    expect(await withRateLimit("quick", quick, async () => "first")).toBe("first");
    // The next token is 100 ms away: worth waiting for.
    expect(await withRateLimit("quick", quick, async () => "second")).toBe("second");

    const slow = { perMinute: 1, burst: 1 };
    await withRateLimit("slow", slow, async () => "first");
    const error = await withRateLimit("slow", slow, async () => "second").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RetryLater);
    expect((error as RetryLater).afterMs).toBeGreaterThan(50_000);
  });
});
