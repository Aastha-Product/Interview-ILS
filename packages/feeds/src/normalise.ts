/** Query parameters that only track clicks; removing them lets the same posting match across links. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^(gclid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|si)$/i,
  /^(ref|refid|referrer|source|src|trk|trkinfo|tracking|trackingid|campaign|cmp|lipi|origin|from|share|sharedid|recommendedflavor|refid)$/i,
];

/**
 * Canonical form of a job URL: https, lower-case host without "www.", no fragment, no tracking
 * parameters, remaining parameters sorted, no trailing slash. Returns null for non-web URLs.
 */
export function normaliseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.port === "443" || url.port === "80") url.port = "";
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.some((re) => re.test(key)))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  let out = url.toString();
  if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
  return out;
}

const COMPANY_SUFFIXES =
  /\b(private limited|pvt\.? ltd\.?|pvt|limited|ltd\.?|llp|inc\.?|incorporated|corp\.?|corporation|co\.?|plc|gmbh)\s*$/i;

const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  gurgaon: "gurugram",
  bombay: "mumbai",
  madras: "chennai",
  calcutta: "kolkata",
  "new delhi": "delhi",
  trivandrum: "thiruvananthapuram",
  cochin: "kochi",
  poona: "pune",
  mysore: "mysuru",
  vizag: "visakhapatnam",
  baroda: "vadodara",
};

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export function normaliseCompany(company: string): string {
  let c = words(company);
  for (let i = 0; i < 3; i++) c = c.replace(COMPANY_SUFFIXES, "").trim();
  return c;
}

export function normaliseTitle(title: string): string {
  return words(title.replace(/\((?:[^)]*)\)/g, " ")); // drop "(Fresher)", "(Remote)" and similar
}

/** The first city in a location string, with common old/alternate names mapped to one spelling. */
export function normaliseLocation(location: string): string {
  const first = words(location.split(/[,/|]/)[0] ?? "");
  return CITY_ALIASES[first] ?? first;
}

/** company|title|city. Two postings with the same key within 30 days are treated as one job. */
export function dedupeKey(job: { company: string; title: string; location: string }): string {
  return `${normaliseCompany(job.company)}|${normaliseTitle(job.title)}|${normaliseLocation(job.location)}`;
}

/** Normalised search inputs, so "QA  Tester" and "qa tester" share a cache entry. */
export function normaliseQuery(text: string): string {
  return words(text);
}
