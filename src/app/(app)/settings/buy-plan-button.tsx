"use client";

import { useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { buyPlan } from "./actions";

/** Buy (Phase 4): starts a Razorpay payment and sends the student to Razorpay's page to pay. */
export function BuyPlanButton({ plan, name }: { plan: "WEEKLY" | "MONTHLY" | "QUARTERLY"; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      aria-disabled={pending || undefined}
      aria-label={`Buy the ${name} plan`}
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          const result = await buyPlan({ plan });
          if (!result.ok) return toast(result.error);
          window.location.assign(result.data.url);
        });
      }}
    >
      {pending ? "Opening Razorpay…" : "Buy"}
    </Button>
  );
}
