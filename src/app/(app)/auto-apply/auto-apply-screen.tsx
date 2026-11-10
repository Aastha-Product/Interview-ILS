"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import type { ApplyState } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action";
import type { ApplyTaskView, AutoApplyScreenView } from "@/lib/apply/view";
import { TIER_LABELS } from "@/lib/match/tiers";

import { findMatchesNow, prepareApplicationAgain, skipApplication, switchAutoApply } from "./actions";

/** Each state as the student reads it, and which group it shows in. */
export const STATE_LABELS: Record<ApplyState, string> = {
  PREPARING: "Preparing",
  READY: "Ready to apply",
  LEASED: "Applying now",
  SUBMITTING: "Applying now",
  APPLIED: "Applied",
  NEEDS_STUDENT: "Needs you",
  UNCERTAIN: "Check this one",
  FAILED: "Couldn't apply",
  SKIPPED: "Skipped",
};

const SKIPPABLE: readonly ApplyState[] = ["PREPARING", "READY", "NEEDS_STUDENT", "FAILED"];
const RETRYABLE: readonly ApplyState[] = ["NEEDS_STUDENT", "FAILED"];

function Count({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line px-4 py-3">
      <span className="text-[26px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="text-meta">{label}</span>
      {note ? <span className="text-meta text-muted">{note}</span> : null}
    </div>
  );
}

function TaskRow({ task, onSkip, onRetry, busy }: { task: ApplyTaskView; onSkip: (id: string) => void; onRetry: (id: string) => void; busy: boolean }) {
  const needsYou = task.state === "NEEDS_STUDENT" || task.state === "UNCERTAIN";
  return (
    <li className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{task.title}</span>
        <span className="text-meta text-muted">
          {[task.company, task.location, task.tier ? `${TIER_LABELS[task.tier]}${task.score !== null ? ` · ${task.score}` : ""}` : null].filter(Boolean).join(" · ")}
        </span>
        {task.reason ? <span className={needsYou ? "text-meta text-warning" : "text-meta text-muted"}>{task.reason}</span> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className={needsYou ? "rounded-full bg-warning-surface px-2.5 py-0.5 text-meta text-warning" : "rounded-full bg-surface px-2.5 py-0.5 text-meta"}>
          {STATE_LABELS[task.state]}
        </span>
        {task.applicationId ? (
          <Link href={`/applications/${task.applicationId}`} className={buttonClassName("secondary", "sm")}>
            Documents
          </Link>
        ) : null}
        {task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer" className={buttonClassName("text", "sm")}>
            Job
          </a>
        ) : null}
        {RETRYABLE.includes(task.state) ? (
          <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onRetry(task.id)}>
            Try again
          </Button>
        ) : null}
        {SKIPPABLE.includes(task.state) ? (
          <Button variant="text" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onSkip(task.id)}>
            Skip
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Auto-apply (step 4): whether it's on, what it found, and every application it prepared. */
export function AutoApplyScreen({ view }: { view: AutoApplyScreenView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { settings, summary, tasks } = view;
  const ready = settings.consented && settings.preferences !== null;

  const act = (work: () => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      if (toastResult(await work()).ok) router.refresh();
    });

  const strong = summary.matches.STRONG + summary.matches.GOOD;
  const waiting = summary.tasks.NEEDS_STUDENT + summary.tasks.UNCERTAIN;
  const inProgress = summary.tasks.PREPARING + summary.tasks.READY + summary.tasks.LEASED + summary.tasks.SUBMITTING;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Auto-apply"
        description="Pathfinder finds jobs that fit your profile, tailors your resume for each, and applies from your own browser within the limits you set."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/auto-apply/setup" className={buttonClassName("secondary")}>
              Set up job search
            </Link>
            {settings.preferences ? (
              <Button aria-disabled={pending || undefined} onClick={() => !pending && act(() => findMatchesNow({}))}>
                Find matches now
              </Button>
            ) : null}
          </div>
        }
      />

      <Card padding="none" className="flex flex-col gap-3 px-7 py-4">
        {ready ? (
          <Toggle
            label="Apply for me"
            description={
              settings.enabled
                ? settings.dryRun
                  ? `On, as a dry run: forms are filled but not submitted. Up to ${settings.dailyLimit} a day.`
                  : `On: up to ${settings.dailyLimit} applications a day, ${settings.minTier === "STRONG" ? "strong matches only" : "strong and good matches"}.`
                : "Off. Nothing new is prepared or submitted."
            }
            checked={settings.enabled}
            onCheckedChange={(enabled) => !pending && act(() => switchAutoApply({ enabled }))}
          />
        ) : (
          <p className="text-meta">
            {settings.consentOutdated ? "How auto-apply works has changed: read it and agree again in " : "To start, set up your job search and agree to how auto-apply works in "}
            <Link href="/auto-apply/setup" className="font-medium underline underline-offset-2">
              Set up job search
            </Link>
            .
          </p>
        )}
        <p className="text-meta text-muted">
          Applications are submitted by the Pathfinder extension in your Chrome, so it needs to be installed and Chrome open. Coming next.
        </p>
      </Card>

      <section aria-label="Progress" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Open jobs found" value={view.openJobs} note="From companies' job boards, every 6 hours" />
        <Count label="Strong and good matches" value={strong} note={`${summary.matches.PARTIAL} partial, ${summary.matches.NOT_RECOMMENDED} not recommended`} />
        <Count label="Applied" value={summary.tasks.APPLIED} note={`${inProgress} on the way`} />
        <Count label="Need you" value={waiting} note={summary.tasks.FAILED ? `${summary.tasks.FAILED} couldn't be applied for` : undefined} />
      </section>

      <Card padding="none" className="px-7 py-[22px]">
        <h2 className="text-field font-medium">Applications</h2>
        {tasks.length === 0 ? (
          <p className="pt-3 text-meta text-muted">
            {settings.enabled ? "None yet. They appear here as soon as good matches are found." : "None yet. Switch auto-apply on and they'll appear here."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={pending}
                onSkip={(taskId) => act(() => skipApplication({ taskId }))}
                onRetry={(taskId) => act(() => prepareApplicationAgain({ taskId }))}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
