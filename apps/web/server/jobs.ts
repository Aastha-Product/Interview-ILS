import "server-only";
import { getConfig, getMatch, type MatchView } from "@pathfinder/core";
import type { ScopedDb } from "@pathfinder/db";
import { createFeedAdapters } from "@pathfinder/feeds";
import type { JobCardData, JobSummary, MatchSummary } from "@/lib/jobs";
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

/** Scores a batch of jobs for one student, a few at a time (extraction may call the AI). */
export async function scoreJobs(db: ScopedDb, jobs: JobSummary[], concurrency = 4): Promise<JobCardData[]> {
  const out: JobCardData[] = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i]!;
      try {
        out[i] = { job, match: toMatchSummary(await getMatch({ db, ai: getAi() }, job.id)) };
      } catch {
        // A job we can't score is still worth showing.
        out[i] = { job, match: null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}
