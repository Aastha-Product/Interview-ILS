import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { isAiUsable } from "@/lib/ai/config";
import { listResumeAnalyses } from "@/lib/resume-analysis";

import { ResumeUpload } from "./resume-upload";

export const metadata: Metadata = { title: "Analyse your resume" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Pathfinder's home: upload a resume and get an analysis, with nothing to set up. Earlier
 * analyses are listed below it.
 */
export default async function AnalyzePage({ searchParams }: PageProps<"/analyze">) {
  const [{ job }, ready, analyses] = await Promise.all([searchParams, isAiUsable(), listResumeAnalyses()]);
  return (
    <>
      <PageHeader
        title="Analyse your resume"
        description="Upload your resume and get an instant analysis: what works, what to improve, and what's missing. Only you can see it."
      />
      <div className="flex max-w-[816px] flex-col gap-8 px-4 pb-20 sm:px-10">
        <ResumeUpload ready={ready} initialJobId={typeof job === "string" ? job : null} />

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

        {analyses.length > 0 && (
          <section aria-labelledby="past-analyses" className="flex flex-col gap-3">
            <h2 id="past-analyses" className="font-serif text-section">
              Your analyses
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-card border border-line-card bg-card">
              {analyses.map((analysis) => (
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
