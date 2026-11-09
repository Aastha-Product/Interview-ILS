import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

import { resolveAiConfig } from "./config";
import { analysesLeftToday, analysesPerDay, chargeSharedAi, limitDay, sharedAiUsedToday, studentDailyLimit, withDailyLimit } from "./daily-limit";
import { AiError } from "./errors";
import type { AIProvider } from "./provider";

// Pathfinder: each student gets PATHFINDER_AI_DAILY_LIMIT requests a day on the server's shared
// AI key; the count is per student and resets at midnight IST.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const env = vi.hoisted(() => ({ PATHFINDER_AI_DAILY_LIMIT: undefined as number | undefined }));
vi.mock("@/lib/env", () => ({ env }));

const prisma = () => db.client!;
const OTHER = "other-student";
const asOther = <T>(fn: () => Promise<T>) => runAsUser(OTHER, fn);

function fakeProvider() {
  const complete = vi.fn(async () => "an answer");
  const provider = { kind: "MOCK", model: "fake", complete, listModels: async () => [], test: async () => ({ model: "fake", latencyMs: 1 }) } as unknown as AIProvider;
  return { provider, complete };
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await rawClientOf(prisma()).user.create({ data: { id: OTHER, email: "other@example.test" } });
});
afterAll(() => prisma().$disconnect());

describe("the daily AI limit (Pathfinder)", () => {
  it("lets each student make the limit's number of requests on the shared key, then refuses with a clear message", async () => {
    const { provider, complete } = fakeProvider();
    const limited = withDailyLimit(provider, true, 2);
    await limited.complete({ system: "", messages: [] });
    await limited.complete({ system: "", messages: [] });
    const third = limited.complete({ system: "", messages: [] });
    await expect(third).rejects.toBeInstanceOf(AiError);
    await expect(limited.complete({ system: "", messages: [] })).rejects.toMatchObject({
      kind: "daily-limit",
      message: "You've used today's AI limit; it resets at midnight IST, or add your own key in Settings → AI provider.",
      retryable: false,
    });
    // The refused requests never reached the provider.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("tells the student how many analyses (two requests each) the limit allows, and how many are left today", async () => {
    expect(analysesPerDay(10)).toBe(5);
    expect(analysesPerDay(1)).toBe(1);
    expect(analysesPerDay(undefined)).toBeNull();
    expect(await analysesLeftToday(true, 10)).toBe(5);
    await chargeSharedAi(10);
    await chargeSharedAi(10);
    await chargeSharedAi(10);
    expect(await analysesLeftToday(true, 10)).toBe(3);
    // Their own key, or no limit: nothing to count.
    expect(await analysesLeftToday(false, 10)).toBeNull();
    expect(await analysesLeftToday(true, undefined)).toBeNull();
  });

  it("counts per student: one student's use leaves another's untouched", async () => {
    await chargeSharedAi(2);
    await chargeSharedAi(2);
    await expect(chargeSharedAi(2)).rejects.toMatchObject({ kind: "daily-limit" });
    await asOther(async () => {
      expect(await sharedAiUsedToday()).toBe(0);
      await expect(chargeSharedAi(2)).resolves.toBeUndefined();
      expect(await sharedAiUsedToday()).toBe(1);
    });
    const rows = await rawClientOf(prisma()).aiUsage.findMany({ select: { userId: true, count: true }, orderBy: { userId: "asc" } });
    expect(rows).toEqual([
      { userId: OTHER, count: 1 },
      { userId: TEST_USER_ID, count: 3 },
    ]);
  });

  it("resets at midnight in India, not at midnight UTC", async () => {
    // 18:29 UTC is 23:59 IST; 18:30 UTC is 00:00 IST the next day.
    const beforeMidnight = new Date("2026-11-06T18:29:00Z");
    const afterMidnight = new Date("2026-11-06T18:30:00Z");
    expect(limitDay(beforeMidnight)).toBe("2026-11-06");
    expect(limitDay(afterMidnight)).toBe("2026-11-07");
    await chargeSharedAi(1, beforeMidnight);
    await expect(chargeSharedAi(1, beforeMidnight)).rejects.toMatchObject({ kind: "daily-limit" });
    await expect(chargeSharedAi(1, afterMidnight)).resolves.toBeUndefined();
  });

  it("doesn't limit students who use their own key, or a server without a limit", async () => {
    const own = fakeProvider();
    const notShared = withDailyLimit(own.provider, false, 1);
    expect(notShared).toBe(own.provider);
    const noLimit = fakeProvider();
    expect(withDailyLimit(noLimit.provider, true, null)).toBe(noLimit.provider);
    // Looked up per request: no limit set anywhere, so nothing is counted.
    await withDailyLimit(noLimit.provider, true).complete({ system: "", messages: [] });
    expect(await sharedAiUsedToday()).toBe(0);
  });

  it("uses the allowance an admin set for a student instead of the server's limit (admin console)", async () => {
    env.PATHFINDER_AI_DAILY_LIMIT = 10;
    try {
      expect(await studentDailyLimit()).toBe(10);
      await rawClientOf(prisma()).user.update({ where: { id: TEST_USER_ID }, data: { aiDailyLimit: 2 } });
      expect(await studentDailyLimit()).toBe(2);
      // Another student keeps the server's limit.
      expect(await asOther(() => studentDailyLimit())).toBe(10);

      const { provider, complete } = fakeProvider();
      const limited = withDailyLimit(provider, true);
      await limited.complete({ system: "", messages: [] });
      await limited.complete({ system: "", messages: [] });
      await expect(limited.complete({ system: "", messages: [] })).rejects.toMatchObject({ kind: "daily-limit" });
      expect(complete).toHaveBeenCalledTimes(2);

      // An allowance of 0 stops the student's free analyses.
      await rawClientOf(prisma()).user.update({ where: { id: TEST_USER_ID }, data: { aiDailyLimit: 0 } });
      expect(analysesPerDay(await studentDailyLimit())).toBe(0);
      expect(await analysesLeftToday(true, 0)).toBe(0);
    } finally {
      env.PATHFINDER_AI_DAILY_LIMIT = undefined;
    }
  });

  it("knows which key is the server's: DOSSIER_AI_KEY, unless the student saved their own", () => {
    const source = { DOSSIER_AI_PROVIDER: "anthropic", DOSSIER_AI_KEY: "server-key" } as const;
    expect(resolveAiConfig(null, source).sharedKey).toBe(true);
    // A provider chosen in Settings without a key of its own still uses the server's key.
    const savedNoKey = { provider: "ANTHROPIC", baseUrl: "", model: "", apiKeyEnc: null } as never;
    expect(resolveAiConfig(savedNoKey, source).sharedKey).toBe(true);
    // No key on the server: nothing shared.
    expect(resolveAiConfig(null, { DOSSIER_AI_PROVIDER: "anthropic" }).sharedKey).toBe(false);
  });
});
