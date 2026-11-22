import { createHmac, timingSafeEqual } from "node:crypto";

import { effectivePlan, PLANS, type Plan, type PlanId } from "./plans";

// Phase 4: buying a plan with Razorpay Payment Links. The student is sent to Razorpay's own page
// to pay and back to /api/billing/callback; Razorpay also tells /api/billing/webhook. Either one,
// once its signature checks out, marks the payment paid and sets the plan. Prices and keys come
// from the server's settings (PATHFINDER_PRICE_*, RAZORPAY_*): with any of them missing, nothing
// can be bought.

export type PaidPlanId = Exclude<PlanId, "FREE">;
export const PAID_PLAN_IDS: readonly PaidPlanId[] = ["WEEKLY", "MONTHLY", "QUARTERLY"];

export type BillingEnv = {
  PATHFINDER_PRICE_WEEKLY?: number;
  PATHFINDER_PRICE_MONTHLY?: number;
  PATHFINDER_PRICE_QUARTERLY?: number;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
};

/** Each paid plan's price in rupees, as set on the server; null where it isn't. */
export function planPrices(source: BillingEnv): Record<PaidPlanId, number | null> {
  return { WEEKLY: source.PATHFINDER_PRICE_WEEKLY ?? null, MONTHLY: source.PATHFINDER_PRICE_MONTHLY ?? null, QUARTERLY: source.PATHFINDER_PRICE_QUARTERLY ?? null };
}

/** The plans with the server's prices filled in, for showing. */
export function pricedPlans(source: BillingEnv): Record<PlanId, Plan> {
  const prices = planPrices(source);
  return { FREE: PLANS.FREE, WEEKLY: { ...PLANS.WEEKLY, priceInr: prices.WEEKLY }, MONTHLY: { ...PLANS.MONTHLY, priceInr: prices.MONTHLY }, QUARTERLY: { ...PLANS.QUARTERLY, priceInr: prices.QUARTERLY } };
}

/** Whether Razorpay is set up: its key id and secret. */
export const razorpayReady = (source: BillingEnv) => Boolean(source.RAZORPAY_KEY_ID?.trim() && source.RAZORPAY_KEY_SECRET?.trim());

/** The plans a student can buy right now: Razorpay set up, and a price set. */
export function buyablePlans(source: BillingEnv): PaidPlanId[] {
  if (!razorpayReady(source)) return [];
  const prices = planPrices(source);
  return PAID_PLAN_IDS.filter((id) => prices[id] !== null);
}

const hmac = (secret: string, message: string) => createHmac("sha256", secret).update(message).digest("hex");

/** Constant-time comparison of two hex signatures. */
function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type CallbackParams = {
  razorpay_payment_id: string;
  razorpay_payment_link_id: string;
  razorpay_payment_link_reference_id: string;
  razorpay_payment_link_status: string;
  razorpay_signature: string;
};

/** Reads Razorpay's return to the callback; null when a part is missing. */
export function callbackParams(params: URLSearchParams): CallbackParams | null {
  const keys = ["razorpay_payment_id", "razorpay_payment_link_id", "razorpay_payment_link_reference_id", "razorpay_payment_link_status", "razorpay_signature"] as const;
  const values = keys.map((key) => params.get(key)?.trim() ?? "");
  if (values.some((value) => !value || value.length > 200)) return null;
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as CallbackParams;
}

/**
 * Whether Razorpay signed this return: HMAC-SHA256, with the key secret, of the link id, its
 * reference, its status and the payment id, joined by "|" (Razorpay's Payment Links docs).
 */
export function callbackSignatureValid(params: CallbackParams, keySecret: string): boolean {
  const message = [params.razorpay_payment_link_id, params.razorpay_payment_link_reference_id, params.razorpay_payment_link_status, params.razorpay_payment_id].join("|");
  return sameSignature(hmac(keySecret, message), params.razorpay_signature);
}

/** Whether Razorpay signed this webhook: HMAC-SHA256 of the raw body with the webhook secret. */
export const webhookSignatureValid = (body: string, signature: string | null, webhookSecret: string) => signature !== null && sameSignature(hmac(webhookSecret, body), signature);

/**
 * When a plan bought now ends: buying the plan you already have adds its period to the time you
 * have left; any other plan starts now.
 */
export function planUntilAfterPurchase(current: { plan: string | null; planUntil: Date | null }, bought: PaidPlanId, now = new Date()): Date {
  const days = PLANS[bought].periodDays!;
  const active = effectivePlan(current, now) === bought && current.planUntil !== null && current.planUntil.getTime() > now.getTime();
  const from = active ? current.planUntil!.getTime() : now.getTime();
  return new Date(from + days * 24 * 3600_000);
}

/** What a paid-link webhook says: the link, its reference (our payment id), what was paid and the payment id. */
export type PaidWebhook = { linkId: string; referenceId: string; amountPaise: number; paymentId: string };

/** Reads a payment_link.paid webhook; null for any other event or shape. */
export function paidWebhook(body: unknown): PaidWebhook | null {
  const event = body as { event?: unknown; payload?: { payment_link?: { entity?: Record<string, unknown> }; payment?: { entity?: Record<string, unknown> } } } | null;
  if (!event || event.event !== "payment_link.paid") return null;
  const link = event.payload?.payment_link?.entity ?? {};
  const payment = event.payload?.payment?.entity ?? {};
  const linkId = typeof link.id === "string" ? link.id : "";
  const referenceId = typeof link.reference_id === "string" ? link.reference_id : "";
  const paymentId = typeof payment.id === "string" ? payment.id : "";
  const amount = typeof link.amount_paid === "number" ? link.amount_paid : typeof payment.amount === "number" ? payment.amount : NaN;
  return linkId && referenceId && paymentId && Number.isInteger(amount) ? { linkId, referenceId, amountPaise: amount, paymentId } : null;
}
