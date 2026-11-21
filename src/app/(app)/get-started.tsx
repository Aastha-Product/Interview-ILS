"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { nextOnboardingStep, type OnboardingStep } from "@/lib/onboarding";

import { hideOnboarding } from "./actions";

/**
 * The Get started guide (Phase 1): the steps a new student goes through, in order, each ticked
 * when the app sees it done, with Continue for the next one. "Hide this" puts it away for good.
 */
export function GetStarted({ steps }: { steps: OnboardingStep[] }) {
  const [hidden, setHidden] = useState(false);
  const next = nextOnboardingStep(steps);
  if (hidden || !next) return null;
  const done = steps.filter((step) => step.done).length;

  return (
    <section aria-labelledby="get-started-title" className="mb-6 flex max-w-[1200px] flex-col gap-5 rounded-card border border-line-card bg-card p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="get-started-title" className="font-serif text-section">
            Get started
          </h2>
          <p className="text-sm text-muted">
            {done} of {steps.length} done. Each step takes a minute or two, and you can come back to any of them later.
          </p>
        </div>
        <Button
          type="button"
          variant="text"
          size="sm"
          onClick={async () => {
            if (toastResult(await hideOnboarding({})).ok) setHidden(true);
          }}
        >
          Hide this
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => {
          const current = step.id === next.id;
          return (
            <li key={step.id} aria-current={current ? "step" : undefined} className={cn("flex items-start gap-3 rounded-card px-3 py-2", current && "bg-surface")}>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-meta font-medium",
                  step.done ? "border-primary bg-primary text-on-primary" : "border-line-strong text-muted",
                )}
              >
                {step.done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("font-medium", step.done && "text-muted line-through")}>
                  {step.done ? `${step.title} (done)` : step.title}
                </span>
                {step.done ? null : <span className="text-meta text-muted">{step.description}</span>}
                {step.done || current ? null : (
                  <Link href={step.href} className="text-meta font-medium underline underline-offset-2">
                    Do this now
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <Link href={next.href} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
          Continue: {next.title}
        </Link>
      </div>
    </section>
  );
}
