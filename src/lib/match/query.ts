import type { MatchPreferences } from "./preferences";

// Pathfinder (auto-apply step 3): a student's preferences as Postgres full-text queries. The words
// are cut down to letters and digits, so nothing a student types can break a query's syntax.
//
// Three queries, because what a job is called matters more than which skills its description
// happens to name (a recruiter's posting can list every skill a developer has):
// - `any` decides which jobs are considered: any target role or skill, anywhere in the job;
// - `roleWords` and `rolePhrases` rank the job's title against the target roles;
// - `skills` ranks the whole job against the skills.

const MAX_TERMS = 60;

/** "Node.js" → ["node", "js"]; "C++" → ["c"]; words of letters and digits only. */
export function words(term: string): string[] {
  return term
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6);
}

/** One term in to_tsquery syntax: a word, or a phrase ("machine <-> learning"). */
function phrase(term: string): string | null {
  const parts = words(term);
  if (parts.length === 0) return null;
  // A one-letter word ("c" from "C++", "r") matches too much on its own.
  if (parts.length === 1 && parts[0].length < 2) return null;
  return parts.length === 1 ? parts[0] : `(${parts.join(" <-> ")})`;
}

const either = (terms: (string | null)[]): string | null => {
  const unique = [...new Set(terms.filter((term): term is string => term !== null))].slice(0, MAX_TERMS);
  return unique.length > 0 ? unique.join(" | ") : null;
};

// Words in a target role that say nothing about the work.
const FILLER = new Set(["aspiring", "fresher", "graduate", "entry", "level", "junior", "trainee", "role", "position", "and", "or", "the", "of", "in", "for", "a", "an", "to"]);

export type SearchQueries = { any: string; roleWords: string | null; rolePhrases: string | null; skills: string | null };

/** The queries for to_tsquery('english', …), or null when the preferences give nothing to look for. */
export function searchQueries(preferences: Pick<MatchPreferences, "titles" | "skills">): SearchQueries | null {
  const titles = preferences.titles.map((title) => words(title).filter((word) => !FILLER.has(word)).join(" "));
  const any = either([...titles, ...preferences.skills].map(phrase));
  if (!any) return null;
  return {
    any,
    roleWords: either(titles.flatMap((title) => words(title)).filter((word) => word.length >= 2)),
    rolePhrases: either(titles.filter((title) => words(title).length > 1).map(phrase)),
    skills: either(preferences.skills.map(phrase)),
  };
}

/** The `any` query alone. */
export function searchQuery(preferences: Pick<MatchPreferences, "titles" | "skills">): string | null {
  return searchQueries(preferences)?.any ?? null;
}

// ─── How senior a job is ─────────────────────────────────────────────────────

// "3+ years", "4-6 Years", "5 to 7 yrs", "Exp- 2 years": a number of years.
const YEARS = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/gi;
const EXPERIENCE = /\b(experience|exp|experienced)\b/i;

/**
 * The fewest years of experience a job asks for, from its title and the start of its description,
 * or null when it doesn't say. Only numbers of years near the word "experience" count, so "a
 * 20-year-old company" doesn't.
 */
export function requiredYears(title: string, description: string): number | null {
  const found: number[] = [];
  for (const text of [title, description.slice(0, 8000)]) {
    for (const match of text.matchAll(YEARS)) {
      const at = match.index ?? 0;
      const around = text.slice(Math.max(0, at - 60), at + match[0].length + 60);
      if (EXPERIENCE.test(around) || text === title) found.push(Number(match[1]));
    }
  }
  return found.length > 0 ? Math.min(...found) : null;
}

/** Titles for people further on: senior, lead and manager roles, levels III and up, and grades. */
export const SENIOR_TITLE = /\b(senior|sr|staff|principal|lead|manager|director|head|vp|vice president|architect|chief|gm|dgm|agm|avp|iii|iv|v)\b|\bam\s*\/\s*m\b/i;

/** Whether a job is within reach for an intern or new graduate: not a senior title, not 3+ years. */
export function forNewGraduates(title: string, description: string): boolean {
  if (SENIOR_TITLE.test(title)) return false;
  const years = requiredYears(title, description);
  return years === null || years < 3;
}
