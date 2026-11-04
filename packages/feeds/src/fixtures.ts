import adzunaFixture from "../fixtures/adzuna-search.json";
import jsearchFixture from "../fixtures/jsearch-search-v2.json";
import { createAdzunaAdapter } from "./adzuna";
import { createJSearchAdapter } from "./jsearch";
import { normaliseLocation, normaliseQuery } from "./normalise";
import type { FeedAdapter, NormalizedJob } from "./types";

/**
 * Recorded-shape responses used whenever a feed's keys are not configured (development, tests,
 * CI). They go through the same parsing and mapping code as live responses, via a fake fetch.
 */
const FIXTURES = { jsearch: jsearchFixture, adzuna: adzunaFixture } as const;

const STOPWORDS = new Set(["in", "jobs", "job", "for", "the", "and", "a", "an", "of", "at", "role", "roles", "near", "me"]);

const fixtureFetch = (body: unknown) => async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Keeps jobs that mention any query word, in the requested city or remote, so dev search feels real. */
function matches(job: NormalizedJob, query: string, location: string): boolean {
  const words = normaliseQuery(query)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const haystack = normaliseQuery(`${job.title} ${job.description}`);
  const wordOk = words.length === 0 || words.some((w) => haystack.includes(w));
  const city = normaliseLocation(location);
  const locationOk = !city || job.remote || normaliseLocation(job.location) === city;
  return wordOk && locationOk;
}

export function createFixtureAdapter(source: "jsearch" | "adzuna"): FeedAdapter {
  const fetch = fixtureFetch(FIXTURES[source]);
  const inner =
    source === "jsearch"
      ? createJSearchAdapter({ apiKey: "fixture", fetch })
      : createAdzunaAdapter({ appId: "fixture", appKey: "fixture", country: "in", fetch });
  return {
    source,
    live: false,
    async search(params, signal) {
      const result = await inner.search({ ...params, page: undefined }, signal);
      return { jobs: result.jobs.filter((job) => matches(job, params.query, params.location)) };
    },
  };
}

export interface FeedsConfig {
  JSEARCH_API_KEY?: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  ADZUNA_COUNTRY: string;
}

/** Live adapters where keys are configured, recorded fixtures otherwise. JSearch first. */
export function createFeedAdapters(config: FeedsConfig): FeedAdapter[] {
  return [
    config.JSEARCH_API_KEY ? createJSearchAdapter({ apiKey: config.JSEARCH_API_KEY }) : createFixtureAdapter("jsearch"),
    config.ADZUNA_APP_ID && config.ADZUNA_APP_KEY
      ? createAdzunaAdapter({ appId: config.ADZUNA_APP_ID, appKey: config.ADZUNA_APP_KEY, country: config.ADZUNA_COUNTRY })
      : createFixtureAdapter("adzuna"),
  ];
}
