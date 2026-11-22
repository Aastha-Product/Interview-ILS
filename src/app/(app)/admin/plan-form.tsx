"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

import { setStudentPlan } from "./actions";

const until = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * One student's plan (Phase 4): choose a plan and how long it lasts, its own period by default.
 * Until checkout exists, this is how a student is upgraded.
 */
export function PlanForm({ userId, email, plan, planUntil }: { userId: string; email: string; plan: PlanId; planUntil: Date | null }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<PlanId>(plan);
  const [days, setDays] = useState(String(PLANS[plan].periodDays ?? ""));
  const [pending, startTransition] = useTransition();
  const parsed = days.trim() === "" ? null : Number(days);
  const valid = chosen === "FREE" || parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 366);

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        startTransition(async () => {
          const result = await setStudentPlan({ userId, plan: chosen, days: chosen === "FREE" ? null : parsed });
          if (!result.ok) return toast(result.error);
          if (result.toast) toast(result.toast);
          router.refresh();
        });
      }}
    >
      <select
        aria-label={`Plan for ${email}`}
        value={chosen}
        onChange={(event) => {
          const next = event.target.value as PlanId;
          setChosen(next);
          setDays(String(PLANS[next].periodDays ?? ""));
        }}
        className="h-8 rounded-control border border-line bg-card px-2 text-sm"
      >
        {PLAN_IDS.map((id) => (
          <option key={id} value={id}>
            {PLANS[id].name}
          </option>
        ))}
      </select>
      {chosen !== "FREE" ? (
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={366}
          value={days}
          placeholder="No end"
          aria-label={`Days of the plan for ${email}`}
          aria-invalid={!valid}
          onChange={(event) => setDays(event.target.value)}
          className="h-8 w-20 rounded-control border border-line bg-card px-2 text-sm tabular-nums aria-invalid:border-danger"
        />
      ) : null}
      <Button type="submit" variant="secondary" size="sm" disabled={pending || !valid}>
        Set
      </Button>
      {plan !== "FREE" ? <span className="text-meta text-muted">{planUntil ? `until ${until.format(planUntil)}` : "no end date"}</span> : null}
    </form>
  );
}
