export type { FeedAdapter, FeedSearchParams, FeedSearchResult, JobSourceName, NormalizedJob } from "./types";
export {
  dedupeKey,
  normaliseCompany,
  normaliseLocation,
  normaliseQuery,
  normaliseTitle,
  normaliseUrl,
} from "./normalise";
export { FeedError, stripHtml } from "./errors";
export type { FeedErrorKind, FetchLike } from "./errors";
export { createJSearchAdapter, parseJSearchResponse, JSEARCH_HOST } from "./jsearch";
export type { JSearchOptions } from "./jsearch";
export { createAdzunaAdapter, parseAdzunaResponse } from "./adzuna";
export type { AdzunaOptions } from "./adzuna";
export { createFixtureAdapter, createFeedAdapters } from "./fixtures";
export type { FeedsConfig } from "./fixtures";
