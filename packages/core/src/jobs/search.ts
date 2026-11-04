import type { ScopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import {
  FeedError,
  normaliseLocation,
  normaliseQuery,
  type FeedAdapter,
  type JobSourceName,
} from "@pathfinder/feeds";
import type { ServerConfig } from "../config";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { incrementUsage, istDay } from "../usage";
import { saveListing } from "./listings";

export interface JobListingSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  source: JobSourceName;
  applyUrl: string | null;
  postedAt: string | null;
}

export interface SearchJobsResult {
  listings: JobListingSummary[];
  /** True when every source was answered from the 24-hour cache (no feed was called). */
  fromCache: boolean;
  /** Plain-English messages for the student (sample data, a source being down, budget reached). */
  notices: string[];
}

export interface SearchJobsDeps {
  db: ScopedDb;
  adapters: FeedAdapter[];
  config: Pick<ServerConfig, "JSEARCH_DAILY_BUDGET" | "ADZUNA_DAILY_BUDGET" | "SEARCH_COOLDOWN_SECONDS" | "SEARCH_CACHE_HOURS">;
  now?: () => Date;
}

const LABEL: Record<FeedAdapter["source"], string> = { jsearch: "JSearch", adzuna: "Adzuna" };

export function feedCacheKey(source: FeedAdapter["source"], query: string, location: string): string {
  return `${source}|${normaliseQuery(query)}|${normaliseLocation(location)}|1`;
}

/**
 * Atomically takes one request from a source's daily budget (India time). Returns false when the
 * budget is used up. The WHERE on the conflict update makes the check and increment one statement.
 */
async function takeBudget(source: FeedAdapter["source"], budget: number, now: Date): Promise<boolean> {
  if (budget <= 0) return false;
  const day = istDay(now);
  const rows = await getPrisma().$queryRaw<Array<{ requests: number }>>`
    INSERT INTO "FeedBudget" ("id", "source", "day", "requests", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${source}::"JobSource", ${day}::date, 1, now(), now())
    ON CONFLICT ("source", "day") DO UPDATE
      SET "requests" = "FeedBudget"."requests" + 1, "updatedAt" = now()
      WHERE "FeedBudget"."requests" < ${budget}
    RETURNING "requests"`;
  return rows.length === 1;
}

/**
 * Searches every configured feed for one student, using the shared 24-hour cache first.
 *
 * Live (keyed) feeds are protected twice: one live search per student per cooldown period, and a
 * global daily request budget per feed. Fixture feeds (no keys) skip both. Every result is stored
 * through saveListing, so the same job from two sources appears once.
 */
export async function searchJobs(deps: SearchJobsDeps, input: { query: string; location?: string }): Promise<SearchJobsResult> {
  const now = deps.now ?? (() => new Date());
  const query = (input.query ?? "").trim().replace(/\s+/g, " ");
  const location = (input.location ?? "").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 100) {
    throw new UserFacingError("INVALID_QUERY", "Type a job title or skill to search for, for example “software tester”.", 400);
  }
  if (location.length > 100) {
    throw new UserFacingError("INVALID_LOCATION", "Keep the location under 100 characters, for example “Pune”.", 400);
  }

  const prisma = getPrisma();
  const log = getLogger().child({ op: "jobs.search" });
  const notices: string[] = [];
  const idsBySource: string[][] = [];
  const toCall: FeedAdapter[] = [];
  let cacheHits = 0;

  for (const adapter of deps.adapters) {
    const cached = await prisma.feedCache.findUnique({ where: { cacheKey: feedCacheKey(adapter.source, query, location) } });
    if (cached && cached.expiresAt > now()) {
      idsBySource.push(cached.listingIds);
      cacheHits++;
    } else {
      toCall.push(adapter);
    }
  }

  // Per-student cooldown, for live feeds only.
  let callable = toCall;
  if (toCall.some((a) => a.live)) {
    const cooldownMs = deps.config.SEARCH_COOLDOWN_SECONDS * 1000;
    const last = await deps.db.feedSearch.findFirst({
      where: { liveCalls: { gt: 0 }, createdAt: { gt: new Date(now().getTime() - cooldownMs) } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last) {
      const retryAfterSeconds = Math.max(1, Math.ceil((last.createdAt.getTime() + cooldownMs - now().getTime()) / 1000));
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      if (cacheHits === 0 && toCall.every((a) => a.live)) {
        throw new UserFacingError(
          "SEARCH_COOLDOWN",
          `You can run a new search in about ${minutes} minute${minutes === 1 ? "" : "s"}. Results you've already searched are still available.`,
          429,
          retryAfterSeconds,
        );
      }
      callable = toCall.filter((a) => !a.live);
      notices.push(`Showing saved results. You can run a fresh search in about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
  }

  let liveCalls = 0;
  let failures = 0;
  for (const adapter of callable) {
    if (adapter.live) {
      const budget = adapter.source === "jsearch" ? deps.config.JSEARCH_DAILY_BUDGET : deps.config.ADZUNA_DAILY_BUDGET;
      if (!(await takeBudget(adapter.source, budget, now()))) {
        notices.push(`${LABEL[adapter.source]} has reached today's search limit. Try again tomorrow, or paste a job link instead.`);
        continue;
      }
      liveCalls++;
    }
    let jobs;
    try {
      jobs = (await adapter.search({ query, location })).jobs;
    } catch (error) {
      failures++;
      log.warn({ source: adapter.source, kind: error instanceof FeedError ? error.kind : "unknown" }, "feed search failed");
      notices.push(`We couldn't reach ${LABEL[adapter.source]} just now, so its jobs are missing from these results.`);
      continue;
    }
    const ids: string[] = [];
    for (const job of jobs) {
      const listing = await saveListing(job, { now: now() });
      if (!ids.includes(listing.id)) ids.push(listing.id);
    }
    const cacheKey = feedCacheKey(adapter.source, query, location);
    const expiresAt = new Date(now().getTime() + deps.config.SEARCH_CACHE_HOURS * 60 * 60 * 1000);
    await prisma.feedCache.upsert({
      where: { cacheKey },
      create: { cacheKey, source: adapter.source, listingIds: ids, expiresAt },
      update: { listingIds: ids, expiresAt },
    });
    idsBySource.push(ids);
  }

  if (failures > 0 && failures === callable.length && cacheHits === 0) {
    throw new UserFacingError(
      "FEEDS_UNAVAILABLE",
      "Job search isn't available right now. Try again in a few minutes, or paste a job link or description instead.",
      503,
    );
  }
  if (deps.adapters.some((a) => !a.live)) {
    notices.push("These are sample jobs for testing. Live job feeds aren't connected yet.");
  }

  const orderedIds = [...new Set(idsBySource.flat())];
  const rows = orderedIds.length
    ? await prisma.jobListing.findMany({ where: { id: { in: orderedIds }, closedAt: null } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const listings: JobListingSummary[] = orderedIds.flatMap((id) => {
    const r = byId.get(id);
    return r
      ? [{
          id: r.id,
          title: r.title,
          company: r.company,
          location: r.location,
          remote: r.remote,
          source: r.source,
          applyUrl: r.applyUrl,
          postedAt: r.postedAt?.toISOString() ?? null,
        }]
      : [];
  });

  await deps.db.feedSearch.create({
    data: { userId: deps.db.userId, query, location, liveCalls, resultCount: listings.length, createdAt: now() },
  });
  await incrementUsage(deps.db, "searches", now());

  return { listings, fromCache: cacheHits > 0 && callable.length === 0, notices };
}
