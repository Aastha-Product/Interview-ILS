import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { callbackParams, callbackSignatureValid } from "@/lib/billing";
import { confirmPayment, ownsPayment } from "@/lib/billing-data";
import { env } from "@/lib/env";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/**
 * Where Razorpay sends the student back after paying (Phase 4). It comes from Razorpay's site, so
 * route()'s same-origin check can't apply: Razorpay's signature proves the payment, the session
 * that it's the student who started it. The webhook confirms it too, should they not come back.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  const back = (outcome: "paid" | "pending" | "failed") => {
    const url = new URL("/settings?section=plan", origin);
    url.searchParams.set("billing", outcome);
    const response = NextResponse.redirect(url);
    response.headers.set("cache-control", "private, no-store");
    return response;
  };

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));
  const params = callbackParams(request.nextUrl.searchParams);
  if (!params || !env.RAZORPAY_KEY_SECRET || !callbackSignatureValid(params, env.RAZORPAY_KEY_SECRET)) return back("failed");
  if (params.razorpay_payment_link_status !== "paid") return back(params.razorpay_payment_link_status === "cancelled" || params.razorpay_payment_link_status === "expired" ? "failed" : "pending");
  // Only the student's own payment.
  if (!(await ownsPayment(params.razorpay_payment_link_reference_id))) return back("failed");

  try {
    const confirmed = await confirmPayment({
      referenceId: params.razorpay_payment_link_reference_id,
      linkId: params.razorpay_payment_link_id,
      paymentId: params.razorpay_payment_id,
    });
    return back(confirmed.kind === "paid" || confirmed.kind === "already" ? "paid" : "failed");
  } catch (error) {
    logServerError("billing callback", error);
    // The webhook may still confirm it.
    return back("pending");
  }
}
