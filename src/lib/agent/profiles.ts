import type { SearchQuery } from "@/lib/job-search/search";

// Job profiles (Phase 1): besides its main search, the job agent can run up to two more, e.g.
// "Data analyst in Bengaluru" and "Business analyst, remote". Each is one more request to the job
// source a run; the postings they find are scored together, within the same per-run limit.

/** Searches besides the main one. */
export const MAX_EXTRA_SEARCHES = 2;

/** A search complete enough to run: keywords and a country. */
export const searchReady = (query: SearchQuery) => Boolean(query.keywords.trim() && query.country);

const sameSearch = (query: SearchQuery) =>
  [query.keywords.trim().toLowerCase(), query.place.trim().toLowerCase(), query.country, query.radiusKm, query.remoteOnly, query.postedWithin].join("|");

/** The searches a run makes: the main one first, then the others that are complete, each once. */
export function agentSearches(main: SearchQuery, extra: readonly SearchQuery[]): SearchQuery[] {
  const seen = new Set<string>();
  return [main, ...extra.slice(0, MAX_EXTRA_SEARCHES)].filter((query) => {
    if (!searchReady(query)) return false;
    const key = sameSearch(query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
