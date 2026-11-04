import { z } from "zod";
import { FeedError, getJson, parseDate, stripHtml, type FetchLike } from "./errors";
import type { FeedAdapter, FeedSearchParams, FeedSearchResult, NormalizedJob } from "./types";

/**
 * Adzuna: GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}.
 * Descriptions are snippets only. Adzuna's terms require all traffic to go through its
 * redirect_url, so that is both the posting URL and the apply link, and each displayed ad must be
 * labelled and linked "Adzuna" (done in the UI).
 */
const ROOT = "https://api.adzuna.com/v1/api/jobs";
const RESULTS_PER_PAGE = 10;

const nullableString = z.string().nullish();

const resultSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number()]),
  title: z.string().min(1),
  description: nullableString,
  created: nullableString,
  redirect_url: z.string().min(1),
  company: z.looseObject({ display_name: nullableString }).nullish(),
  location: z.looseObject({ display_name: nullableString, area: z.array(z.string()).nullish() }).nullish(),
  contract_time: nullableString,
  contract_type: nullableString,
  category: z.looseObject({ label: nullableString }).nullish(),
});

const responseSchema = z.looseObject({
  results: z.array(z.unknown()),
  count: z.number().optional(),
});

type AdzunaResult = z.infer<typeof resultSchema>;

const CONTRACT_TIME: Record<string, string> = { full_time: "Full-time", part_time: "Part-time" };
const CONTRACT_TYPE: Record<string, string> = { permanent: "Permanent", contract: "Contract" };

export function mapAdzunaResult(result: AdzunaResult): NormalizedJob | null {
  const company = result.company?.display_name?.trim();
  if (!company) return null;
  const title = stripHtml(result.title);
  const description = stripHtml(result.description ?? "");
  const location =
    result.location?.display_name?.trim() || result.location?.area?.slice(-2).reverse().join(", ") || "";
  const employmentType = [
    result.contract_time ? CONTRACT_TIME[result.contract_time] : undefined,
    result.contract_type ? CONTRACT_TYPE[result.contract_type] : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    source: "adzuna",
    sourceId: String(result.id),
    title,
    company,
    location,
    remote: /\b(remote|work from home|wfh)\b/i.test(`${title} ${location}`),
    employmentType,
    description,
    url: result.redirect_url,
    applyUrl: result.redirect_url,
    postedAt: parseDate(result.created),
    closesAt: null,
    raw: result,
  };
}

export function parseAdzunaResponse(body: unknown, page: number): FeedSearchResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new FeedError("adzuna", "bad_response");
  const jobs: NormalizedJob[] = [];
  for (const item of parsed.data.results) {
    const result = resultSchema.safeParse(item);
    if (!result.success) continue;
    const job = mapAdzunaResult(result.data);
    if (job) jobs.push(job);
  }
  const more = parsed.data.results.length >= RESULTS_PER_PAGE;
  return { jobs, nextPage: more ? String(page + 1) : undefined };
}

export interface AdzunaOptions {
  appId: string;
  appKey: string;
  /** Two-letter country code used in the path, e.g. "in". */
  country: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createAdzunaAdapter({ appId, appKey, country, fetch: fetchImpl = fetch, timeoutMs = 15_000 }: AdzunaOptions): FeedAdapter {
  return {
    source: "adzuna",
    live: true,
    async search({ query, location, page }: FeedSearchParams, signal?: AbortSignal) {
      const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        what: query.trim(),
        results_per_page: String(RESULTS_PER_PAGE),
        "content-type": "application/json",
      });
      if (location.trim()) params.set("where", location.trim());
      const body = await getJson(
        "adzuna",
        fetchImpl,
        `${ROOT}/${encodeURIComponent(country.toLowerCase())}/search/${pageNumber}?${params.toString()}`,
        { headers: { accept: "application/json" } },
        timeoutMs,
        signal,
      );
      return parseAdzunaResponse(body, pageNumber);
    },
  };
}
