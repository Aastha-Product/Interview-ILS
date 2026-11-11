import "server-only";

import { z } from "zod";

import { MatchStatus } from "@/generated/prisma/enums";
import { AiError } from "@/lib/ai/errors";
import { outsideDailyLimit } from "@/lib/ai/daily-limit";
import { defineJob, findUnfinishedJobs, JOB_MESSAGES, passing, startJob, type JobContext } from "@/lib/jobs/runner";
import { planApplications } from "@/lib/apply/prepare";
import { logServerError } from "@/lib/log";
import { studentMessage } from "@/lib/managed";
import { currentUserId } from "@/lib/owner/current";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadPostingScorer } from "@/lib/scoring";

import { EMPLOYMENT_TYPES, LEVELS, preferencesFromProfile, type MatchPreferences } from "./preferences";
import { searchQueries } from "./query";
import { rankPool } from "./rank";
import { tierFor } from "./tiers";

// Pathfinder (auto-apply step 3): a match run for one student. "match-jobs" ranks the shared pool
// for them (free) and shortlists the best few; each shortlisted job then gets its own "score-match"
// job, which asks the AI how well it fits and puts it in a tier. One job per posting keeps a slow
// or failed AI call from holding up the rest, and each is retried on its own.

/** Jobs the AI scores per run: the cost of a run, on the student's daily AI allowance. */
export const SHORTLIST = 25;

/** Shown when the profile gives the ranking nothing to look for. */
export const NOTHING_TO_LOOK_FOR = "Add your skills or the roles you're looking for to your profile first.";

export const MATCH_RUN_KEY = "match-run";

const preferencesSchema = z.object({
  titles: z.array(z.string().max(200)).max(10),
  skills: z.array(z.string().max(100)).max(60),
  countries: z.array(z.string().regex(/^[a-z]{2}$/)).max(10),
  cities: z.array(z.string().max(100)).max(10),
  remoteOk: z.boolean(),
  level: z.enum(LEVELS),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(4),
}) satisfies z.ZodType<MatchPreferences>;

export const matchJobsJob = defineJob({
  type: "match-jobs",
  input: z.object({ preferences: preferencesSchema.nullable(), shortlist: z.number().int().min(1).max(100).default(SHORTLIST) }),
  /** `problem` says why nothing could be looked for, in the student's words. */
  result: z.object({ shortlisted: z.number().int(), problem: z.string().nullable() }),
  attempts: 3,
  async run({ preferences, shortlist }, { step }) {
    await step("Finding jobs that fit your profile");
    const settled = preferences ?? preferencesFromProfile(await loadProfile());
    const queries = searchQueries(settled);
    if (!queries) return { shortlisted: 0, problem: NOTHING_TO_LOOK_FOR };
    const userId = await currentUserId();
    const ranked = await rankPool(userId, settled, queries, shortlist);

    await step("Asking the AI how well each one fits");
    let shortlisted = 0;
    for (const [position, job] of ranked.entries()) {
      // Another run may have shortlisted it meanwhile: the unique key keeps one match per job.
      const match = await prisma.jobMatch
        .create({ data: { sharedPostingId: job.id, rank: job.rank }, select: { id: true } })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === "P2002") return null;
          throw error;
        });
      if (!match) continue;
      // The best-ranked are scored first.
      await startJob(scoreMatchJob, { matchId: match.id }, { key: `match:${match.id}`, priority: ranked.length - position });
      shortlisted++;
    }
    return { shortlisted, problem: null };
  },
});

export const scoreMatchJob = defineJob({
  type: "score-match",
  input: z.object({ matchId: z.string().min(1) }),
  result: z.object({ score: z.number().int().nullable() }),
  queue: "ai",
  attempts: 3,
  // Auto-apply's AI isn't counted towards the daily limit (src/lib/ai/daily-limit.ts).
  run: (input, context) => outsideDailyLimit(() => scoreMatch(input, context)),
});

async function scoreMatch({ matchId }: { matchId: string }, { step, signal, finalAttempt }: JobContext): Promise<{ score: number | null }> {
  const match = await prisma.jobMatch.findUnique({ where: { id: matchId } });
  // Gone (the student deleted it), or already scored by an earlier run of this job.
  if (!match || match.status === MatchStatus.SCORED) return { score: match?.score ?? null };
  const posting = await systemPrisma.sharedPosting.findUnique({ where: { id: match.sharedPostingId } });
  if (!posting) return { score: null };

  await step("Scoring it against your profile");
  try {
    const [score, profile] = await Promise.all([loadPostingScorer(), loadProfile()]);
    const { data, scoredWith } = await score(
      {
        title: posting.title,
        company: posting.companyName,
        place: posting.location,
        remote: posting.remote,
        salary: posting.salary,
        description: posting.description,
      },
      profile,
      signal,
    );
    const tier = tierFor(data.score);
    await prisma.jobMatch.update({
      where: { id: matchId },
      data: { status: MatchStatus.SCORED, score: data.score, tier, reasons: data.reasons, redFlags: data.redFlags, scoredWith, error: null },
    });
    // Pathfinder (step 4): a good match may be applied for straight away, if auto-apply is on.
    // Planning failing doesn't undo the score; the schedule plans again later.
    if (tier === "STRONG" || tier === "GOOD") await planApplications().catch((cause: unknown) => logServerError("auto-apply plan", cause));
    return { score: data.score };
  } catch (error) {
    // A failure that's final (or that waiting won't fix) is kept with the match, so it doesn't look pending forever.
    if (!signal.aborted && (finalAttempt || !passing(error))) {
      const message = error instanceof AiError ? studentMessage(error.message) : JOB_MESSAGES.failed;
      await prisma.jobMatch.update({ where: { id: matchId }, data: { status: MatchStatus.FAILED, error: message } }).catch(() => {});
    }
    throw error;
  }
}

/**
 * Starts a match run for the current student, unless one is already under way; returns its job
 * id. Without preferences, they come from the profile.
 */
export async function startMatchRun(preferences: MatchPreferences | null = null, shortlist = SHORTLIST): Promise<string> {
  const [running] = await findUnfinishedJobs(MATCH_RUN_KEY);
  if (running) return running.id;
  return startJob(matchJobsJob, { preferences, shortlist }, { key: MATCH_RUN_KEY });
}
