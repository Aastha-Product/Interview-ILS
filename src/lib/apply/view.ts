import "server-only";

import type { ApplyState, MatchTier } from "@/generated/prisma/enums";
import { findLatestJob } from "@/lib/jobs/runner";
import { MATCH_RUN_KEY } from "@/lib/match/jobs";
import { preferencesFromProfile, type MatchPreferences } from "@/lib/match/preferences";
import { listExtensionTokens } from "@/lib/extension/tokens";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { autoApplySummary, type AutoApplySummary } from "./prepare";
import { CONSENT_TEXT, loadAutoApply, type AutoApplyView } from "./settings";

// Pathfinder (auto-apply step 4): what the auto-apply screens show for the current student.

export type ApplyTaskView = {
  id: string;
  state: ApplyState;
  title: string;
  company: string;
  location: string;
  /** The job's own page, to read it or apply by hand. */
  url: string;
  score: number | null;
  tier: MatchTier | null;
  /** Why it waits, failed or was skipped. */
  reason: string | null;
  /** The application with the tailored documents, once written. */
  applicationId: string | null;
  appliedAt: string | null;
  /** Applied: the words the job board confirmed it with, or that the student said so. */
  confirmation: Confirmation | null;
  updatedAt: string;
};

export type Confirmation = { by: "board"; text: string } | { by: "student" };

/** The student's connected browsers: none means nothing is submitted. */
export type BrowsersView = {
  connected: number;
  /** When one last asked for work (every minute while Chrome is open); null if never. */
  lastSeen: string | null;
  /** Connected, but none seen for a day: applications wait until Chrome is open. */
  quiet: boolean;
};

export type AutoApplyScreenView = {
  settings: AutoApplyView;
  /** The saved preferences, or what the profile suggests until there are some. */
  preferences: MatchPreferences;
  consentText: string;
  summary: AutoApplySummary;
  /** Newest first: what's waiting on the student, then the rest. */
  tasks: ApplyTaskView[];
  /** The latest match run's job, to follow it; null before the first. */
  matchRunId: string | null;
  /** Open jobs in the shared pool, to show the crawler is working. */
  openJobs: number;
  browsers: BrowsersView;
};

const TASKS_SHOWN = 100;
const QUIET_MS = 24 * 3600_000;

/** The words an applied task was confirmed with (src/lib/apply/lease.ts keeps them). */
export function confirmationOf(evidence: unknown): Confirmation | null {
  const value = evidence as { text?: unknown; byStudent?: unknown } | null;
  if (value?.byStudent === true) return { by: "student" };
  return typeof value?.text === "string" && value.text.trim() ? { by: "board", text: value.text.trim() } : null;
}

export async function loadAutoApplyScreen(now = new Date()): Promise<AutoApplyScreenView> {
  const [settings, summary, latest, openJobs, tokens] = await Promise.all([
    loadAutoApply(),
    autoApplySummary(),
    findLatestJob(MATCH_RUN_KEY),
    systemPrisma.sharedPosting.count({ where: { closedAt: null } }),
    listExtensionTokens(now),
  ]);
  const seen = tokens.map((token) => token.lastUsedAt).filter((at): at is string => at !== null).sort();
  const lastSeen = seen.at(-1) ?? null;
  const browsers: BrowsersView = { connected: tokens.length, lastSeen, quiet: tokens.length > 0 && (lastSeen === null || now.getTime() - Date.parse(lastSeen) > QUIET_MS) };
  const preferences = settings.preferences ?? preferencesFromProfile(await loadProfile());

  const tasks = await prisma.applyTask.findMany({
    orderBy: { updatedAt: "desc" },
    take: TASKS_SHOWN,
    include: { jobMatch: { select: { score: true, tier: true } } },
  });
  // The jobs are shared rows; read the ones these tasks are for.
  const postings = new Map(
    (
      await systemPrisma.sharedPosting.findMany({
        where: { id: { in: tasks.map((task) => task.sharedPostingId) } },
        select: { id: true, title: true, companyName: true, location: true, url: true },
      })
    ).map((posting) => [posting.id, posting]),
  );
  const waitingFirst = (state: ApplyState) => (state === "NEEDS_STUDENT" || state === "UNCERTAIN" ? 0 : 1);
  const views = tasks
    .map((task): ApplyTaskView => {
      const posting = postings.get(task.sharedPostingId);
      return {
        id: task.id,
        state: task.state,
        title: posting?.title ?? "A job that's no longer listed",
        company: posting?.companyName ?? "",
        location: posting?.location ?? "",
        url: posting?.url ?? "",
        score: task.jobMatch.score,
        tier: task.jobMatch.tier,
        reason: task.reason,
        applicationId: task.applicationId,
        appliedAt: task.appliedAt?.toISOString() ?? null,
        confirmation: task.state === "APPLIED" ? confirmationOf(task.evidence) : null,
        updatedAt: task.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => waitingFirst(a.state) - waitingFirst(b.state));

  return { settings, preferences, consentText: CONSENT_TEXT, summary, tasks: views, matchRunId: latest?.id ?? null, openJobs, browsers };
}
