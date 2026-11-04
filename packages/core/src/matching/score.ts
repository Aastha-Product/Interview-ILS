import { canonicalSkill, findSkillsInText, type JobRequirements } from "@pathfinder/ai";
import { normaliseLocation } from "@pathfinder/feeds";
import type { PreferencesInput, ProfileInput } from "../profile/schema";

/**
 * Deterministic job match score. No AI and no I/O: the same inputs always give the same score,
 * whatever order the profile's lists are in. The AI only explains the result afterwards.
 * Bump SCORER_VERSION whenever the rules change, so cached matches are recomputed.
 */
export const SCORER_VERSION = "score-v1";

export const WEIGHTS = { skills: 50, keywords: 15, seniority: 20, location: 15 } as const;
export type Factor = keyof typeof WEIGHTS;

export interface MatchInput {
  profile: ProfileInput;
  preferences: PreferencesInput | null;
  requirements: JobRequirements;
  job: { title: string; location: string; remote: boolean; description: string };
}

export interface MatchGap {
  kind: "skill" | "experience" | "location" | "other";
  /** For "skill" gaps this is the skill name; otherwise a plain-English sentence. */
  text: string;
}

export interface MatchResult {
  score: number;
  breakdown: Record<Factor, { points: number; max: number }>;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  gaps: MatchGap[];
}

const STOPWORDS = new Set(
  (
    "a about above after again all also an and any are as at be been being below between both but by can could did do does doing " +
    "down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me " +
    "more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their " +
    "them then there these they this those through to too under until up very was we were what when where which while who whom why " +
    "will with would you your yours etc must able ability good strong excellent knowledge understanding experience work working " +
    "role job candidate candidates team company years year skills skill required requirements responsibilities preferred plus " +
    "including well using use per within across looking join opportunity apply related relevant new based like least time"
  ).split(" "),
);

const sortAlpha = (items: Iterable<string>) => [...new Set(items)].sort((a, b) => a.localeCompare(b));
const round1 = (n: number) => Math.round(n * 10) / 10;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

function listText(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function profileText(p: ProfileInput): string {
  return [
    p.headline,
    p.summary,
    ...p.skills.map((s) => s.name),
    ...p.projects.flatMap((x) => [x.name, x.role, ...x.technologies, ...x.highlights]),
    ...p.experiences.flatMap((x) => [x.title, ...x.highlights]),
    ...p.education.flatMap((x) => [x.degree, x.field]),
  ].join("\n");
}

/** Every skill the profile shows, by canonical name (lower-case keys → display names). */
function profileSkills(p: ProfileInput): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: string) => {
    const c = canonicalSkill(name);
    if (c) out.set(c.toLowerCase(), c);
  };
  p.skills.forEach((s) => add(s.name));
  p.projects.forEach((x) => x.technologies.forEach(add));
  const prose = [
    ...p.projects.flatMap((x) => [x.name, ...x.highlights]),
    ...p.experiences.flatMap((x) => [x.title, ...x.highlights]),
    p.headline,
    p.summary,
  ].join("\n");
  findSkillsInText(prose).forEach(add);
  return out;
}

const CANDIDATE_YEARS = { FRESHER: 0, ZERO_TO_ONE: 0.5, ONE_TO_THREE: 2 } as const;
const SENIORITY_YEARS: Record<JobRequirements["seniority"], number | null> = {
  intern: 0,
  fresher: 0,
  junior: 1,
  mid: 3,
  senior: 6,
  unknown: null,
};

export function scoreMatch(input: MatchInput): MatchResult {
  const { profile, preferences, requirements, job } = input;
  const reasons: string[] = [];
  const gaps: MatchGap[] = [];

  // ---- Skills (50): required skills up to 45, preferred skills up to 5.
  const have = profileSkills(profile);
  let required = sortAlpha(requirements.requiredSkills.map(canonicalSkill).filter(Boolean));
  let inferred = false;
  if (required.length === 0) {
    required = findSkillsInText(`${job.title}\n${job.description}`);
    inferred = required.length > 0;
  }
  const requiredKeys = new Set(required.map((s) => s.toLowerCase()));
  const nice = sortAlpha(requirements.niceToHaveSkills.map(canonicalSkill).filter((s) => s && !requiredKeys.has(s.toLowerCase())));
  const matchedSkills = required.filter((s) => have.has(s.toLowerCase()));
  const missingSkills = required.filter((s) => !have.has(s.toLowerCase()));
  const niceMatched = nice.filter((s) => have.has(s.toLowerCase()));

  const requiredMax = WEIGHTS.skills * 0.9;
  const niceMax = WEIGHTS.skills - requiredMax;
  let skillPoints: number;
  if (required.length === 0) {
    skillPoints = WEIGHTS.skills / 2;
    reasons.push("The posting doesn't list specific skills, so we couldn't compare them.");
  } else {
    const ratio = matchedSkills.length / required.length;
    const niceRatio = nice.length ? niceMatched.length / nice.length : ratio;
    skillPoints = ratio * requiredMax + niceRatio * niceMax;
    const label = inferred ? "skills the posting mentions" : "required skills";
    reasons.push(
      matchedSkills.length === 0
        ? `You don't list any of the ${required.length} ${label} yet.`
        : `You have ${matchedSkills.length} of the ${required.length} ${label}: ${listText(matchedSkills)}.`,
    );
    if (niceMatched.length) {
      reasons.push(`You also have ${niceMatched.length} of the ${nice.length} preferred skills: ${listText(niceMatched)}.`);
    }
  }
  missingSkills.forEach((s) => gaps.push({ kind: "skill", text: s }));

  // ---- Keywords (15): how many of the posting's key terms appear in the profile.
  const counts = new Map<string, number>();
  for (const t of tokens(`${job.title} ${job.title} ${job.description}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const keyTerms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([t]) => t);
  const profileTokens = new Set(tokens(profileText(profile)));
  const keywordHits = keyTerms.filter((t) => profileTokens.has(t)).length;
  const keywordRatio = keyTerms.length ? keywordHits / keyTerms.length : 0;
  // Covering half of the key terms earns full marks; nobody's profile repeats a whole posting.
  const keywordPoints = keyTerms.length ? Math.min(1, keywordRatio / 0.5) * WEIGHTS.keywords : WEIGHTS.keywords / 2;
  if (keyTerms.length) {
    reasons.push(`Your profile mentions ${keywordHits} of the posting's ${keyTerms.length} key terms.`);
  }

  // ---- Seniority (20).
  const level = preferences?.experienceLevel ?? "FRESHER";
  const yours = CANDIDATE_YEARS[level];
  const needed = requirements.minYearsExperience ?? SENIORITY_YEARS[requirements.seniority];
  let seniorityPoints: number;
  if (requirements.seniority === "senior") {
    seniorityPoints = WEIGHTS.seniority * 0.1;
    reasons.push("This is a senior role, which usually needs several years of experience.");
    gaps.push({ kind: "experience", text: "This is a senior role." });
  } else if (needed === null) {
    seniorityPoints = WEIGHTS.seniority * 0.6;
    reasons.push("The posting doesn't say how much experience it needs.");
  } else if (needed <= yours + 1) {
    seniorityPoints = WEIGHTS.seniority;
    reasons.push(
      requirements.seniority === "intern"
        ? "It's an internship, which suits your experience."
        : needed === 0
          ? "It's open to freshers, which suits your experience."
          : `It asks for about ${needed} year${needed === 1 ? "" : "s"} of experience, which suits yours.`,
    );
  } else if (needed <= yours + 2) {
    seniorityPoints = WEIGHTS.seniority * 0.6;
    reasons.push(`It asks for ${needed} years of experience, a little more than you have.`);
    gaps.push({ kind: "experience", text: `Asks for at least ${needed} years of experience.` });
  } else {
    seniorityPoints = WEIGHTS.seniority * 0.15;
    reasons.push(`It asks for ${needed} years of experience, much more than you have.`);
    gaps.push({ kind: "experience", text: `Asks for at least ${needed} years of experience.` });
  }

  // ---- Location (15).
  const remoteOk = preferences?.remoteOk ?? true;
  const isRemote = job.remote || requirements.workMode === "remote";
  const jobLocation = job.location || requirements.location;
  const jobCity = normaliseLocation(jobLocation);
  const wanted = new Set(
    [...(preferences?.locations ?? []), profile.location].map(normaliseLocation).filter(Boolean),
  );
  let locationPoints: number;
  if (isRemote && remoteOk) {
    locationPoints = WEIGHTS.location;
    reasons.push("It's a remote job, and you're open to remote work.");
  } else if (jobCity && wanted.has(jobCity)) {
    locationPoints = WEIGHTS.location;
    reasons.push(`It's in ${jobLocation.split(",")[0]?.trim()}, which matches where you want to work.`);
  } else if (isRemote) {
    locationPoints = WEIGHTS.location / 3;
    reasons.push("It's a remote job, but you said you prefer working on site.");
    gaps.push({ kind: "location", text: "This job is remote, and you said you prefer on-site work." });
  } else if (!jobCity) {
    locationPoints = WEIGHTS.location / 2;
    reasons.push("The posting doesn't say where the job is based.");
  } else if (wanted.size === 0) {
    locationPoints = WEIGHTS.location / 2;
    reasons.push(`It's in ${jobLocation.split(",")[0]?.trim()}. Add your preferred cities to check the fit.`);
  } else {
    locationPoints = WEIGHTS.location * 0.2;
    const city = jobLocation.split(",")[0]?.trim();
    reasons.push(`It's in ${city}, which isn't one of your preferred cities.`);
    gaps.push({ kind: "location", text: `This job is in ${city}, which isn't one of your preferred cities.` });
  }

  const breakdown = {
    skills: { points: round1(skillPoints), max: WEIGHTS.skills },
    keywords: { points: round1(keywordPoints), max: WEIGHTS.keywords },
    seniority: { points: round1(seniorityPoints), max: WEIGHTS.seniority },
    location: { points: round1(locationPoints), max: WEIGHTS.location },
  };
  const total = skillPoints + keywordPoints + seniorityPoints + locationPoints;
  const score = Math.max(0, Math.min(100, Math.round(total)));

  return { score, breakdown, matchedSkills, missingSkills, reasons, gaps };
}
