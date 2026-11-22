import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { needsFollowUp } = await import("./applications-data");

const now = new Date("2026-11-22T10:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("when an application deserves a follow-up (Phase 3)", () => {
  it("is sent or in screening, not archived, and quiet for the follow-up days", () => {
    expect(needsFollowUp({ status: "SENT", archived: false, updatedAt: daysAgo(8) }, 7, now)).toBe(true);
    expect(needsFollowUp({ status: "SCREENING", archived: false, updatedAt: daysAgo(7) }, 7, now)).toBe(true);
    expect(needsFollowUp({ status: "SENT", archived: false, updatedAt: daysAgo(3) }, 7, now)).toBe(false);
    expect(needsFollowUp({ status: "SENT", archived: true, updatedAt: daysAgo(30) }, 7, now)).toBe(false);
    for (const status of ["DRAFT", "INTERVIEW", "OFFER", "REJECTED"]) expect(needsFollowUp({ status, archived: false, updatedAt: daysAgo(30) }, 7, now)).toBe(false);
  });
});
