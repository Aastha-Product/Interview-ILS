import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { loadAiConfig } from "@/lib/ai/config";
import { isAdmin, requireAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth/session";
import { loadAdminOverview, STUDENT_LIMIT, type AiTotals } from "@/lib/admin-data";

import { AllowanceForm } from "./allowance-form";

/** "Admin" for admins only: for anyone else the tab says nothing about the console. */
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  return session && (await isAdmin(session.userId)) ? { title: "Admin" } : {};
}

const count = new Intl.NumberFormat("en-IN");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * The admin console (Pathfinder): students, analyses, AI use and what it costs, and each student's
 * free allowance. For the people in PATHFINDER_ADMIN_EMAILS only; anyone else gets "not found".
 * It shows counts, never a resume or an analysis.
 */
export default async function AdminPage() {
  await requireAdmin();
  const [overview, ai] = await Promise.all([loadAdminOverview(), loadAiConfig()]);
  const { students, analyses } = overview;

  return (
    <>
      <PageHeader
        title="Admin"
        description="How Pathfinder is being used, what the AI costs, and each student's free allowance. Resumes and analyses stay private: only counts are shown here."
      />
      <div className="flex max-w-[1100px] flex-col gap-10 px-4 pb-20 sm:px-10">
        <section aria-labelledby="admin-numbers" className="flex flex-col gap-3">
          <h2 id="admin-numbers" className="font-serif text-section">
            At a glance
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Students" value={count.format(students.total)} detail={`${count.format(students.new7d)} new this week · ${count.format(students.newToday)} today`} />
            <Stat label="Used AI today" value={count.format(students.activeToday)} detail="students, India time" />
            <Stat label="Analyses" value={count.format(analyses.total)} detail={`${count.format(analyses.last7d)} this week · ${count.format(analyses.today)} today`} />
            <Stat label="AI cost, 30 days" value={money.format(overview.ai.last30d.costUsd)} detail={`${money.format(overview.ai.today.costUsd)} in the last 24 hours`} />
          </div>
        </section>

        <section aria-labelledby="admin-ai" className="flex flex-col gap-3">
          <h2 id="admin-ai" className="font-serif text-section">
            AI use
          </h2>
          <p className="text-sm text-muted">
            The server&apos;s AI: <span className="font-medium text-ink">{ai.model ?? "not set"}</span>
            {ai.sharedKey ? "" : " (no shared key: students can't run analyses)"}. Every call on the shared key is logged with its tokens; the cost comes from
            the model&apos;s list price.
          </p>
          <Table
            caption="AI calls by period"
            head={["Period", "Calls", "Failed", "Tokens in", "Tokens out", "Cost"]}
            rows={[
              ["Last 24 hours", overview.ai.today],
              ["Last 7 days", overview.ai.last7d],
              ["Last 30 days", overview.ai.last30d],
            ].map(([label, totals]) => [label as string, ...totalsCells(totals as AiTotals)])}
          />
          {overview.ai.byModel.length > 0 && (
            <Table
              caption="AI calls by model, last 30 days"
              head={["Model", "Calls", "Failed", "Tokens in", "Tokens out", "Cost"]}
              rows={overview.ai.byModel.map((row) => [<code key="model">{row.model}</code>, ...totalsCells(row)])}
            />
          )}
          {overview.ai.last30d.unpriced > 0 && (
            <p className="text-meta text-muted">
              {count.format(overview.ai.last30d.unpriced)} calls in the last 30 days used a model without a known price, so they aren&apos;t in the cost. Check
              its price in the provider&apos;s console.
            </p>
          )}
        </section>

        <section aria-labelledby="admin-students" className="flex flex-col gap-3">
          <h2 id="admin-students" className="font-serif text-section">
            Students
          </h2>
          <p className="text-sm text-muted">
            The default is{" "}
            <span className="font-medium text-ink">
              {overview.defaultAllowance === null ? "no limit" : `${overview.defaultAllowance} free analyses a day`}
            </span>{" "}
            (PATHFINDER_AI_DAILY_LIMIT on the server). Give one student more, fewer, or 0 to stop their free analyses; it applies at once. Newest first
            {students.total > STUDENT_LIMIT ? `, the latest ${STUDENT_LIMIT}` : ""}.
          </p>
          <Table
            caption="Students"
            head={["Student", "Joined", "Analyses", "AI today", "Cost, 30 days", "Free analyses a day"]}
            rows={overview.studentList.map((student) => [
              <span key="who" className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{student.email}</span>
                {student.name && <span className="truncate text-meta text-muted">{student.name}</span>}
              </span>,
              date.format(student.joined),
              count.format(student.analyses),
              count.format(student.requestsToday),
              money.format(student.costUsd30d),
              <AllowanceForm key="allowance" userId={student.id} email={student.email} allowance={student.allowance} />,
            ])}
            empty="No students yet."
          />
        </section>

        <section aria-labelledby="admin-feedback" className="flex flex-col gap-3">
          <h2 id="admin-feedback" className="font-serif text-section">
            Latest feedback
          </h2>
          {overview.feedback.length === 0 ? (
            <p className="text-sm text-muted">No feedback yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.feedback.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 rounded-card border border-line-card bg-card px-4 py-3">
                  <span className="text-meta text-muted">
                    {item.email} · {dateTime.format(item.createdAt)}
                    {item.page ? ` · ${item.page}` : ""}
                  </span>
                  <span className="text-sm whitespace-pre-wrap">{item.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function totalsCells(totals: AiTotals): string[] {
  return [
    count.format(totals.calls),
    count.format(totals.failed),
    count.format(totals.inputTokens),
    count.format(totals.outputTokens),
    totals.calls > 0 && totals.unpriced === totals.calls ? "—" : money.format(totals.costUsd),
  ];
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line-card bg-card px-4 py-3">
      <span className="text-meta text-muted">{label}</span>
      <span className="font-serif text-[26px] leading-tight tabular-nums">{value}</span>
      <span className="text-meta text-muted">{detail}</span>
    </div>
  );
}

function Table({ caption, head, rows, empty }: { caption: string; head: string[]; rows: ReactNode[][]; empty?: string }) {
  // Numbers line up on the right; columns of controls (e.g. the allowance) stay on the left.
  const leftColumns = new Set((rows[0] ?? []).flatMap((cell, index) => (index > 0 && typeof cell !== "string" ? [index] : [])));
  return (
    <div className="overflow-x-auto rounded-card border border-line-card bg-card">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-card text-left text-meta text-muted">
            {head.map((cell, index) => (
              <th key={cell} scope="col" className={`px-4 py-2 font-medium whitespace-nowrap ${index === 0 || leftColumns.has(index) ? "" : "text-right"}`}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-line-card last:border-b-0">
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row" className="max-w-[280px] px-4 py-2 text-left font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={index} className={`px-4 py-2 whitespace-nowrap tabular-nums ${leftColumns.has(index) ? "" : "text-right"}`}>
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
