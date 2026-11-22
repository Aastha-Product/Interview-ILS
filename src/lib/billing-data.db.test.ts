import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const settings = vi.hoisted(() => ({ env: { RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret", PATHFINDER_PRICE_MONTHLY: 499 } as Record<string, unknown> }));
vi.mock("@/lib/env", () => ({
  get env() {
    return settings.env;
  },
}));
vi.spyOn(console, "error").mockImplementation(() => {});

const { BillingError, confirmPayment, ownsPayment, startCheckout } = await import("./billing-data");

const raw = () => rawClientOf(db.client!);
const now = new Date("2026-11-22T10:00:00Z");
const day = 24 * 3600_000;

/** Razorpay, as the test wants it to answer. */
function razorpay(answer: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body ?? { id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

beforeEach(async () => {
  await resetDatabase(db.client!);
  settings.env = { RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "secret", PATHFINDER_PRICE_MONTHLY: 499 };
});
afterAll(() => db.client!.$disconnect());

describe("buying a plan (Phase 4)", () => {
  it("records the payment, asks Razorpay for a Payment Link back to the callback, and gives its page", async () => {
    const { fetcher, calls } = razorpay();
    expect(await startCheckout("MONTHLY", "https://pathfinderedtech.com", fetcher)).toEqual({ url: "https://rzp.io/i/abc" });
    const [payment] = await raw().payment.findMany();
    expect(payment).toMatchObject({ userId: TEST_USER_ID, plan: "MONTHLY", amountPaise: 49900, status: "CREATED", linkId: "plink_1" });
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/payment_links");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("rzp_test_abc:secret").toString("base64")}`);
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      amount: 49900,
      currency: "INR",
      reference_id: payment.id,
      callback_url: "https://pathfinderedtech.com/api/billing/callback",
      callback_method: "get",
      notify: { sms: false, email: false },
    });
    expect(await ownsPayment(payment.id)).toBe(true);
    expect(await runAsUser("other-student", () => ownsPayment(payment.id))).toBe(false);
  });

  it("refuses a plan without a price, without Razorpay keys, or when Razorpay says no", async () => {
    await expect(startCheckout("WEEKLY", "https://x.test", razorpay().fetcher)).rejects.toBeInstanceOf(BillingError);
    settings.env = { PATHFINDER_PRICE_MONTHLY: 499 };
    await expect(startCheckout("MONTHLY", "https://x.test", razorpay().fetcher)).rejects.toThrow("Paying online isn't open yet.");
    settings.env = { RAZORPAY_KEY_ID: "rzp", RAZORPAY_KEY_SECRET: "secret", PATHFINDER_PRICE_MONTHLY: 499 };
    await expect(startCheckout("MONTHLY", "https://x.test", razorpay({ status: 400, body: { error: { description: "bad" } } }).fetcher)).rejects.toThrow("Razorpay couldn't start the payment");
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(startCheckout("MONTHLY", "https://x.test", failing)).rejects.toThrow("Couldn't reach Razorpay");
  });

  it("sets the plan once a payment is confirmed, once only, and never for the wrong link or amount", async () => {
    const payment = await db.client!.payment.create({ data: { plan: "MONTHLY", amountPaise: 49900, linkId: "plink_1" } });
    const confirm = { referenceId: payment.id, linkId: "plink_1", paymentId: "pay_1" };

    expect(await confirmPayment({ ...confirm, linkId: "plink_other" }, now)).toEqual({ kind: "unknown" });
    expect(await confirmPayment({ ...confirm, amountPaise: 100 }, now)).toEqual({ kind: "mismatch" });
    expect(await confirmPayment({ ...confirm, amountPaise: 49900 }, now)).toEqual({ kind: "paid", plan: "MONTHLY", until: new Date(now.getTime() + 30 * day) });
    expect(await raw().user.findUniqueOrThrow({ where: { id: TEST_USER_ID } })).toMatchObject({ plan: "MONTHLY", planUntil: new Date(now.getTime() + 30 * day) });
    expect(await raw().payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PAID", paymentId: "pay_1", paidAt: now });

    // The return and the webhook both arrive: the second changes nothing.
    expect(await confirmPayment(confirm, new Date(now.getTime() + 60_000))).toEqual({ kind: "already" });
    expect((await raw().user.findUniqueOrThrow({ where: { id: TEST_USER_ID } })).planUntil).toEqual(new Date(now.getTime() + 30 * day));
    expect(await confirmPayment({ ...confirm, referenceId: "missing" }, now)).toEqual({ kind: "unknown" });
  });

  it("adds a renewal of the same plan to the time left", async () => {
    await raw().user.update({ where: { id: TEST_USER_ID }, data: { plan: "MONTHLY", planUntil: new Date(now.getTime() + 10 * day) } });
    const payment = await db.client!.payment.create({ data: { plan: "MONTHLY", amountPaise: 49900, linkId: "plink_2" } });
    expect(await confirmPayment({ referenceId: payment.id, linkId: "plink_2", paymentId: "pay_2" }, now)).toEqual({ kind: "paid", plan: "MONTHLY", until: new Date(now.getTime() + 40 * day) });
  });
});
