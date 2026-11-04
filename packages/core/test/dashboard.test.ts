import { describe, expect, it } from "vitest";
import { computeDashboard, istWeekStart, type DashboardRow } from "../src/applications/dashboard";

// "Now" is Wednesday 4 Nov 2026, 12:00 IST. Weeks start Monday: 2 Nov, 26 Oct, 19 Oct ...
const now = new Date("2026-11-04T06:30:00Z");
const ist = (s: string) => new Date(`${s}+05:30`);

function row(status: DashboardRow["status"], applied?: string, response?: string, hasDraft = true): DashboardRow {
  return { status, appliedAt: applied ? ist(applied) : null, responseAt: response ? ist(response) : null, hasDraft };
}

describe("istWeekStart", () => {
  it("uses India time and Monday starts", () => {
    expect(istWeekStart(ist("2026-11-02T00:10:00"))).toBe("2026-11-02"); // Monday just after midnight IST
    expect(istWeekStart(ist("2026-11-01T23:50:00"))).toBe("2026-10-26"); // Sunday night IST
    expect(istWeekStart(new Date("2026-11-01T19:00:00Z"))).toBe("2026-11-02"); // 00:30 IST Monday
  });
});

describe("computeDashboard (seeded data)", () => {
  // Week of 19 Oct: 4 sent, 2 got responses (one rejection, one interview).
  // Week of 26 Oct: 5 sent, 1 response (received in the week of 2 Nov).
  // Week of 2 Nov: 1 sent, no response yet. Plus 2 drafts (one with a document) and 1 withdrawn after applying.
  const rows: DashboardRow[] = [
    row("REJECTED", "2026-10-19T10:00:00", "2026-10-23T10:00:00"),
    row("INTERVIEW", "2026-10-20T10:00:00", "2026-10-27T10:00:00"),
    row("APPLIED", "2026-10-21T10:00:00"),
    row("WITHDRAWN", "2026-10-22T10:00:00"),
    row("APPLIED", "2026-10-26T10:00:00"),
    row("APPLIED", "2026-10-27T10:00:00"),
    row("RESPONSE", "2026-10-28T10:00:00", "2026-11-03T10:00:00"),
    row("APPLIED", "2026-10-29T10:00:00"),
    row("APPLIED", "2026-10-30T10:00:00"),
    row("APPLIED", "2026-11-03T10:00:00"),
    row("DRAFT", undefined, undefined, true),
    row("DRAFT", undefined, undefined, false),
  ];
  const d = computeDashboard(rows, now, { weeks: 4 });

  it("computes totals: 3 responses from 10 sent is a 30% response rate", () => {
    expect(d.totals).toEqual({ sent: 10, responses: 3, responseRate: 0.3, interviews: 1, offers: 0, drafts: 2 });
  });

  it("computes weekly cohorts and responses received per week", () => {
    expect(d.weeks).toEqual([
      { weekStart: "2026-10-12", sent: 0, responsesReceived: 0, cohortResponses: 0, responseRate: null },
      { weekStart: "2026-10-19", sent: 4, responsesReceived: 1, cohortResponses: 2, responseRate: 0.5 },
      { weekStart: "2026-10-26", sent: 5, responsesReceived: 1, cohortResponses: 1, responseRate: 0.2 },
      { weekStart: "2026-11-02", sent: 1, responsesReceived: 1, cohortResponses: 0, responseRate: 0 },
    ]);
  });

  it("counts by status and suggests next steps from the data", () => {
    expect(d.byStatus).toMatchObject({ DRAFT: 2, APPLIED: 6, RESPONSE: 1, INTERVIEW: 1, REJECTED: 1, WITHDRAWN: 1, OFFER: 0 });
    expect(d.nextSteps[0]).toMatch(/1 draft ready/);
    // Only the 21 Oct application is still APPLIED and more than 14 days old.
    expect(d.nextSteps[1]).toMatch(/1 application has had no reply for over 2 weeks/);
    expect(d.nextSteps[2]).toMatch(/sent 1 application this week/);
  });

  it("returns a null rate rather than dividing by zero", () => {
    const empty = computeDashboard([], now);
    expect(empty.totals.responseRate).toBeNull();
    expect(empty.weeks).toHaveLength(8);
    expect(empty.weeks.every((w) => w.responseRate === null)).toBe(true);
  });
});
