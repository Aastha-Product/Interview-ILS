import { ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import { ApplicationAction } from "@/components/applications/application-action";
import { Button } from "@/components/ui/button";
import { scoreLabel, type JobCardData } from "@/lib/jobs";

export function ScoreBadge({ score }: { score: number }) {
  const { label, className } = scoreLabel(score);
  return (
    <div className={`flex flex-col items-center rounded-md border px-3 py-1.5 ${className}`} aria-label={`Match score ${score} out of 100, ${label}`}>
      <span className="text-xl font-bold leading-none">{score}</span>
      <span className="mt-0.5 text-[11px] font-medium">{label}</span>
    </div>
  );
}

/** Adzuna's terms ask that every listing from them is labelled and linked "Adzuna". */
export function SourceLabel({ source }: { source: JobCardData["job"]["source"] }) {
  if (source === "adzuna") {
    return (
      <a href="https://www.adzuna.in" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-slate-600 underline">
        Jobs by Adzuna
      </a>
    );
  }
  if (source === "jsearch") return <span className="text-xs text-slate-500">Found via Google for Jobs (JSearch)</span>;
  return <span className="text-xs text-slate-500">Added by you</span>;
}

export function JobCard({ data }: { data: JobCardData }) {
  const { job, match } = data;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`job-${job.id}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={`job-${job.id}`} className="font-semibold text-slate-900">
            <Link href={`/jobs/${job.id}`} className="hover:underline">
              {job.title}
            </Link>
          </h3>
          <p className="text-sm text-slate-700">{job.company}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {(job.location || job.remote) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {[job.location, job.remote ? "Remote" : ""].filter(Boolean).join(" · ")}
              </span>
            )}
            <SourceLabel source={job.source} />
          </p>
        </div>
        {match ? <ScoreBadge score={match.score} /> : <span className="text-xs text-slate-500">Not scored yet</span>}
      </div>

      {match && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {match.reasons.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">
                {match.reasons.slice(0, 2).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {match.gaps.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gaps</p>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Gaps">
                {match.gaps.slice(0, 4).map((g) => (
                  <li key={g.text} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                    {g.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/jobs/${job.id}`}>See details</Link>
        </Button>
        {job.applyUrl && (
          <Button asChild size="sm" variant="ghost">
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Open job page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        )}
      </div>
      <div className="mt-2">
        <ApplicationAction jobListingId={job.id} application={data.application} />
      </div>
    </article>
  );
}
