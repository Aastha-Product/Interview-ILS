import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { createFixtureAdapter, FeedError, type FeedAdapter, type NormalizedJob } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { UserFacingError } from "../src/errors";
import { searchJobs, type SearchJobsDeps } from "../src/jobs/search";
import { istDay } from "../src/usage";

const config = { JSEARCH_DAILY_BUDGET: 6, ADZUNA_DAILY_BUDGET: 50, SEARCH_COOLDOWN_SECONDS: 300, SEARCH_CACHE_HOURS: 24 };

let aliceId: string;
let bobId: string;
let clock: Date;
const now = () => clock;

function counting(adapter: FeedAdapter) {
  let calls = 0;
  const wrapped: FeedAdapter & { calls: () => number } = {
    source: adapter.source,
    live: adapter.live,
    async search(params, signal) {
      calls++;
      return adapter.search(params, signal);
    },
    calls: () => calls,
  };
  return wrapped;
}

function job(source: "jsearch" | "adzuna", n: number, extra: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source,
    sourceId: `${source}-${n}`,
    title: `Tester ${n}`,
    company: `Company ${n}`,
    location: "Pune",
    remote: false,
    employmentType: "Full-time",
    description: "Manual testing",
    url: `https://jobs.example/${source}/${n}`,
    applyUrl: `https://jobs.example/${source}/${n}`,
    postedAt: null,
    closesAt: null,
    raw: {},
    ...extra,
  };
}

/** A keyed (live) adapter that returns fixed jobs, or fails. */
function liveFake(source: "jsearch" | "adzuna", jobs: NormalizedJob[] | Error) {
  return counting({
    source,
    live: true,
    async search() {
      if (jobs instanceof Error) throw jobs;
      return { jobs };
    },
  });
}

function deps(userId: string, adapters: FeedAdapter[], overrides: Partial<typeof config> = {}): SearchJobsDeps {
  return { db: scopedDb(userId), adapters, config: { ...config, ...overrides }, now };
}

beforeEach(async () => {
  await resetDatabase();
  await getPrisma().$executeRawUnsafe('TRUNCATE TABLE "FeedCache", "FeedBudget"');
  aliceId = (await createUser("alice@example.test")).id;
  bobId = (await createUser("bob@example.test")).id;
  clock = new Date("2026-11-04T06:00:00Z");
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("searchJobs with fixture feeds (no keys)", () => {
  it("shows the same job from both sources once and labels the results as samples", async () => {
    const result = await searchJobs(deps(aliceId, [createFixtureAdapter("jsearch"), createFixtureAdapter("adzuna")]), {
      query: "QA engineer",
      location: "Bengaluru",
    });
    const exampleSoftech = result.listings.filter((l) => l.company.startsWith("Example Softech"));
    expect(exampleSoftech).toHaveLength(1);
    expect(new Set(result.listings.map((l) => l.id)).size).toBe(result.listings.length);
    expect(result.fromCache).toBe(false);
    expect(result.notices.join(" ")).toMatch(/sample jobs/i);
  });

  it("answers a repeat search from the cache without calling the feeds", async () => {
    const js = counting(createFixtureAdapter("jsearch"));
    const az = counting(createFixtureAdapter("adzuna"));
    const first = await searchJobs(deps(aliceId, [js, az]), { query: "data analyst", location: "Pune" });
    const second = await searchJobs(deps(aliceId, [js, az]), { query: "  Data   Analyst ", location: "pune" });
    expect(js.calls()).toBe(1);
    expect(az.calls()).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.listings.map((l) => l.id)).toEqual(first.listings.map((l) => l.id));
  });

  it("calls the feeds again once the cache has expired", async () => {
    const js = counting(createFixtureAdapter("jsearch"));
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "" });
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    const again = await searchJobs(deps(aliceId, [js]), { query: "tester", location: "" });
    expect(js.calls()).toBe(2);
    expect(again.fromCache).toBe(false);
  });

  it("rejects a too-short query with a plain-English message", async () => {
    const error = await searchJobs(deps(aliceId, [createFixtureAdapter("jsearch")]), { query: " a ", location: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).status).toBe(400);
  });
});

describe("searchJobs with live feeds", () => {
  it("allows one live search per student per cooldown, with Retry-After", async () => {
    const js = liveFake("jsearch", [job("jsearch", 1)]);
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "Pune" });
    clock = new Date(clock.getTime() + 60_000);
    const error = await searchJobs(deps(aliceId, [js]), { query: "developer", location: "Pune" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).status).toBe(429);
    expect((error as UserFacingError).code).toBe("SEARCH_COOLDOWN");
    expect((error as UserFacingError).retryAfterSeconds).toBe(240);
    expect((error as UserFacingError).message).toMatch(/about 4 minutes/);
    expect(js.calls()).toBe(1);

    // Cached searches are still allowed during the cooldown.
    const cached = await searchJobs(deps(aliceId, [js]), { query: "tester", location: "Pune" });
    expect(cached.fromCache).toBe(true);

    // After the cooldown a new live search works.
    clock = new Date(clock.getTime() + 5 * 60_000);
    await searchJobs(deps(aliceId, [js]), { query: "developer", location: "Pune" });
    expect(js.calls()).toBe(2);
  });

  it("serves the cached source and skips the live call when one source is cached during the cooldown", async () => {
    const js = liveFake("jsearch", [job("jsearch", 1)]);
    const az = liveFake("adzuna", [job("adzuna", 2)]);
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "" });
    clock = new Date(clock.getTime() + 30_000);
    const result = await searchJobs(deps(aliceId, [js, az]), { query: "tester", location: "" });
    expect(az.calls()).toBe(0);
    expect(result.listings).toHaveLength(1);
    expect(result.notices.join(" ")).toMatch(/fresh search in about/);
  });

  it("keeps each student's cooldown separate", async () => {
    const js = liveFake("jsearch", [job("jsearch", 1)]);
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "" });
    await expect(searchJobs(deps(bobId, [js]), { query: "developer", location: "" })).resolves.toBeTruthy();
    expect(js.calls()).toBe(2);
  });

  it("stops calling a feed once its global daily budget is used", async () => {
    const js = liveFake("jsearch", [job("jsearch", 1)]);
    await searchJobs(deps(aliceId, [js], { JSEARCH_DAILY_BUDGET: 1 }), { query: "tester", location: "" });
    const result = await searchJobs(deps(bobId, [js], { JSEARCH_DAILY_BUDGET: 1 }), { query: "developer", location: "" });
    expect(js.calls()).toBe(1);
    expect(result.listings).toEqual([]);
    expect(result.notices.join(" ")).toMatch(/today's search limit/);
    const budget = await getPrisma().feedBudget.findUnique({ where: { source_day: { source: "jsearch", day: istDay(clock) } } });
    expect(budget?.requests).toBe(1);
  });

  it("keeps working when one source fails, and fails clearly when all do", async () => {
    const broken = liveFake("adzuna", new FeedError("adzuna", "server", 502));
    const ok = liveFake("jsearch", [job("jsearch", 1)]);
    const partial = await searchJobs(deps(aliceId, [ok, broken]), { query: "tester", location: "" });
    expect(partial.listings).toHaveLength(1);
    expect(partial.notices.join(" ")).toMatch(/couldn't reach Adzuna/);

    const error = await searchJobs(deps(bobId, [broken]), { query: "analyst", location: "" }).catch((e: unknown) => e);
    expect((error as UserFacingError).status).toBe(503);
  });

  it("records each search and adds to the student's daily usage", async () => {
    const js = liveFake("jsearch", [job("jsearch", 1), job("jsearch", 2)]);
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "Pune" });
    await searchJobs(deps(aliceId, [js]), { query: "tester", location: "Pune" }); // cached
    const alice = scopedDb(aliceId);
    const rows = await alice.feedSearch.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.liveCalls, r.resultCount])).toEqual([
      [1, 2],
      [0, 2],
    ]);
    const usage = await alice.usageRecord.findFirst();
    expect(usage?.searches).toBe(2);
    expect(await scopedDb(bobId).feedSearch.count()).toBe(0);
  });
});
