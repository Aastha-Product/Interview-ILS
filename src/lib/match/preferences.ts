import { countryCode } from "@/lib/crawl/place";
import type { DateSpan, ProfileData } from "@/lib/profile";

// Pathfinder (auto-apply step 3): what a student is looking for. Step 4's "Set up job search"
// lets them confirm and change it; until then it comes from their profile.

export const LEVELS = ["intern", "entry", "experienced"] as const;
export type Level = (typeof LEVELS)[number];

export const EMPLOYMENT_TYPES = ["full-time", "internship", "part-time", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type MatchPreferences = {
  /** Roles to look for, e.g. "Data Analyst". */
  titles: string[];
  /** Skills the student has: the ranking looks for them in postings. */
  skills: string[];
  /** ISO codes ("in"). */
  countries: string[];
  /** Cities within those countries; empty for anywhere in them. */
  cities: string[];
  /** Whether remote jobs open to the student's countries count. */
  remoteOk: boolean;
  /** Intern and entry level leave out senior, lead and manager roles. */
  level: Level;
  /** Empty for any. */
  employmentTypes: EmploymentType[];
};

const monthIndex = (year: number | null, month: number | null) => (year === null ? null : year * 12 + ((month ?? 1) - 1));

/** Months of work experience, overlapping roles counted once. */
export function experienceMonths(experience: readonly DateSpan[], now = new Date()): number {
  const today = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = experience
    .map((entry) => {
      const start = monthIndex(entry.startYear, entry.startMonth);
      const end = entry.current ? today : monthIndex(entry.endYear, entry.endMonth);
      return start === null || end === null || end < start ? null : ([start, Math.min(end, today)] as const);
    })
    .filter((span): span is readonly [number, number] => span !== null)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reached = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, reached + 1);
    if (end >= from) total += end - from + 1;
    reached = Math.max(reached, end);
  }
  return total;
}

/** The preferences a profile suggests: its headline and latest role, its skills, its city and country. */
export function preferencesFromProfile(profile: ProfileData, now = new Date()): MatchPreferences {
  const roles = profile.experience.map((entry) => entry.role.trim()).filter(Boolean);
  const titles = [...new Set([profile.basics.headline.trim(), ...roles.slice(0, 2)].filter(Boolean))].slice(0, 5);
  const country = countryCode(profile.basics.country) || "in";
  const months = experienceMonths(profile.experience, now);
  return {
    titles,
    skills: [...new Set(profile.skills.map((skill) => skill.name.trim()).filter(Boolean))].slice(0, 40),
    countries: [country],
    cities: [],
    remoteOk: true,
    level: months >= 24 ? "experienced" : "entry",
    employmentTypes: [],
  };
}
