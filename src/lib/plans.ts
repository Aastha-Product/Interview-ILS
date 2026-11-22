// Phase 4 (business): plans and what each allows. Groundwork for paid plans: the limits are
// enforced on the server today, and an admin sets a student's plan; checkout (Razorpay) plugs in
// later and only has to set the same plan and end date. Prices are the owner's to set, so none is
// shown until one is filled in here.

export const PLAN_IDS = ["FREE", "WEEKLY", "MONTHLY", "QUARTERLY"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Plan = {
  id: PlanId;
  name: string;
  /** What it's for, in a line. */
  summary: string;
  /** In rupees for the whole period; null until the owner sets it ("price coming soon"). */
  priceInr: number | null;
  /** How long it lasts once bought; null for Free, which doesn't end. */
  periodDays: number | null;
  /**
   * Resume analyses a day on the server's AI key; null for Free, which takes the server's own
   * default (PATHFINDER_AI_DAILY_LIMIT).
   */
  analysesPerDay: number | null;
  /** The most applications auto-apply prepares in a day, whatever the student sets. */
  applicationsPerDay: number;
};

export const PLANS: Record<PlanId, Plan> = {
  FREE: { id: "FREE", name: "Free", summary: "Everything you need to try it.", priceInr: null, periodDays: null, analysesPerDay: null, applicationsPerDay: 10 },
  WEEKLY: { id: "WEEKLY", name: "Weekly", summary: "A short, focused week of applying.", priceInr: null, periodDays: 7, analysesPerDay: 15, applicationsPerDay: 25 },
  MONTHLY: { id: "MONTHLY", name: "Monthly", summary: "A month of steady applications.", priceInr: null, periodDays: 30, analysesPerDay: 25, applicationsPerDay: 40 },
  QUARTERLY: { id: "QUARTERLY", name: "3 months", summary: "A whole job search, start to offer.", priceInr: null, periodDays: 90, analysesPerDay: 30, applicationsPerDay: 50 },
};

/** A stored plan name read back; anything unknown is Free. */
export const planId = (value: string | null | undefined): PlanId => (PLAN_IDS as readonly string[]).includes(value ?? "") ? (value as PlanId) : "FREE";

/** The plan in effect: the one set, until its end date; Free after that. */
export function effectivePlan(user: { plan: string | null; planUntil: Date | null }, now = new Date()): PlanId {
  const id = planId(user.plan);
  if (id === "FREE") return "FREE";
  return user.planUntil && user.planUntil.getTime() <= now.getTime() ? "FREE" : id;
}

/**
 * A student's AI requests a day on the shared key: an admin's allowance for them first, then their
 * plan's, then the server's default; null for no limit. `requestsPerAnalysis` turns analyses into
 * the requests the daily limit counts.
 */
export function dailyRequestLimit(
  { allowance, plan }: { allowance: number | null; plan: PlanId },
  serverDefault: number | null,
  requestsPerAnalysis: number,
): number | null {
  if (allowance !== null) return allowance;
  const analyses = PLANS[plan].analysesPerDay;
  return analyses === null ? serverDefault : analyses * requestsPerAnalysis;
}

/** Applications auto-apply may prepare today: the student's own limit, within their plan's. */
export const applicationsAllowed = (studentLimit: number, plan: PlanId) => Math.min(studentLimit, PLANS[plan].applicationsPerDay);

/** "₹499 a month", or "Price coming soon" until the owner sets one. */
export function priceText(plan: Plan): string {
  if (plan.id === "FREE") return "Free";
  if (plan.priceInr === null) return "Price coming soon";
  const period = plan.periodDays === 7 ? "a week" : plan.periodDays === 30 ? "a month" : plan.periodDays === 90 ? "for 3 months" : `for ${plan.periodDays} days`;
  return `₹${new Intl.NumberFormat("en-IN").format(plan.priceInr)} ${period}`;
}

/** When a plan bought now would end. */
export const planEnd = (plan: PlanId, now = new Date(), days = PLANS[plan].periodDays): Date | null => (days === null ? null : new Date(now.getTime() + days * 24 * 3600_000));
