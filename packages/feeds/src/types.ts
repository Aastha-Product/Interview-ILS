/** The common shape every job source is converted to before it is stored as a JobListing. */
export type JobSourceName = "jsearch" | "adzuna" | "manual";

export interface NormalizedJob {
  source: JobSourceName;
  /** The source's own id. For pasted jobs: a hash of the normalised URL, or of the text. */
  sourceId: string;
  title: string;
  company: string;
  /** City and state as a display string, e.g. "Pune, Maharashtra". Empty if unknown. */
  location: string;
  remote: boolean;
  /** e.g. "Full-time", "Internship". Empty if unknown. */
  employmentType: string;
  /** Plain text. Untrusted: only ever passed to the model inside an untrusted-data block. */
  description: string;
  /** Canonical page for the posting (used for urlNormalised and dedupe). */
  url: string | null;
  /** Where the student applies. Adzuna requires its redirect_url here. */
  applyUrl: string | null;
  postedAt: Date | null;
  closesAt: Date | null;
  /** The original record, kept for debugging. Never shown to the model. */
  raw: unknown;
}

export interface FeedSearchParams {
  query: string;
  location: string;
  /** Opaque page token from a previous call (JSearch cursor or Adzuna page number). */
  page?: string;
}

export interface FeedSearchResult {
  jobs: NormalizedJob[];
  nextPage?: string;
}

/** One adapter per licensed source. No adapter may crawl or scrape: only documented API calls. */
export interface FeedAdapter {
  readonly source: Exclude<JobSourceName, "manual">;
  /** True when this adapter will make live calls (keys present). Fixture adapters return false. */
  readonly live: boolean;
  search(params: FeedSearchParams, signal?: AbortSignal): Promise<FeedSearchResult>;
}
