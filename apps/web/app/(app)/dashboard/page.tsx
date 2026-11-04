import { getDashboard, getProfile } from "@pathfinder/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WeekBars } from "@/components/dashboard/week-bars";
import { Card, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const weekLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const { db } = await requireUser();
  if ((await getProfile(db)).version === 0) redirect("/onboarding");
  const d = await getDashboard(db);
  const maxSent = Math.max(...d.weeks.map((w) => w.sent), 1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-slate-600">How your applications are doing. Update statuses on the Applications page when you hear back.</p>
      </div>

      <section aria-labelledby="headline-metric" className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p id="headline-metric" className="text-sm text-slate-600">
            Response rate
          </p>
          <p className="mt-1 text-5xl font-semibold text-slate-900" data-testid="response-rate">
            {pct(d.totals.responseRate)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {d.totals.responses} response{d.totals.responses === 1 ? "" : "s"} from {d.totals.sent} application
            {d.totals.sent === 1 ? "" : "s"} sent. A response is any reply: a call, email, interview invite, offer or rejection.
          </p>
        </div>
        <StatTile label="Applications sent" value={String(d.totals.sent)} />
        <StatTile label="Responses" value={String(d.totals.responses)} />
        <StatTile label="Interviews and offers" value={String(d.totals.interviews)} note={d.totals.offers ? `${d.totals.offers} offer${d.totals.offers === 1 ? "" : "s"}` : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Last 8 weeks" description="Weeks start on Monday (India time)." />
          <div className="grid gap-8 sm:grid-cols-2">
            <WeekBars
              title="Applications sent per week"
              max={maxSent}
              format="count"
              bars={d.weeks.map((w) => ({ weekStart: w.weekStart, value: w.sent, detail: `${w.sent} sent` }))}
            />
            <WeekBars
              title="Response rate of each week's applications"
              max={1}
              format="percent"
              bars={d.weeks.map((w) => ({
                weekStart: w.weekStart,
                value: w.responseRate,
                detail: w.sent ? `${pct(w.responseRate)} (${w.cohortResponses} of ${w.sent} replied)` : "nothing sent",
              }))}
            />
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Weekly applications and responses">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-1.5 pr-4">Week of</th>
                  <th scope="col" className="py-1.5 pr-4 text-right">Sent</th>
                  <th scope="col" className="py-1.5 pr-4 text-right">Responses received</th>
                  <th scope="col" className="py-1.5 text-right">Response rate of that week&apos;s applications</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...d.weeks].reverse().map((w) => (
                  <tr key={w.weekStart} className="border-t border-slate-100">
                    <td className="py-1.5 pr-4">{weekLabel(w.weekStart)}</td>
                    <td className="py-1.5 pr-4 text-right">{w.sent}</td>
                    <td className="py-1.5 pr-4 text-right">{w.responsesReceived}</td>
                    <td className="py-1.5 text-right">{pct(w.responseRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="What to do next" />
          {d.nextSteps.length === 0 ? (
            <p className="text-sm text-slate-600">You&apos;re on track. Keep your statuses up to date.</p>
          ) : (
            <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
              {d.nextSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          <div className="mt-5 flex flex-col gap-2 text-sm">
            <Link href="/jobs" className="text-brand-700 underline">Find jobs</Link>
            <Link href="/applications" className="text-brand-700 underline">Update your applications</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
