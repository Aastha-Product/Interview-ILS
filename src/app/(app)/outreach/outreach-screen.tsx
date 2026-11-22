import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { STAGE_LABELS, type OutreachStage } from "@/lib/outreach";
import type { OutreachRow } from "@/lib/outreach-data";

const TONE: Record<OutreachStage, string> = {
  none: "text-muted",
  draft: "text-ink",
  sent: "text-muted",
  "follow-up-due": "font-medium text-ink",
  "followed-up": "text-muted",
  replied: "font-medium text-ink",
};

const ACTION: Record<OutreachStage, string> = {
  none: "Write to the recruiter",
  draft: "Finish and send",
  sent: "Open",
  "follow-up-due": "Follow up",
  "followed-up": "Open",
  replied: "Open",
};

/**
 * Recruiter outreach (Phase 3): each open application with where its email to the recruiter
 * stands. The emails go out from the student's own Gmail, one at a time, when they send them.
 */
export function OutreachScreen({ rows }: { rows: OutreachRow[] }) {
  return (
    <>
      <PageHeader
        title="Recruiter outreach"
        description="After you apply, a short email to the recruiter gets your application read. The AI drafts it from your profile and the job; you check it and send it from your own Gmail. Replies show up here and in Inbox."
      />
      <div className="flex max-w-[960px] flex-col gap-6 px-4 pb-20 sm:px-10">
        {rows.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Nothing to follow up yet. Once an application is sent, it shows up here so you can write to its recruiter.{" "}
              <Link href="/applications" className="font-medium underline underline-offset-2">
                Applications
              </Link>
            </p>
          </Card>
        ) : (
          <ul aria-label="Applications to write to recruiters about" className="flex flex-col divide-y divide-line rounded-card border border-line-card bg-card">
            {rows.map((row) => (
              <li key={row.applicationId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium [overflow-wrap:anywhere]">{row.role || "Untitled role"}</span>
                  <span className="text-meta text-muted [overflow-wrap:anywhere]">
                    {row.company || "Unknown company"}
                    {row.contact ? ` · ${row.contact}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-sm ${TONE[row.stage]}`}>{STAGE_LABELS[row.stage]}</span>
                  <Link href={`/outreach/${row.applicationId}`} className="text-sm font-medium underline underline-offset-2">
                    {ACTION[row.stage]}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
