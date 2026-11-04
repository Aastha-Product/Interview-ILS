/**
 * Reads a job posting out of a fetched page. Prefers schema.org JobPosting (JSON-LD), which most
 * career sites publish for Google for Jobs; falls back to the page's visible text.
 * Everything returned is untrusted text: it only reaches the model inside an untrusted-data block.
 */

export interface ParsedPosting {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  employmentType: string;
  description: string;
  postedAt: Date | null;
  closesAt: Date | null;
  via: "json-ld" | "html";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
  rupee: "₹",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Visible text of an HTML fragment, keeping paragraph and list structure as line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

type Json = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function findJobPosting(node: unknown): Json | null {
  for (const item of asArray(node)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Json;
    const types = asArray(obj["@type"] as string | string[]).map((t) => String(t).toLowerCase());
    if (types.includes("jobposting")) return obj;
    const nested = findJobPosting(obj["@graph"]) ?? findJobPosting(obj["mainEntity"]);
    if (nested) return nested;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function locationOf(posting: Json): string {
  const places = asArray(posting.jobLocation as Json | Json[]);
  const names = places
    .map((p) => {
      const address = (p?.address ?? {}) as Json;
      if (typeof p?.address === "string") return str(p.address);
      return [str(address.addressLocality), str(address.addressRegion)].filter(Boolean).join(", ");
    })
    .filter(Boolean);
  return [...new Set(names)].slice(0, 3).join(" / ");
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim() : "";
}

export function parsePostingHtml(html: string, pageUrl: string): ParsedPosting {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, content] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(content!.trim());
    } catch {
      continue;
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    const org = asArray(posting.hiringOrganization as Json | Json[])[0];
    const description = htmlToText(decodeEntities(str(posting.description)));
    if (description.length < 50) continue;
    return {
      title: decodeEntities(str(posting.title)),
      company: decodeEntities(typeof org === "string" ? org : str(org?.name)),
      location: locationOf(posting),
      remote: str(posting.jobLocationType).toUpperCase() === "TELECOMMUTE",
      employmentType: asArray(posting.employmentType as string | string[]).map(str).filter(Boolean).join(", "),
      description,
      postedAt: parseDate(posting.datePosted),
      closesAt: parseDate(posting.validThrough),
      via: "json-ld",
    };
  }

  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? html;
  const title =
    metaContent(html, "og:title") || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const company = metaContent(html, "og:site_name") || new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    title,
    company,
    location: "",
    remote: false,
    employmentType: "",
    description: htmlToText(main),
    postedAt: null,
    closesAt: null,
    via: "html",
  };
}
