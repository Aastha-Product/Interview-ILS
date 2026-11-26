import { describe, expect, it } from "vitest";

import { SNAPSHOT_DAYS, snapshotCutoff, snapshotOf } from "./snapshot";

const at = new Date("2026-11-24T10:00:00Z");
const stored = { url: "https://jobs.lever.co/acme/1/apply", title: " Data Analyst ", messages: ["Resume is required"], unfilled: ["Notice period"] };

describe("what the page said, as Auto-apply shows it (Phase 3)", () => {
  it("shows a stored snapshot with when it was taken", () => {
    expect(snapshotOf(stored, at, at)).toEqual({ ...stored, title: "Data Analyst", at: at.toISOString() });
  });

  it("drops it once it's past keeping, or unreadable, or says nothing", () => {
    expect(snapshotOf(stored, at, new Date(at.getTime() + (SNAPSHOT_DAYS + 1) * 86_400_000))).toBeNull();
    expect(snapshotOf(stored, null, at)).toBeNull();
    expect(snapshotOf({ url: "x" }, at, at)).toBeNull();
    expect(snapshotOf({ url: "", title: " ", messages: [], unfilled: [] }, at, at)).toBeNull();
  });

  it("links only to web pages", () => {
    expect(snapshotOf({ ...stored, url: "javascript:alert(1)" }, at, at)?.url).toBe("");
  });

  it("clears snapshots older than 30 days", () => {
    expect(snapshotCutoff(at).toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
});
