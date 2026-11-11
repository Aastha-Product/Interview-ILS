"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { ApplyState } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action";
import { ANSWER_NAMES } from "@/lib/apply/answers";
import type { TaskQuestion } from "@/lib/apply/questions";
import type { ApplyTaskView, AutoApplyScreenView, BrowsersView } from "@/lib/apply/view";
import { TIER_LABELS } from "@/lib/match/tiers";

import { answerApplicationQuestions, findMatchesNow, markApplied, prepareApplicationAgain, skipApplication, switchAutoApply } from "./actions";

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

const SKIPPABLE: readonly ApplyState[] = ["PREPARING", "READY", "NEEDS_STUDENT", "FAILED", "UNCERTAIN"];
const RETRYABLE: readonly ApplyState[] = ["NEEDS_STUDENT", "FAILED"];
/** After a dry run they submitted themselves, or an uncertain one they checked. */
const MARKABLE: readonly ApplyState[] = ["NEEDS_STUDENT", "UNCERTAIN"];

function Count({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line px-4 py-3">
      <span className="text-[26px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="text-meta">{label}</span>
      {note ? <span className="text-meta text-muted">{note}</span> : null}
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Whether a browser will submit: none connected, none seen for a day, or all well. */
function BrowserNote({ browsers, enabled, ready }: { browsers: BrowsersView; enabled: boolean; ready: number }) {
  const link = (text: string) => (
    <Link href="/auto-apply/extension" className="font-medium underline underline-offset-2">
      {text}
    </Link>
  );
  if (browsers.connected === 0)
    return (
      <p role={enabled ? "alert" : undefined} className={enabled ? "text-meta text-warning" : "text-meta text-muted"}>
        No browser is connected, so nothing can be submitted. Applications are submitted by the Pathfinder extension in your Chrome. {link("Connect the extension")}
      </p>
    );
  if (browsers.quiet && enabled)
    return (
      <p role="alert" className="text-meta text-warning">
        {browsers.lastSeen ? `Chrome hasn't been open with the extension since ${day(browsers.lastSeen)}` : "The extension hasn't checked in yet"}
        {ready > 0 ? `, and ${ready} ${ready === 1 ? "application is" : "applications are"} waiting` : ""}. Applications are submitted only while Chrome is open. {link("Your browsers")}
      </p>
    );
  return (
    <p className="text-meta text-muted">
      Submitted by the Pathfinder extension in your Chrome: {browsers.connected === 1 ? "1 browser" : `${browsers.connected} browsers`} connected{browsers.lastSeen ? `, last seen ${day(browsers.lastSeen)}` : ""}. {link("Your browsers")}
    </p>
  );
}

type Given = Record<string, string | string[]>;
type RowActions = { onSkip: (id: string) => void; onRetry: (id: string) => void; onMarkApplied: (id: string) => void; onAnswer: (id: string, answers: Given) => void };

/**
 * The questions an application is waiting on, to answer here rather than in the job site's tab.
 * The answers are kept for later forms that ask the same thing. The questions are the job site's
 * own words, shown as plain text.
 */
function QuestionsForm({ task, busy, onAnswer }: { task: ApplyTaskView; busy: boolean; onAnswer: RowActions["onAnswer"] }) {
  const [given, setGiven] = useState<Given>({});
  const here = task.questions.filter((question) => question.here);
  const elsewhere = task.questions.filter((question) => !question.here);
  if (task.questions.length === 0) return null;
  const set = (key: string, value: string | string[]) => setGiven((current) => ({ ...current, [key]: value }));
  const answered = here.some((question) => (Array.isArray(given[question.key]) ? given[question.key].length > 0 : Boolean((given[question.key] as string | undefined)?.trim())));
  const control = (question: TaskQuestion) => {
    if (question.type === "single") {
      return (
        <Select key={question.key} label={question.label} value={(given[question.key] as string | undefined) ?? ""} onChange={(event) => set(question.key, event.target.value)}>
          <option value="">Choose…</option>
          {question.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    }
    if (question.type === "multi") {
      const chosen = (given[question.key] as string[] | undefined) ?? [];
      return (
        <fieldset key={question.key} className="flex flex-col gap-2">
          <legend className="mb-1 text-label font-medium text-ink">{question.label}</legend>
          {question.options.map((option) => (
            <Checkbox
              key={option}
              label={option}
              checked={chosen.includes(option)}
              onChange={(event) => set(question.key, event.target.checked ? [...chosen, option] : chosen.filter((entry) => entry !== option))}
            />
          ))}
        </fieldset>
      );
    }
    return question.type === "textarea" ? (
      <Textarea key={question.key} label={question.label} rows={3} maxLength={2000} value={(given[question.key] as string | undefined) ?? ""} onChange={(event) => set(question.key, event.target.value)} />
    ) : (
      <Input key={question.key} label={question.label} maxLength={2000} value={(given[question.key] as string | undefined) ?? ""} onChange={(event) => set(question.key, event.target.value)} />
    );
  };
  return (
    <form
      aria-label={`Questions for ${task.title}`}
      className="mt-2 flex flex-col gap-4 rounded-card border border-line-card bg-surface px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && answered) onAnswer(task.id, given);
      }}
    >
      {here.length > 0 ? (
        <>
          <p className="text-meta text-muted">Answer here and Pathfinder fills them in for you. Your answers are kept for other forms that ask the same thing.</p>
          {here.map(control)}
          <div>
            <Button type="submit" size="sm" aria-disabled={busy || !answered || undefined}>
              Save and try again
            </Button>
          </div>
        </>
      ) : null}
      {elsewhere.length > 0 ? (
        <p className="text-meta text-muted">
          Only you can do {elsewhere.length === 1 ? "this one" : "these"} on the job site itself: {elsewhere.map((question) => question.label).join("; ")}.
        </p>
      ) : null}
    </form>
  );
}

function TaskRow({ task, onSkip, onRetry, onMarkApplied, onAnswer, busy }: { task: ApplyTaskView; busy: boolean } & RowActions) {
  const needsYou = task.state === "NEEDS_STUDENT" || task.state === "UNCERTAIN";
  return (
    <li className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{task.title}</span>
        <span className="text-meta text-muted">
          {[task.company, task.location, task.tier ? `${TIER_LABELS[task.tier]}${task.score !== null ? ` · ${task.score}` : ""}` : null].filter(Boolean).join(" · ")}
        </span>
        {task.reason ? <span className={needsYou ? "text-meta text-warning" : "text-meta text-muted"}>{task.reason}</span> : null}
        {task.confirmation ? (
          <span className="text-meta text-muted">{task.confirmation.by === "board" ? `Confirmed by the job site: “${task.confirmation.text}”` : "You marked it as applied."}</span>
        ) : null}
        <QuestionsForm task={task} busy={busy} onAnswer={onAnswer} />
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
        {MARKABLE.includes(task.state) ? (
          <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onMarkApplied(task.id)}>
            Mark as applied
          </Button>
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
  const set = settings.consented && settings.preferences !== null;
  // Every starred answer in Set up job search is required before anything is applied for.
  const ready = set && settings.missing.length === 0;

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
          <p className="text-meta" role={set ? "alert" : undefined}>
            {set
              ? `Auto-apply is waiting for ${settings.missing.length === 1 ? "one required answer" : `${settings.missing.length} required answers`} (${[...new Set(settings.missing.map((key) => ANSWER_NAMES[key]))].join(", ")}). Nothing is prepared or submitted until you give ${settings.missing.length === 1 ? "it" : "them"} in `
              : settings.consentOutdated
                ? "How auto-apply works has changed: read it and agree again in "
                : "To start, set up your job search and agree to how auto-apply works in "}
            <Link href="/auto-apply/setup" className="font-medium underline underline-offset-2">
              Set up job search
            </Link>
            .
          </p>
        )}
        <BrowserNote browsers={view.browsers} enabled={settings.enabled} ready={summary.tasks.READY} />
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
                onMarkApplied={(taskId) => act(() => markApplied({ taskId }))}
                onAnswer={(taskId, answers) => act(() => answerApplicationQuestions({ taskId, answers }))}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
