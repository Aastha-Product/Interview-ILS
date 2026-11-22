import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { buttonClassName } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/next-path";
import { JOB_SITES, publicJobsHref, type JobSite, type PublicJobsQuery } from "@/lib/public-jobs";
import type { PublicJobsView } from "@/lib/public-jobs-data";

const count = new Intl.NumberFormat("en-IN");

/**
 * The open jobs board (Phase 5), laid out like the public homepage: its navy bar, a search, the
 * jobs newest first with a link to each on the company's own board, and an invitation to sign up.
 * A plain form: it works without JavaScript and every page of results has its own address.
 */
export function OpenJobsScreen({ view, query, signedIn, canSignUp }: { view: PublicJobsView; query: PublicJobsQuery; signedIn: boolean; canSignUp: boolean }) {
  const start = signedIn ? { href: "/auto-apply", label: "Set up auto-apply" } : { href: canSignUp ? "/signup" : "/login", label: "Sign up free" };
  const searching = Boolean(query.q || query.city || query.remote || query.posted || query.site || query.appliable);
  return (
    <div className="flex min-h-screen flex-col bg-white pt-16 text-ink light-page">
      <header className="on-navy fixed top-0 z-50 w-full">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-white hover:text-white">
            <BrandMark className="size-8" />
            <span className="text-xl font-bold">Pathfinder</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {!signedIn && (
              <Link href="/login" className={buttonClassName("secondary", "md", "px-3 sm:px-5")}>
                Sign in
              </Link>
            )}
            <Link href={signedIn ? HOME_PATH : start.href} className={buttonClassName("primary", "md", "px-3 sm:px-5")}>
              {signedIn ? "Dashboard" : "Get started"}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="bg-brand-gradient px-4 pt-12 pb-10">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <h1 className="text-3xl leading-tight font-bold text-balance text-white md:text-4xl">Open jobs in India</h1>
            <p className="max-w-2xl text-on-brand-muted">
              {view.total === 0 && searching ? (
                "No open roles match your search yet. New ones come in every few hours."
              ) : (
                <>
                  {count.format(view.total)} open {view.total === 1 ? "role" : "roles"} from {count.format(view.companies)} {view.companies === 1 ? "company's" : "companies'"} own job boards
                  {searching ? " match your search" : ""}, updated every few hours.
                </>
              )}
            </p>
            <form action="/open-jobs" method="get" role="search" aria-label="Search open jobs" className="flex flex-col gap-3 rounded-card bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                Role or company
                <input name="q" defaultValue={query.q} maxLength={80} placeholder="Data analyst, Razorpay…" className="h-10 rounded-control border border-line-field px-3 font-normal" />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                City
                <input name="city" defaultValue={query.city} maxLength={80} placeholder="Bengaluru" className="h-10 rounded-control border border-line-field px-3 font-normal" />
              </label>
              <button type="submit" className={buttonClassName("primary", "md")}>
                Search
              </button>
              </div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3 text-sm">
                <label className="flex flex-col gap-1 font-medium">
                  Posted
                  <select name="posted" defaultValue={query.posted ? String(query.posted) : ""} className="h-9 rounded-control border border-line-field px-2 font-normal">
                    <option value="">Any time</option>
                    <option value="1">Last 24 hours</option>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Job site
                  <select name="site" defaultValue={query.site ? query.site.toLowerCase() : ""} className="h-9 rounded-control border border-line-field px-2 font-normal">
                    <option value="">All</option>
                    {(Object.keys(JOB_SITES) as JobSite[]).map((site) => (
                      <option key={site} value={site.toLowerCase()}>
                        {JOB_SITES[site]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 sm:h-9">
                  <input type="checkbox" name="remote" value="1" defaultChecked={query.remote} className="size-4" />
                  Remote only
                </label>
                <label className="flex items-center gap-2 sm:h-9">
                  <input type="checkbox" name="appliable" value="1" defaultChecked={query.appliable} className="size-4" />
                  Pathfinder can apply
                </label>
              </div>
            </form>
          </div>
        </section>

        <section className="px-4 py-8">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            <aside className="flex flex-col gap-3 rounded-card border border-line-card bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                <span className="font-semibold">Let Pathfinder apply for you.</span> It tailors your resume to each role and fills in the application from your own browser, within the limits you set.
              </p>
              <Link href={start.href} className={buttonClassName("primary", "md", "shrink-0")}>
                {start.label}
              </Link>
            </aside>

            {view.jobs.length === 0 ? (
              <p className="py-10 text-center text-muted">
                No open jobs match that.{" "}
                {searching ? (
                  <Link href="/open-jobs" className="font-medium underline underline-offset-2">
                    See every open job
                  </Link>
                ) : null}
              </p>
            ) : (
              <ul aria-label="Open jobs" className="flex flex-col divide-y divide-line rounded-card border border-line-card">
                {view.jobs.map((job) => (
                  <li key={job.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h2 className="font-semibold">{job.title}</h2>
                      <p className="text-sm text-muted">{[job.company, job.location, job.remote ? "Remote" : "", job.posted].filter(Boolean).join(" · ")}</p>
                    </div>
                    {job.url ? (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        aria-label={`View ${job.title} at ${job.company} on its job board`}
                        className={buttonClassName("secondary", "sm", "shrink-0")}
                      >
                        View job
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {view.pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center justify-between text-sm">
                {query.page > 1 ? (
                  <Link href={publicJobsHref(query, query.page - 1)} rel="prev" className="font-medium underline underline-offset-2">
                    Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted">
                  Page {query.page} of {view.pages}
                </span>
                {query.page < view.pages ? (
                  <Link href={publicJobsHref(query, query.page + 1)} rel="next" className="font-medium underline underline-offset-2">
                    Older
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="bg-white py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-1 px-4 text-center text-sm text-muted">
          <p>Pathfinder · Jobs from companies&apos; own job boards; each links to the company&apos;s page to apply.</p>
          <Link href="/privacy" className="text-muted hover:underline">
            Privacy notice
          </Link>
        </div>
      </footer>
    </div>
  );
}
