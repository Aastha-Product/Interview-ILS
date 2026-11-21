import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import type { RunLogView } from "@/lib/run-log-data";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const link = (href: string, text: string) => (
  <Link href={href} className="font-medium underline underline-offset-2">
    {text}
  </Link>
);

/**
 * Runs & schedule (Phase 3): when the job agent and auto-apply last ran, what each did, and when
 * they run next. Read from what each already keeps; nothing can be started or changed here.
 */
export function RunsScreen({ view, timeZone }: { view: RunLogView; timeZone: string }) {
  const { agent, autoApply } = view;
  return (
    <>
      <PageHeader title="Runs & schedule" description={`What runs for you in the background, what it did lately, and when it runs next. Times are in ${timeZone}.`} />
      <div className="flex max-w-[960px] flex-col gap-6 px-4 pb-20 sm:px-10">
        <section aria-labelledby="runs-auto-apply">
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 id="runs-auto-apply" className="font-serif text-section">
                Auto-apply
              </h2>
              <p className="text-meta text-muted">
                {autoApply.enabled
                  ? "On. It looks for new matches once a day and prepares applications every half hour, within your limits. The extension submits them while Chrome is open."
                  : "Off. Nothing is matched, prepared or submitted until you switch it on."}{" "}
                {link("/auto-apply", "Auto-apply")}
              </p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Last looked for matches">{autoApply.lastMatch ?? "Not yet"}</Fact>
              <Fact label="Next look">{autoApply.nextMatch ?? "Off"}</Fact>
            </dl>
            <div className="flex flex-col gap-2">
              <h3 className="text-field font-medium">The last 7 days</h3>
              <ol aria-label="Auto-apply by day" className="flex flex-col divide-y divide-line rounded-card border border-line-card">
                {autoApply.days.map((day) => (
                  <li key={day.day} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                    <span className="font-medium">{day.label}</span>
                    <span className={day.summary ? "text-sm" : "text-sm text-muted"}>{day.summary ?? "Nothing new"}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </section>

        {agent ? (
          <section aria-labelledby="runs-agent">
            <Card className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h2 id="runs-agent" className="font-serif text-section">
                  Job agent
                </h2>
                <p className="text-meta text-muted">
                  {agent.enabled
                    ? "On. Once a day it runs your searches, scores the new postings and keeps the ones worth applying to. You can run it a couple more times a day from the Agent screen."
                    : "Off. Nothing is searched or scored until you turn it on."}{" "}
                  {link(agent.enabled ? "/agent" : "/settings?section=agent", agent.enabled ? "Agent" : "Settings → Job agent")}
                </p>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact label="Next run">{agent.nextRun ?? "Off"}</Fact>
                <Fact label="Runs kept">{agent.runs.length === 0 ? "None yet" : `The last ${agent.runs.length}`}</Fact>
              </dl>
              {agent.runs.length > 0 ? (
                <ol aria-label="Job agent runs" className="flex flex-col divide-y divide-line rounded-card border border-line-card">
                  {agent.runs.map((run) => (
                    <li key={run.at} className="flex flex-col gap-0.5 px-4 py-2.5">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{run.at}</span>
                        <span className="text-meta text-muted">{run.manual ? "Run now" : "Scheduled"}</span>
                      </span>
                      <span className="text-sm text-muted">{run.message ?? "Still running, or stopped before it finished."}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
