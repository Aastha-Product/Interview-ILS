import { createHash } from "node:crypto";

import { parse } from "node-html-parser";

// Pathfinder (auto-apply step 2): job descriptions from boards' HTML as plain text, keeping the
// paragraphs and list items a person (and the matcher) reads by.

export const MAX_DESCRIPTION = 100_000;

/** "<p>One</p><ul><li>Two</li></ul>" becomes "One\n\n- Two". */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const marked = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*li\s*>/gi, "")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|section|tr|table)\s*>/gi, "\n\n");
  return tidy(parse(marked).text);
}

/** Greenhouse sends its HTML escaped once more ("&lt;p&gt;"). */
export function escapedHtmlToText(escaped: string | null | undefined): string {
  if (!escaped) return "";
  return htmlToText(parse(escaped).text);
}

/** Spaces and blank lines tidied, at most MAX_DESCRIPTION characters. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

/** Lower case, letters and digits only, accents dropped. */
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The same job from another source or board matches: company, title and place, hashed. */
export function dedupeKey(job: { companyName: string; title: string; location: string }): string {
  return hash(`job:${normal(job.companyName)}|${normal(job.title)}|${normal(job.location)}`);
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
