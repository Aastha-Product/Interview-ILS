import { NextResponse } from "next/server";

import { paidWebhook, webhookSignatureValid } from "@/lib/billing";
import { confirmPayment } from "@/lib/billing-data";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";

/**
 * Razorpay's webhook (Phase 4): set on Razorpay's dashboard for payment_link.paid, with
 * RAZORPAY_WEBHOOK_SECRET. It's called by Razorpay, not a browser, so it has no session: the
 * signature on the raw body proves it. Answers 200 for anything it doesn't act on, so Razorpay
 * doesn't keep retrying; 404 while no webhook secret is set.
 */
export async function POST(request: Request): Promise<Response> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.text();
  if (body.length > 100_000 || !webhookSignatureValid(body, request.headers.get("x-razorpay-signature"), env.RAZORPAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const paid = paidWebhook(parsed);
  if (!paid) return NextResponse.json({ ok: true });
  try {
    const confirmed = await confirmPayment(paid);
    if (confirmed.kind === "mismatch") logServerError("billing webhook", new Error(`Amount paid doesn't match payment ${paid.referenceId}`));
    return NextResponse.json({ ok: true, outcome: confirmed.kind });
  } catch (error) {
    logServerError("billing webhook", error);
    // A 500 makes Razorpay try again later.
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }
}
