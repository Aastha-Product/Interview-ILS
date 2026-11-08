import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { isAiUsable, loadAiConfig } from "@/lib/ai/config";
import { analysesLeftToday, analysesPerDay, studentDailyLimit } from "@/lib/ai/daily-limit";
import { verifySession } from "@/lib/auth/session";
import { systemPrisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { getResumeAnalysis, listResumeAnalyses } from "@/lib/resume-analysis";

import { ResumeUpload } from "./resume-upload";

export const metadata: Metadata = { title: "Home" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * The student's home (Pathfinder): a welcome, one thing to do (upload a resume), how many free
 * analyses are left today, the latest analysis and the ones before it.
 */
export default async function AnalyzePage({ searchParams }: PageProps<"/analyze">) {
  const session = await verifySession();
  const [{ job }, ready, analyses, config, profileName, user, limit] = await Promise.all([
    searchParams,
    isAiUsable(),
    listResumeAnalyses(),
    loadAiConfig(),
    loadProfileName(),
    systemPrisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
    studentDailyLimit(),
  ]);
  const firstName = (profileName.trim() || user?.name.trim() || "").split(/\s+/)[0];
  const [left, latest] = await Promise.all([analysesLeftToday(config.sharedKey, limit), analyses[0] ? getResumeAnalysis(analyses[0].id) : null]);
  const perDay = analysesPerDay(limit);
  const earlier = analyses.slice(latest ? 1 : 0);

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description="Upload your resume and get an instant analysis: what works, what to improve, and what's missing. Only you can see it."
      />
      <div className="flex max-w-[816px] flex-col gap-8 px-4 pb-20 sm:px-10">
        {left !== null && perDay !== null && (
          <p className="text-sm text-muted" data-testid="analyses-left">
            <span className="font-medium text-ink">
              {left} of {perDay} free {perDay === 1 ? "analysis" : "analyses"}
            </span>{" "}
            left today. {left === 0 ? "More tomorrow: the count resets at midnight (India time)." : "The count resets at midnight (India time)."}
          </p>
        )}

        <ResumeUpload ready={ready} initialJobId={typeof job === "string" ? job : null} />

        {latest ? (
          <section aria-labelledby="latest-analysis" className="flex flex-col gap-3">
            <h2 id="latest-analysis" className="font-serif text-section">
              Your latest analysis
            </h2>
            <Link
              href={`/analyze/${latest.id}`}
              className="group flex flex-col gap-2 rounded-card border border-line-card bg-card px-5 py-4 text-ink hover:bg-hover hover:text-ink"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 truncate font-medium">{latest.fileName || "Resume"}</span>
                <span className="text-meta text-muted">{dateFormat.format(latest.createdAt)}</span>
              </span>
              <span className="line-clamp-3 text-sm text-muted">{latest.review.overview}</span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
                <span>
                  {latest.review.strengths.length} {latest.review.strengths.length === 1 ? "strength" : "strengths"}
                </span>
                <span>
                  {latest.review.improvements.length} {latest.review.improvements.length === 1 ? "thing" : "things"} to improve
                </span>
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-ink">
                  Open
                  <ArrowRight size={14} aria-hidden="true" className="motion-safe:transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
            </Link>
          </section>
        ) : (
          <section aria-labelledby="what-you-get" className="grid gap-4 sm:grid-cols-3">
            <h2 id="what-you-get" className="sr-only">
              What you get
            </h2>
            {[
              ["An overview", "How your resume comes across, in plain words."],
              ["Strengths and fixes", "What works, quoted from your resume, and concrete changes to make."],
              ["What's missing", "Details employers look for that your resume doesn't have yet."],
            ].map(([title, text]) => (
              <div key={title} className="flex flex-col gap-1">
                <p className="text-field font-medium text-ink">{title}</p>
                <p className="text-meta text-muted">{text}</p>
              </div>
            ))}
          </section>
        )}

        {earlier.length > 0 && (
          <section aria-labelledby="past-analyses" className="flex flex-col gap-3">
            <h2 id="past-analyses" className="font-serif text-section">
              {latest ? "Earlier analyses" : "Your analyses"}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-card border border-line-card bg-card">
              {earlier.map((analysis) => (
                <li key={analysis.id}>
                  <Link href={`/analyze/${analysis.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 text-field text-ink hover:bg-hover">
                    <span className="min-w-0 truncate">{analysis.fileName || "Resume"}</span>
                    <span className="shrink-0 text-meta text-muted">{dateFormat.format(analysis.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-meta text-muted">
          Your resume&apos;s text is sent to our AI provider to read it, and isn&apos;t kept after the analysis.{" "}
          <Link href="/privacy" className="font-medium text-ink underline underline-offset-2">
            How we handle your data
          </Link>
        </p>
      </div>
    </>
  );
}
