import "server-only";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { prisma, systemPrisma } from "@/lib/prisma";

import { planPrices, planUntilAfterPurchase, razorpayReady, type PaidPlanId } from "./billing";
import { PLANS } from "./plans";

// Phase 4: the server side of buying a plan. A Payment row is made first; its id is the Payment
// Link's reference, so the signed return and the webhook both find it. Confirming is safe to run
// twice (return and webhook): a payment is marked paid, and its plan set, once.

const RAZORPAY_API = "https://api.razorpay.com/v1";

export class BillingError extends Error {
  override name = "BillingError";
}

/**
 * Starts buying `plan` for the current student: records the payment and asks Razorpay for a
 * Payment Link that comes back to `/api/billing/callback` on `origin`. Returns the page to pay on.
 */
export async function startCheckout(plan: PaidPlanId, origin: string, fetcher: typeof fetch = fetch): Promise<{ url: string }> {
  const price = planPrices(env)[plan];
  if (!razorpayReady(env) || price === null) throw new BillingError("Paying online isn't open yet.");
  const amountPaise = price * 100;
  const payment = await prisma.payment.create({ data: { plan, amountPaise }, select: { id: true } });

  let response: Response;
  try {
    response = await fetcher(`${RAZORPAY_API}/payment_links`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}` },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        accept_partial: false,
        reference_id: payment.id,
        description: `Pathfinder ${PLANS[plan].name} plan`,
        // Razorpay doesn't message the student: Pathfinder shows what happened.
        notify: { sms: false, email: false },
        callback_url: `${origin}/api/billing/callback`,
        callback_method: "get",
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    logServerError("razorpay payment link", error);
    throw new BillingError("Couldn't reach Razorpay just now. Try again in a minute.");
  }
  const link = (await response.json().catch(() => null)) as { id?: string; short_url?: string } | null;
  if (!response.ok || !link?.id || !link.short_url) {
    logServerError("razorpay payment link", new Error(`Razorpay answered ${response.status}`));
    throw new BillingError("Razorpay couldn't start the payment just now. Try again in a minute.");
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { linkId: link.id } });
  return { url: link.short_url };
}

export type Confirmed = { kind: "paid"; plan: PaidPlanId; until: Date } | { kind: "already" } | { kind: "unknown" } | { kind: "mismatch" };

/**
 * Marks a payment paid and sets its student's plan, from Razorpay's signed return or webhook (the
 * signature is checked before this). `amountPaise`, when Razorpay gives it, must be what was asked.
 * Runs outside any student's scope: a webhook has no session.
 */
export async function confirmPayment({ referenceId, linkId, paymentId, amountPaise }: { referenceId: string; linkId: string; paymentId: string; amountPaise?: number }, now = new Date()): Promise<Confirmed> {
  return systemPrisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: referenceId } });
    if (!payment || payment.linkId !== linkId) return { kind: "unknown" } as const;
    if (payment.status === "PAID") return { kind: "already" } as const;
    if (amountPaise !== undefined && amountPaise !== payment.amountPaise) return { kind: "mismatch" } as const;
    // Only the first of the return and the webhook gets here: the update below is conditional.
    const { count } = await tx.payment.updateMany({ where: { id: payment.id, status: { not: "PAID" } }, data: { status: "PAID", paymentId, paidAt: now } });
    if (count === 0) return { kind: "already" } as const;
    const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId }, select: { plan: true, planUntil: true } });
    const plan = payment.plan as PaidPlanId;
    const until = planUntilAfterPurchase(user, plan, now);
    await tx.user.update({ where: { id: payment.userId }, data: { plan, planUntil: until } });
    return { kind: "paid", plan, until } as const;
  });
}

/** Whether this payment belongs to the student: the signed return may only confirm one's own. */
export async function ownsPayment(referenceId: string): Promise<boolean> {
  return (await prisma.payment.count({ where: { id: referenceId } })) > 0;
}
