import { describe, expect, it } from "vitest";

import { applyDays, daySummary, MATCH_EVERY_MS, nextMatchAt } from "./run-log";

const now = new Date("2026-11-21T10:00:00Z");
const kolkata = "Asia/Kolkata";
const at = (iso: string) => new Date(iso);

describe("the run log (Phase 3)", () => {
  it("lists auto-apply's last seven days, newest first, quiet days too", () => {
    const days = applyDays([], now, kolkata);
    expect(days.map((day) => day.day)).toEqual(["2026-11-21", "2026-11-20", "2026-11-19", "2026-11-18", "2026-11-17", "2026-11-16", "2026-11-15"]);
    expect(days.every((day) => daySummary(day) === null)).toBe(true);
  });

  it("counts each application on the day it started, was applied, or came to wait on the student, in their time zone", () => {
    const days = applyDays(
      [
        // Prepared yesterday, applied today.
        { createdAt: at("2026-11-20T05:00:00Z"), appliedAt: at("2026-11-21T04:00:00Z"), updatedAt: at("2026-11-21T04:00:00Z"), state: "APPLIED" },
        // 20:00 UTC on the 20th is already the 21st in India.
        { createdAt: at("2026-11-20T20:00:00Z"), appliedAt: null, updatedAt: at("2026-11-20T20:30:00Z"), state: "NEEDS_STUDENT" },
        { createdAt: at("2026-11-19T06:00:00Z"), appliedAt: null, updatedAt: at("2026-11-19T07:00:00Z"), state: "FAILED" },
        // Older than the week: left out.
        { createdAt: at("2026-11-01T06:00:00Z"), appliedAt: null, updatedAt: at("2026-11-01T06:00:00Z"), state: "SKIPPED" },
      ],
      now,
      kolkata,
    );
    const byDay = Object.fromEntries(days.map((day) => [day.day, daySummary(day)]));
    expect(byDay["2026-11-21"]).toBe("1 prepared · 1 applied · 1 needs you");
    expect(byDay["2026-11-20"]).toBe("1 prepared");
    expect(byDay["2026-11-19"]).toBe("1 prepared · 1 couldn't apply");
  });

  it("looks for matches a day after the last look, or at the next round when that's past or never happened", () => {
    expect(nextMatchAt(at("2026-11-21T08:00:00Z"), now)).toEqual(new Date(at("2026-11-21T08:00:00Z").getTime() + MATCH_EVERY_MS));
    expect(nextMatchAt(at("2026-11-19T08:00:00Z"), now)).toEqual(now);
    expect(nextMatchAt(null, now)).toEqual(now);
  });
});
