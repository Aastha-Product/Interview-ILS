import { getMatch, UserFacingError } from "@pathfinder/core";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreBadge, SourceLabel } from "@/components/jobs/job-card";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { getAi } from "@/server/services";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Job match" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const listing = await db.jobListing.findUnique({ where: { id } });
  if (!listing) notFound();

  let match;
  let matchError: string | null = null;
  try {
    match = await getMatch({ db, ai: getAi() }, id, { explain: true });
  } catch (error) {
    if (!(error instanceof UserFacingError)) throw error;
    matchError = error.message;
  }

  const breakdown = match?.breakdown as Record<string, { points: number; max: number }> | undefined;
  const factorNames: Record<string, string> = { skills: "Skills", keywords: "Keywords", seniority: "Experience level", location: "Location" };

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link href="/jobs" className="text-sm text-brand-700 underline">
          ← All jobs
        </Link>
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{listing.title}</h1>
          <p className="text-slate-700">
            {listing.company}
            {listing.location ? ` · ${listing.location}` : ""}
            {listing.remote ? " · Remote" : ""}
          </p>
          <p className="mt-1">
            <SourceLabel source={listing.source} />
          </p>
        </div>
        {match && <ScoreBadge score={match.score} />}
      </div>

      <div className="flex flex-wrap gap-2">
        {listing.applyUrl && (
          <Button asChild variant="outline">
            <a href={listing.applyUrl} target="_blank" rel="noopener noreferrer">
              Open job page <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        )}
        <Button disabled title="Tailored applications arrive in the next update">
          Start application
        </Button>
      </div>

      {matchError && <Alert tone="error">{matchError}</Alert>}

      {match && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="How well you match" />
            {match.explanation && <p className="mb-4 text-slate-700">{match.explanation}</p>}
            {breakdown && (
              <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(breakdown)
                  .filter(([, v]) => v && typeof v.points === "number")
                  .map(([key, v]) => (
                    <div key={key} className="rounded-md bg-slate-50 px-3 py-2">
                      <dt className="text-slate-500">{factorNames[key] ?? key}</dt>
                      <dd className="font-semibold">
                        {Math.round(v.points)} / {v.max}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {match.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Gaps" description="What this job asks for that your profile doesn't show yet." />
            {match.gaps.length === 0 ? (
              <p className="text-sm text-slate-600">No gaps found. Nice.</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Gaps">
                {match.gaps.map((g) => (
                  <li key={g.text} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    {g.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-slate-500">
              If you do have one of these, add it to your <Link href="/profile" className="underline">profile</Link>. We never add
              anything to your applications that isn&apos;t in your profile.
            </p>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Job description" />
        <div className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{listing.description}</div>
      </Card>
    </div>
  );
}
