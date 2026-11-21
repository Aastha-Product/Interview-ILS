// Companies the student never wants to see (Phase 1): the job agent leaves their postings out
// before scoring them, and the Agent screen hides ones already scored.

/** The most companies a blocklist keeps, and the longest name in it. */
export const BLOCKLIST_MAX_ENTRIES = 100;
export const BLOCKLIST_MAX_LENGTH = 100;

// Legal forms, so "Infosys Ltd" and "Infosys Limited" read as the same company.
const LEGAL_FORMS = new Set(["pvt", "private", "ltd", "limited", "inc", "incorporated", "llc", "llp", "corp", "corporation", "co", "gmbh", "plc"]);

/** A company name compared loosely: lower case, no accents or punctuation, no legal form. */
export function normalizeCompany(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join(" ");
}

/**
 * Whether a posting's company is on the blocklist: an entry matches when its words appear, whole,
 * in the company's name. "Infosys" leaves out "Infosys BPM Limited" but not "Infosystems".
 */
export function isBlocked(company: string, blocklist: readonly string[]): boolean {
  const name = normalizeCompany(company);
  if (!name) return false;
  const padded = ` ${name} `;
  return blocklist.some((entry) => {
    const term = normalizeCompany(entry);
    return term !== "" && padded.includes(` ${term} `);
  });
}

/** A blocklist as typed: one company per line or comma, trimmed, each once, in the order given. */
export function parseBlocklist(text: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const entry = raw.trim().slice(0, BLOCKLIST_MAX_LENGTH);
    const key = normalizeCompany(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length === BLOCKLIST_MAX_ENTRIES) break;
  }
  return entries;
}
