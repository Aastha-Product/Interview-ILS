import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buyablePlans,
  callbackParams,
  callbackSignatureValid,
  paidWebhook,
  planPrices,
  planUntilAfterPurchase,
  pricedPlans,
  razorpayReady,
  webhookSignatureValid,
} from "./billing";
import { PLANS, priceText } from "./plans";

const sign = (secret: string, message: string) => createHmac("sha256", secret).update(message).digest("hex");
const now = new Date("2026-11-22T10:00:00Z");
const keys = { RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret" };

describe("buying a plan (Phase 4)", () => {
  it("takes prices from the server's settings, and sells only what has a price once Razorpay is set up", () => {
    expect(planPrices({ PATHFINDER_PRICE_MONTHLY: 499 })).toEqual({ WEEKLY: null, MONTHLY: 499, QUARTERLY: null });
    expect(priceText(pricedPlans({ PATHFINDER_PRICE_MONTHLY: 499 }).MONTHLY)).toBe("₹499 a month");
    expect(pricedPlans({}).WEEKLY.priceInr).toBeNull();
    expect(razorpayReady({ RAZORPAY_KEY_ID: "rzp", RAZORPAY_KEY_SECRET: " " })).toBe(false);
    expect(buyablePlans({ PATHFINDER_PRICE_MONTHLY: 499, PATHFINDER_PRICE_QUARTERLY: 1299 })).toEqual([]);
    expect(buyablePlans({ ...keys, PATHFINDER_PRICE_MONTHLY: 499, PATHFINDER_PRICE_QUARTERLY: 1299 })).toEqual(["MONTHLY", "QUARTERLY"]);
  });

  it("trusts Razorpay's return only with its signature", () => {
    const query = new URLSearchParams({
      razorpay_payment_id: "pay_1",
      razorpay_payment_link_id: "plink_1",
      razorpay_payment_link_reference_id: "pmt_1",
      razorpay_payment_link_status: "paid",
      razorpay_signature: sign("secret", "plink_1|pmt_1|paid|pay_1"),
    });
    const params = callbackParams(query)!;
    expect(callbackSignatureValid(params, "secret")).toBe(true);
    expect(callbackSignatureValid(params, "other-secret")).toBe(false);
    expect(callbackSignatureValid({ ...params, razorpay_payment_link_status: "cancelled" }, "secret")).toBe(false);
    expect(callbackSignatureValid({ ...params, razorpay_signature: "short" }, "secret")).toBe(false);
    query.delete("razorpay_signature");
    expect(callbackParams(query)).toBeNull();
  });

  it("trusts a webhook only with its signature, and reads a paid link from it", () => {
    const body = JSON.stringify({
      event: "payment_link.paid",
      payload: { payment_link: { entity: { id: "plink_1", reference_id: "pmt_1", amount_paid: 49900, status: "paid" } }, payment: { entity: { id: "pay_1", amount: 49900 } } },
    });
    expect(webhookSignatureValid(body, sign("hook", body), "hook")).toBe(true);
    expect(webhookSignatureValid(`${body} `, sign("hook", body), "hook")).toBe(false);
    expect(webhookSignatureValid(body, null, "hook")).toBe(false);
    expect(paidWebhook(JSON.parse(body))).toEqual({ linkId: "plink_1", referenceId: "pmt_1", amountPaise: 49900, paymentId: "pay_1" });
    expect(paidWebhook({ event: "payment.failed", payload: {} })).toBeNull();
    expect(paidWebhook({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1" } } } })).toBeNull();
    expect(paidWebhook(null)).toBeNull();
  });

  it("adds a renewal to the time left on the same plan, and starts any other plan now", () => {
    const day = 24 * 3600_000;
    const left = new Date(now.getTime() + 10 * day);
    expect(planUntilAfterPurchase({ plan: "MONTHLY", planUntil: left }, "MONTHLY", now)).toEqual(new Date(left.getTime() + PLANS.MONTHLY.periodDays! * day));
    expect(planUntilAfterPurchase({ plan: "WEEKLY", planUntil: left }, "MONTHLY", now)).toEqual(new Date(now.getTime() + 30 * day));
    expect(planUntilAfterPurchase({ plan: "MONTHLY", planUntil: new Date(now.getTime() - day) }, "MONTHLY", now)).toEqual(new Date(now.getTime() + 30 * day));
    expect(planUntilAfterPurchase({ plan: "FREE", planUntil: null }, "QUARTERLY", now)).toEqual(new Date(now.getTime() + 90 * day));
  });
});
