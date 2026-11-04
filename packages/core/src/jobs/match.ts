import { createHash } from "node:crypto";
import { AiError, matchExplainTask, validateGaps, type AiClient, type JobRequirements } from "@pathfinder/ai";
import type { Prisma, ScopedDb } from "@pathfinder/db";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { scoreMatch, SCORER_VERSION, type Factor, type MatchGap, type MatchResult } from "../matching/score";
import type { ProfileView } from "../profile/schema";
import { getPreferences, getProfile } from "../profile/service";
import { createAiRecorder } from "../usage";
import { ensureExtraction, type ExtractionView } from "./extraction";

/** What the student sees about a posting's requirements. */
export type RequirementsSummary = Pick<
  JobRequirements,
  | "requiredSkills"
  | "niceToHaveSkills"
  | "seniority"
  | "minYearsExperience"
  | "workMode"
  | "education"
  | "otherRequirements"
  | "responsibilities"
  | "employmentType"
  | "salaryText"
>;

/** A gap, optionally with one line of advice from the AI explanation. */
export type MatchGapView = MatchGap & { advice?: string };

export interface MatchView {
  jobListingId: string;
  score: number;
  breakdown: MatchResult["breakdown"];
  reasons: string[];
  gaps: MatchGapView[];
  /** Short AI explanation; empty until requested with explain: true. */
  explanation: string;
  matchedSkills: string[];
  missingSkills: string[];
  profileVersion: number;
  requirements: RequirementsSummary;
}

export interface JobListingSummary {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  employmentType: string;
  applyUrl: string | null;
  urlNormalised: string | null;
  postedAt: string | null;
  closedAt: string | null;
}

export interface MatchDeps {
  db: ScopedDb;
  ai: AiClient;
}

/** Stored in JobMatch.breakdown alongside the per-factor points. */
interface StoredBreakdown {
  factors: MatchResult["breakdown"];
  matchedSkills: string[];
  missingSkills: string[];
  scorerVersion: string;
  requirements: RequirementsSummary;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

function summarise(r: JobRequirements): RequirementsSummary {
  return {
    requiredSkills: r.requiredSkills,
    niceToHaveSkills: r.niceToHaveSkills,
    seniority: r.seniority,
    minYearsExperience: r.minYearsExperience,
    workMode: r.workMode,
    education: r.education,
    otherRequirements: r.otherRequirements,
    responsibilities: r.responsibilities,
    employmentType: r.employmentType,
    salaryText: r.salaryText,
  };
}

function toView(row: {
  jobListingId: string;
  score: number;
  breakdown: unknown;
  reasons: unknown;
  gaps: unknown;
  explanation: string;
  profileVersion: number;
}): MatchView {
  const stored = (row.breakdown ?? {}) as Partial<StoredBreakdown>;
  return {
    jobListingId: row.jobListingId,
    score: row.score,
    breakdown: stored.factors ?? ({} as MatchResult["breakdown"]),
    reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
    gaps: Array.isArray(row.gaps) ? (row.gaps as MatchGapView[]) : [],
    explanation: row.explanation,
    matchedSkills: stored.matchedSkills ?? [],
    missingSkills: stored.missingSkills ?? [],
    profileVersion: row.profileVersion,
    requirements: stored.requirements ?? {
      requiredSkills: [],
      niceToHaveSkills: [],
      seniority: "unknown",
      minYearsExperience: null,
      workMode: "unknown",
      education: "",
      otherRequirements: [],
      responsibilities: [],
      employmentType: "",
      salaryText: "",
    },
  };
}

/** The requirement strings the AI may refer to when it lists gaps. */
function requirementStrings(r: JobRequirements): string[] {
  const out = [...r.requiredSkills, ...r.niceToHaveSkills, ...r.otherRequirements];
  if (r.education) out.push(r.education);
  if (r.minYearsExperience) out.push(`At least ${r.minYearsExperience} years of experience`);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

function profileSummary(p: ProfileView) {
  const edu = p.education[0];
  return {
    headline: p.headline,
    skills: p.skills.map((s) => s.name),
    projectNames: p.projects.map((x) => x.name),
    experienceTitles: p.experiences.map((x) => [x.title, x.company].filter(Boolean).join(" at ")),
    educationLine: edu ? [[edu.degree, edu.field].filter(Boolean).join(" in "), edu.institution].filter(Boolean).join(", ") : "",
  };
}

/** Attaches AI advice to the matching skill gaps, and adds the rest as "other" gaps after them. */
function mergeGaps(base: MatchGap[], ai: Array<{ requirement: string; advice: string }>): MatchGapView[] {
  const merged: MatchGapView[] = base.map((g) => ({ ...g }));
  for (const gap of ai) {
    const same = merged.find((g) => g.text.toLowerCase() === gap.requirement.toLowerCase());
    if (same) same.advice ??= gap.advice;
    else merged.push({ kind: "other", text: gap.requirement, advice: gap.advice });
  }
  return merged;
}

/**
 * The student's match with a job: a deterministic score with reasons and gaps, cached per
 * (student, job) until anything it depends on changes. With explain: true, also a short AI
 * explanation; if the AI is unavailable the score is still returned, just without it.
 */
export async function getMatch(
  { db, ai }: MatchDeps,
  jobListingId: string,
  opts: { explain?: boolean } = {},
): Promise<MatchView> {
  const profile = await getProfile(db);
  if (profile.version === 0) {
    throw new UserFacingError("NO_PROFILE", "Set up your profile first so we can compare it with jobs.", 409);
  }
  const preferences = await getPreferences(db);
  const listing = await db.jobListing.findUnique({ where: { id: jobListingId } });
  if (!listing) throw new UserFacingError("JOB_NOT_FOUND", "We couldn't find that job. It may have been removed.", 404);

  const recorder = createAiRecorder(db);
  const extraction: ExtractionView = await ensureExtraction({ ai, recorder }, jobListingId);

  const inputHash = createHash("sha256")
    .update(
      JSON.stringify([
        profile.version,
        preferences,
        extraction.id,
        extraction.updatedAt.toISOString(),
        listing.updatedAt.toISOString(),
        SCORER_VERSION,
      ]),
    )
    .digest("hex");

  const existing = await db.jobMatch.findUnique({
    where: { userId_jobListingId: { userId: db.userId, jobListingId } },
  });
  if (existing && existing.inputHash === inputHash && (!opts.explain || existing.explanation)) {
    return toView(existing);
  }

  const { version, updatedAt, ...profileInput } = profile;
  void updatedAt;
  const result = scoreMatch({
    profile: profileInput,
    preferences,
    requirements: extraction,
    job: { title: listing.title, location: listing.location, remote: listing.remote, description: listing.description },
  });

  let explanation = existing && existing.inputHash === inputHash ? existing.explanation : "";
  let gaps: MatchGapView[] = result.gaps;
  if (opts.explain) {
    const requirements = requirementStrings(extraction);
    try {
      const out = await ai.run(
        matchExplainTask,
        {
          jobTitle: listing.title,
          company: listing.company,
          score: result.score,
          matchedSkills: result.matchedSkills,
          missingSkills: result.missingSkills,
          requirements,
          profileSummary: profileSummary(profile),
        },
        { recorder },
      );
      explanation = out.explanation.trim();
      gaps = mergeGaps(result.gaps, validateGaps(out.gaps, requirements));
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      getLogger().warn({ kind: error.kind, op: "match.explain" }, "match explanation failed");
    }
  }

  const stored: StoredBreakdown = {
    factors: result.breakdown,
    matchedSkills: result.matchedSkills,
    missingSkills: result.missingSkills,
    scorerVersion: SCORER_VERSION,
    requirements: summarise(extraction),
  };
  const fields = {
    score: result.score,
    breakdown: json(stored),
    reasons: json(result.reasons),
    gaps: json(gaps),
    explanation,
    profileVersion: version,
    inputHash,
  };
  const saved = await db.jobMatch.upsert({
    where: { userId_jobListingId: { userId: db.userId, jobListingId } },
    create: { userId: db.userId, jobListingId, ...fields },
    update: fields,
  });
  return toView(saved);
}

export type MatchListItem = MatchView & {
  job: JobListingSummary;
  /** True when the profile changed after this score was calculated. */
  stale: boolean;
};

/** Every job the student has a match for, best first. Scores are as last calculated. */
export async function listMatches(db: ScopedDb): Promise<MatchListItem[]> {
  const [rows, profile] = await Promise.all([
    db.jobMatch.findMany({ include: { jobListing: true } }),
    db.profile.findFirst({ select: { version: true } }),
  ]);
  const currentVersion = profile?.version ?? 0;
  return rows
    .map((row) => ({
      ...toView(row),
      stale: row.profileVersion !== currentVersion,
      job: {
        id: row.jobListing.id,
        source: row.jobListing.source,
        title: row.jobListing.title,
        company: row.jobListing.company,
        location: row.jobListing.location,
        remote: row.jobListing.remote,
        employmentType: row.jobListing.employmentType,
        applyUrl: row.jobListing.applyUrl,
        urlNormalised: row.jobListing.urlNormalised,
        postedAt: row.jobListing.postedAt?.toISOString() ?? null,
        closedAt: row.jobListing.closedAt?.toISOString() ?? null,
      },
    }))
    .sort((a, b) => b.score - a.score || a.job.title.localeCompare(b.job.title) || a.jobListingId.localeCompare(b.jobListingId));
}

export type { Factor };
