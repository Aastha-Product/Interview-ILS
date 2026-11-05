import "server-only";
import { getConfig, getMatch, type MatchView } from "@pathfinder/core";
import type { ScopedDb } from "@pathfinder/db";
import { createFeedAdapters } from "@pathfinder/feeds";
import type { ExistingApplication, JobCardData, JobSummary, MatchSummary } from "@/lib/jobs";
import { getAi } from "./services";

export function getFeedAdapters() {
  return createFeedAdapters(getConfig());
}

/** Narrows any listing-shaped object to what the browser needs. */
export function toJobSummary(job: {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  source: string;
  applyUrl: string | null;
  postedAt: string | null;
}): JobSummary {
  const source = job.source === "jsearch" || job.source === "adzuna" ? job.source : "manual";
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote,
    source,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,
  };
}

export function toMatchSummary(match: MatchView): MatchSummary {
  return {
    score: match.score,
    reasons: match.reasons,
    gaps: match.gaps,
    explanation: match.explanation,
  };
}

/** The student's applications for these jobs, by job id (one query; scoped to the student). */
export async function applicationsForJobs(db: ScopedDb, jobIds: string[]): Promise<Map<string, ExistingApplication>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db.application.findMany({
    where: { jobListingId: { in: jobIds } },
    select: { id: true, jobListingId: true, status: true },
  });
  return new Map(rows.map((r) => [r.jobListingId, { id: r.id, status: r.status }]));
}

/** Scores a batch of jobs for one student, a few at a time (extraction may call the AI). */
export async function scoreJobs(db: ScopedDb, jobs: JobSummary[], concurrency = 4): Promise<JobCardData[]> {
  const out: JobCardData[] = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i]!;
      try {
        out[i] = { job, match: toMatchSummary(await getMatch({ db, ai: getAi() }, job.id)), application: null };
      } catch {
        // A job we can't score is still worth showing.
        out[i] = { job, match: null, application: null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const applications = await applicationsForJobs(db, jobs.map((j) => j.id));
  return out.map((card) => ({ ...card, application: applications.get(card.job.id) ?? null }));
}
