import { describe, expect, it } from "vitest";

import { applicationsAllowed, dailyRequestLimit, effectivePlan, planEnd, planId, PLANS, priceText } from "./plans";

const now = new Date("2026-11-22T10:00:00Z");

describe("plans (Phase 4)", () => {
  it("reads a stored plan, and anything unknown as Free", () => {
    expect(planId("MONTHLY")).toBe("MONTHLY");
    expect(planId("GOLD")).toBe("FREE");
    expect(planId(null)).toBe("FREE");
  });

  it("keeps a plan until its end date, then falls back to Free", () => {
    expect(effectivePlan({ plan: "MONTHLY", planUntil: new Date("2026-12-01T00:00:00Z") }, now)).toBe("MONTHLY");
    expect(effectivePlan({ plan: "MONTHLY", planUntil: new Date("2026-11-20T00:00:00Z") }, now)).toBe("FREE");
    // A paid plan with no end date (given by an admin) lasts until it's changed.
    expect(effectivePlan({ plan: "WEEKLY", planUntil: null }, now)).toBe("WEEKLY");
    expect(effectivePlan({ plan: "FREE", planUntil: new Date("2030-01-01") }, now)).toBe("FREE");
  });

  it("limits AI by an admin's allowance first, then the plan, then the server's default", () => {
    expect(dailyRequestLimit({ allowance: 40, plan: "MONTHLY" }, 10, 2)).toBe(40);
    expect(dailyRequestLimit({ allowance: null, plan: "MONTHLY" }, 10, 2)).toBe(PLANS.MONTHLY.analysesPerDay! * 2);
    expect(dailyRequestLimit({ allowance: null, plan: "FREE" }, 10, 2)).toBe(10);
    expect(dailyRequestLimit({ allowance: null, plan: "FREE" }, null, 2)).toBeNull();
    // An allowance of 0 stops free analyses whatever the plan.
    expect(dailyRequestLimit({ allowance: 0, plan: "QUARTERLY" }, 10, 2)).toBe(0);
  });

  it("caps auto-apply's applications a day at the plan's", () => {
    expect(applicationsAllowed(30, "FREE")).toBe(PLANS.FREE.applicationsPerDay);
    // Free keeps today's default of 10 a day, so no one's setup changes.
    expect(applicationsAllowed(10, "FREE")).toBe(10);
    expect(applicationsAllowed(10, "MONTHLY")).toBe(10);
    expect(applicationsAllowed(50, "WEEKLY")).toBe(PLANS.WEEKLY.applicationsPerDay);
  });

  it("shows no price until one is set, and ends a plan after its period", () => {
    expect(priceText(PLANS.FREE)).toBe("Free");
    expect(priceText(PLANS.MONTHLY)).toBe("Price coming soon");
    expect(priceText({ ...PLANS.MONTHLY, priceInr: 1499 })).toBe("₹1,499 a month");
    expect(priceText({ ...PLANS.QUARTERLY, priceInr: 3999 })).toBe("₹3,999 for 3 months");
    expect(planEnd("WEEKLY", now)).toEqual(new Date("2026-11-29T10:00:00Z"));
    expect(planEnd("FREE", now)).toBeNull();
    expect(planEnd("MONTHLY", now, 3)).toEqual(new Date("2026-11-25T10:00:00Z"));
  });
});
