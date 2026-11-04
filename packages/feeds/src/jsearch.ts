import { z } from "zod";
import { FeedError, getJson, parseDate, type FetchLike } from "./errors";
import type { FeedAdapter, FeedSearchParams, FeedSearchResult, NormalizedJob } from "./types";

/**
 * JSearch v5 (Google for Jobs aggregate) via RapidAPI: GET https://jsearch.p.rapidapi.com/search-v2.
 * Each page of up to 10 jobs costs one request credit; we always ask for one page.
 */
export const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const ENDPOINT = `https://${JSEARCH_HOST}/search-v2`;

const nullableString = z.string().nullish();

const jobSchema = z.looseObject({
  job_id: z.string().min(1),
  job_title: z.string().min(1),
  employer_name: z.string().min(1),
  job_publisher: nullableString,
  job_employment_type: nullableString,
  job_employment_types: z.array(z.string()).nullish(),
  job_apply_link: nullableString,
  apply_options: z
    .array(z.looseObject({ apply_link: nullableString, is_direct: z.boolean().nullish(), publisher: nullableString }))
    .nullish(),
  job_description: nullableString,
  job_is_remote: z.boolean().nullish(),
  job_posted_at_datetime_utc: nullableString,
  job_offer_expiration_datetime_utc: nullableString,
  job_location: nullableString,
  job_city: nullableString,
  job_state: nullableString,
  job_country: nullableString,
  job_google_link: nullableString,
});

const responseSchema = z.looseObject({
  status: z.string().optional(),
  data: z.looseObject({
    jobs: z.array(z.unknown()),
    cursor: z.string().nullish(),
  }),
});

type JSearchJob = z.infer<typeof jobSchema>;

const EMPLOYMENT_TYPES: Record<string, string> = {
  FULLTIME: "Full-time",
  PARTTIME: "Part-time",
  CONTRACTOR: "Contract",
  INTERN: "Internship",
};

export function mapJSearchJob(job: JSearchJob): NormalizedJob {
  const location =
    [job.job_city, job.job_state].filter((s): s is string => Boolean(s?.trim())).join(", ") ||
    job.job_location?.trim() ||
    "";
  const direct = job.apply_options?.find((o) => o.is_direct && o.apply_link)?.apply_link;
  const applyUrl = direct ?? job.job_apply_link ?? job.apply_options?.find((o) => o.apply_link)?.apply_link ?? null;
  const employmentType =
    job.job_employment_type?.trim() ||
    (job.job_employment_types?.[0] ? (EMPLOYMENT_TYPES[job.job_employment_types[0]] ?? "") : "");
  return {
    source: "jsearch",
    sourceId: job.job_id,
    title: job.job_title.trim(),
    company: job.employer_name.trim(),
    location,
    remote: job.job_is_remote === true,
    employmentType,
    description: (job.job_description ?? "").trim(),
    url: job.job_apply_link ?? job.job_google_link ?? applyUrl,
    applyUrl,
    postedAt: parseDate(job.job_posted_at_datetime_utc),
    closesAt: parseDate(job.job_offer_expiration_datetime_utc),
    raw: job,
  };
}

/** Parses a search-v2 response. Individual malformed jobs are skipped rather than failing the search. */
export function parseJSearchResponse(body: unknown): FeedSearchResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new FeedError("jsearch", "bad_response");
  const jobs: NormalizedJob[] = [];
  for (const item of parsed.data.data.jobs) {
    const job = jobSchema.safeParse(item);
    if (job.success) jobs.push(mapJSearchJob(job.data));
  }
  return { jobs, nextPage: parsed.data.data.cursor ?? undefined };
}

export interface JSearchOptions {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Two-letter country code. India by default. */
  country?: string;
}

export function createJSearchAdapter({ apiKey, fetch: fetchImpl = fetch, timeoutMs = 15_000, country = "in" }: JSearchOptions): FeedAdapter {
  return {
    source: "jsearch",
    live: true,
    async search({ query, location, page }: FeedSearchParams, signal?: AbortSignal) {
      const params = new URLSearchParams({
        // JSearch recommends putting the place in the query text.
        query: location.trim() ? `${query.trim()} in ${location.trim()}` : query.trim(),
        country,
        num_pages: "1",
        date_posted: "month",
        job_requirements: "no_experience,under_3_years_experience",
      });
      if (page) params.set("cursor", page);
      const body = await getJson(
        "jsearch",
        fetchImpl,
        `${ENDPOINT}?${params.toString()}`,
        { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": JSEARCH_HOST, accept: "application/json" } },
        timeoutMs,
        signal,
      );
      return parseJSearchResponse(body);
    },
  };
}
