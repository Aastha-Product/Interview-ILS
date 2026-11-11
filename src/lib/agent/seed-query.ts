import { countryCodeFor } from "@/lib/job-search/countries";
import { type SearchQuery } from "@/lib/job-search/search";
import type { ImportedProfile } from "@/lib/profile-import";

// Pathfinder: the Job agent search ("What it looks for" in Settings → Job agent), read from the
// resume a student uploads at the start, so they don't fill it in by hand. The student's current
// job title becomes the keywords, their city the place, and their country the country. Whatever the
// resume doesn't give is left empty for them to add; the Job agent section asks for it.

/** Longest a seeded keywords or place field is, matching the search query schema's own cap. */
const MAX = 200;

const clean = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX);

/**
 * What of the Job agent search a resume can fill, as a patch over the student's current query.
 * Only a field the query doesn't already have is filled, so a student's own typing is never
 * overwritten, and only when the resume gives a value — the rest stays empty. Keywords come from
 * the most recent role's title (a clean search term), or the headline when there's no role.
 */
export function seedAgentQuery(current: SearchQuery, profile: ImportedProfile): Partial<SearchQuery> {
  const patch: Partial<SearchQuery> = {};

  if (!current.keywords.trim()) {
    const keywords = clean(profile.experience[0]?.role) || clean(profile.basics.headline);
    if (keywords) patch.keywords = keywords;
  }

  if (!current.place.trim()) {
    const place = clean(profile.basics.city);
    if (place) patch.place = place;
  }

  if (!current.country) {
    const country = countryCodeFor(profile.basics.country ?? "");
    if (country) patch.country = country;
  }

  return patch;
}
