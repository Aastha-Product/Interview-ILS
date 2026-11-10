import { countryCodeFor, COUNTRIES } from "@/lib/job-search/countries";

// Pathfinder (auto-apply step 2): which countries a job is in, from what the board says, and
// whether a company's job is worth keeping for our students.

// Indian cities job boards write without the country ("Bengaluru", "Gurgaon").
const INDIAN_CITIES = [
  "bengaluru", "bangalore", "mumbai", "navi mumbai", "pune", "hyderabad", "secunderabad", "chennai", "gurgaon", "gurugram",
  "noida", "greater noida", "new delhi", "delhi", "kolkata", "ahmedabad", "kochi", "cochin", "jaipur", "chandigarh", "mohali",
  "coimbatore", "indore", "thiruvananthapuram", "trivandrum", "mysore", "mysuru", "nagpur", "vadodara", "bhubaneswar",
  "visakhapatnam", "lucknow", "goa", "surat", "mangalore", "mangaluru",
];

// Words that say a remote job is open everywhere, or in our region.
const ANYWHERE = /\b(anywhere|worldwide|global(ly)?|international|apac|asia|asia[- ]pacific|south asia)\b/i;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

let patterns: { code: string; pattern: RegExp }[] | undefined;

/** Country names (four letters or more, so "Chad" but not "UK") and Indian cities as word patterns. */
function countryPatterns() {
  if (patterns) return patterns;
  const escape = (name: string) => fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  patterns = COUNTRIES.filter((country) => fold(country.name).length >= 4).map((country) => ({
    code: country.code,
    pattern: new RegExp(`\\b${escape(country.name)}\\b`),
  }));
  patterns.push({ code: "in", pattern: new RegExp(`\\b(${INDIAN_CITIES.map(escape).join("|")})\\b`) });
  // Short forms boards write in a place ("Remote - US"); a place field rarely holds the word "us" otherwise.
  patterns.push({ code: "us", pattern: /\b(us|usa|united states)\b/ });
  patterns.push({ code: "gb", pattern: /\b(uk|united kingdom|london)\b/ });
  patterns.push({ code: "ae", pattern: /\b(uae|dubai)\b/ });
  return patterns;
}

/** The countries a place names: "Bengaluru, Karnataka" gives ["in"]; "Remote - US or India" gives ["us", "in"]. */
export function countriesIn(place: string): string[] {
  const text = fold(place);
  if (!text) return [];
  return [...new Set(countryPatterns().filter(({ pattern }) => pattern.test(text)).map(({ code }) => code))];
}

/** An ISO code from a board's country field: "IN", "in", "India" all give "in"; "" when it isn't one. */
export function countryCode(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (/^[a-z]{2}$/i.test(text)) return text.toLowerCase();
  return text ? countryCodeFor(text) : "";
}

/**
 * Whether a company's job is worth keeping: it's in one of the countries the company is crawled
 * for, or it's remote and open everywhere or in our region. A plain "Remote" from a US company
 * usually means remote in the US, so it isn't kept.
 */
export function relevant(job: { countries: string[]; remote: boolean | null; location: string }, targets: readonly string[]): boolean {
  if (job.countries.some((code) => targets.includes(code))) return true;
  return job.remote === true && job.countries.length === 0 && ANYWHERE.test(job.location);
}
