import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "../src/client";
import { RETENTION, runRetention } from "../src/maintenance";
import { createUser, resetDatabase } from "./helpers";

const now = new Date("2026-11-05T21:30:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
let userId: string;

async function listing(n: number, closedAt: Date | null) {
  return getPrisma().jobListing.create({
    data: { source: "manual", sourceId: `ret${n}`, company: `C${n}`, title: "QA", description: "d", dedupeKey: `k${n}`, closedAt },
  });
}

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("retention@example.test")).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("runRetention", () => {
  it("deletes only old derived data and keeps everything a student owns", async () => {
    const prisma = getPrisma();
    const ai = (createdAt: Date) =>
      prisma.aiRun.create({
        data: { userId, task: "t", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, outcome: "ok", inputHash: "h", createdAt },
      });
    await ai(daysAgo(RETENTION.aiRunDays + 1));
    const recentRun = await ai(daysAgo(RETENTION.aiRunDays - 1));

    const oldClosed = await listing(1, daysAgo(RETENTION.closedListingDays + 5));
    const appliedClosed = await listing(2, daysAgo(RETENTION.closedListingDays + 5));
    const recentlyClosed = await listing(3, daysAgo(10));
    const open = await listing(4, null);
    await prisma.application.create({ data: { userId, jobListingId: appliedClosed.id } });

    await prisma.jobMatch.create({
      data: { userId, jobListingId: open.id, score: 50, reasons: [], gaps: [], profileVersion: 1 },
    });
    await prisma.$executeRaw`UPDATE "JobMatch" SET "updatedAt" = ${daysAgo(RETENTION.jobMatchDays + 1)}`;
    await prisma.jobMatch.create({
      data: { userId, jobListingId: recentlyClosed.id, score: 60, reasons: [], gaps: [], profileVersion: 1 },
    });

    await prisma.feedSearch.create({ data: { userId, query: "old", createdAt: daysAgo(RETENTION.feedSearchDays + 1) } });
    await prisma.feedSearch.create({ data: { userId, query: "new", createdAt: daysAgo(1) } });
    await prisma.feedCache.create({ data: { cacheKey: "old", source: "jsearch", listingIds: [], expiresAt: daysAgo(2) } });
    await prisma.feedCache.create({ data: { cacheKey: "live", source: "jsearch", listingIds: [], expiresAt: daysAgo(-1) } });
    await prisma.usageRecord.create({ data: { userId, day: daysAgo(RETENTION.usageDays + 1), aiCalls: 1 } });
    await prisma.usageRecord.create({ data: { userId, day: daysAgo(3), aiCalls: 1 } });

    expect(await runRetention({ now })).toEqual({
      aiRuns: 1,
      jobMatches: 1,
      closedListings: 1,
      feedSearches: 1,
      feedCache: 1,
      usageRecords: 1,
    });

    expect((await prisma.aiRun.findMany()).map((r) => r.id)).toEqual([recentRun.id]);
    const listings = (await prisma.jobListing.findMany({ select: { id: true } })).map((l) => l.id).sort();
    expect(listings).toEqual([appliedClosed.id, recentlyClosed.id, open.id].sort());
    expect(listings).not.toContain(oldClosed.id);
    expect(await prisma.application.count()).toBe(1);
    expect((await prisma.feedSearch.findMany()).map((s) => s.query)).toEqual(["new"]);
    expect((await prisma.feedCache.findMany()).map((c) => c.cacheKey)).toEqual(["live"]);
    expect(await prisma.usageRecord.count()).toBe(1);

    // Running it again changes nothing.
    expect(Object.values(await runRetention({ now })).every((n) => n === 0)).toBe(true);
  });

  it("can't delete a listing a student applied to, even directly", async () => {
    const applied = await listing(9, daysAgo(400));
    await getPrisma().application.create({ data: { userId, jobListingId: applied.id } });
    await expect(getPrisma().jobListing.delete({ where: { id: applied.id } })).rejects.toThrow();
    expect(await getPrisma().application.count()).toBe(1);
  });
});
