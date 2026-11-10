import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RetryLater } from "@/lib/jobs/retry-later";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient } from "@/test/db";

import type { CrawledJob, ListedJob } from "./types";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const settings = vi.hoisted(() => ({ crawl: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({
  env: {
    get PATHFINDER_CRAWL() {
      return settings.crawl;
    },
  },
}));
vi.spyOn(console, "error").mockImplementation(() => {});

// A board the test controls: what its list says, and what loading each job gives.
const board = vi.hoisted(() => ({ listed: [] as unknown[], loads: [] as string[], error: undefined as unknown }));
vi.mock("./adapters", () => {
  const fake = {
    system: "GREENHOUSE",
    list: async () => {
      if (board.error) throw board.error;
      return board.listed;
    },
  };
  return { ADAPTERS: { GREENHOUSE: fake, LEVER: fake, ASHBY: fake, SMARTRECRUITERS: fake } };
});
vi.mock("./companies", () => ({ STARTER_COMPANIES: [{ name: "Starter", system: "LEVER", boardToken: "starter" }] }));

const { addStarterCompanies, claimDueCompanies, crawlAndRecord, crawlCompany, crawlDue, crawlerEnabled, failureDelay, startCrawler, stopCrawler } = await import("./crawl");
const { CrawlError } = await import("./http");

const raw = () => rawClientOf(db.client!);
const signal = new AbortController().signal;

function job(id: string, overrides: Partial<CrawledJob & { version: string; countries: string[]; remote: boolean | null; fails: boolean }> = {}): ListedJob {
  const crawled: CrawledJob = {
    externalId: id,
    title: overrides.title ?? `Engineer ${id}`,
    companyName: "Acme",
    location: overrides.location ?? "Bengaluru",
    country: "in",
    remote: overrides.remote ?? null,
    employmentType: "",
    department: "",
    salary: "",
    description: `About job ${id}.`,
    url: `https://acme.example/${id}`,
    applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    postedAt: null,
  };
  return {
    externalId: id,
    version: overrides.version ?? "v1",
    countries: overrides.countries ?? ["in"],
    remote: overrides.remote ?? null,
    location: crawled.location,
    load: async () => {
      board.loads.push(id);
      if (overrides.fails) throw new CrawlError("gone", "Taken down.");
      return crawled;
    },
  };
}

async function company(data: Partial<{ boardToken: string; nextCrawlAt: Date; crawlingUntil: Date | null; active: boolean; failures: number }> = {}) {
  return raw().company.create({ data: { name: "Acme", system: "GREENHOUSE", boardToken: data.boardToken ?? "acme", ...data } });
}
const postings = () => raw().sharedPosting.findMany({ orderBy: { externalId: "asc" } });

beforeEach(async () => {
  await raw().sharedPosting.deleteMany();
  await raw().company.deleteMany();
  await raw().providerBudget.deleteMany();
  board.listed = [];
  board.loads = [];
  board.error = undefined;
});
afterAll(() => db.client!.$disconnect());

describe("crawling a company's board (auto-apply step 2)", () => {
  it("keeps the jobs in its countries and open remote ones, with everything the matcher needs", async () => {
    const acme = await company();
    board.listed = [
      job("1"),
      job("2", { countries: ["us"], location: "New York" }),
      job("3", { countries: [], remote: true, location: "Remote - Worldwide" }),
    ];
    expect(await crawlCompany(acme, signal)).toEqual({ kept: 2, added: 2, updated: 0, closed: 0, skipped: 0 });
    const rows = await postings();
    expect(rows.map((row) => row.externalId)).toEqual(["1", "3"]);
    expect(rows[0]).toMatchObject({
      system: "GREENHOUSE",
      title: "Engineer 1",
      companyName: "Acme",
      country: "in",
      description: "About job 1.",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      contentHash: "v1",
      closedAt: null,
    });
    expect(rows[0].dedupeKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loads only new or changed jobs, closes jobs gone from the board, and opens them again when they're back", async () => {
    const acme = await company();
    board.listed = [job("1"), job("2"), job("3")];
    await crawlCompany(acme, signal);
    board.loads = [];

    board.listed = [job("1"), job("2", { version: "v2", title: "Senior Engineer 2" })];
    expect(await crawlCompany(acme, signal)).toEqual({ kept: 2, added: 0, updated: 1, closed: 1, skipped: 0 });
    expect(board.loads).toEqual(["2"]);
    const after = await postings();
    expect(after.map((row) => [row.externalId, row.title, row.closedAt === null])).toEqual([
      ["1", "Engineer 1", true],
      ["2", "Senior Engineer 2", true],
      ["3", "Engineer 3", false],
    ]);

    board.listed = [job("1"), job("2", { version: "v2" }), job("3")];
    await crawlCompany(acme, signal);
    expect((await postings()).every((row) => row.closedAt === null)).toBe(true);
  });

  it("skips a job that won't load and saves the rest", async () => {
    const acme = await company();
    board.listed = [job("1", { fails: true }), job("2")];
    expect(await crawlCompany(acme, signal)).toMatchObject({ added: 1, skipped: 1 });
  });

  it("stops a crawl that hits a rate limit, to try again later", async () => {
    const acme = await company();
    const limited = job("1");
    limited.load = async () => {
      throw new RetryLater("Waiting.", 60_000);
    };
    board.listed = [limited];
    await expect(crawlCompany(acme, signal)).rejects.toBeInstanceOf(RetryLater);
  });
});

describe("the crawl schedule (auto-apply step 2)", () => {
  it("hands each due company to one worker only, and skips ones held, paused or not yet due", async () => {
    const past = new Date(Date.now() - 60_000);
    await company({ boardToken: "due-1", nextCrawlAt: past });
    await company({ boardToken: "due-2", nextCrawlAt: past });
    await company({ boardToken: "later", nextCrawlAt: new Date(Date.now() + 3600_000) });
    await company({ boardToken: "held", nextCrawlAt: past, crawlingUntil: new Date(Date.now() + 600_000) });
    await company({ boardToken: "paused", nextCrawlAt: past, active: false });
    const [first, second] = await Promise.all([claimDueCompanies(1), claimDueCompanies(5)]);
    const taken = [...first, ...second].map((row) => row.boardToken).sort();
    expect(taken).toEqual(["due-1", "due-2"]);
    expect(await claimDueCompanies(5)).toEqual([]);
  });

  it("schedules the next crawl in 6 hours after a good one, and counts open jobs", async () => {
    const acme = await company({ failures: 2 });
    board.listed = [job("1"), job("2")];
    const now = new Date("2026-11-10T06:00:00.000Z");
    expect(await crawlAndRecord(acme, () => now)).toMatchObject({ added: 2 });
    expect(await raw().company.findUniqueOrThrow({ where: { id: acme.id } })).toMatchObject({
      failures: 0,
      lastError: null,
      openJobs: 2,
      crawlingUntil: null,
      lastCrawledAt: now,
      nextCrawlAt: new Date("2026-11-10T12:00:00.000Z"),
    });
  });

  it("waits longer after each failure, as long as a rate limit asks, and pauses a board that doesn't exist", async () => {
    const now = new Date("2026-11-10T06:00:00.000Z");
    const after = (ms: number) => new Date(now.getTime() + ms);

    const down = await company({ boardToken: "down", failures: 1 });
    board.error = new CrawlError("unavailable", "boards-api.greenhouse.io answered HTTP 503.");
    expect(await crawlAndRecord(down, () => now)).toBeNull();
    expect(await raw().company.findUniqueOrThrow({ where: { id: down.id } })).toMatchObject({
      failures: 2,
      active: true,
      lastError: "boards-api.greenhouse.io answered HTTP 503.",
      nextCrawlAt: after(failureDelay(2)),
    });
    expect(failureDelay(2)).toBe(60 * 60_000);

    const limited = await company({ boardToken: "limited" });
    board.error = new RetryLater("Slow down.", 30 * 60_000);
    await crawlAndRecord(limited, () => now);
    expect((await raw().company.findUniqueOrThrow({ where: { id: limited.id } })).nextCrawlAt).toEqual(after(30 * 60_000));

    const gone = await company({ boardToken: "gone" });
    board.error = new CrawlError("gone", "boards-api.greenhouse.io has no board at /v1/boards/gone/jobs.");
    await crawlAndRecord(gone, () => now);
    expect(await raw().company.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({ active: false });
  });

  it("crawls the companies that are due in the background", async () => {
    const due = await company({ boardToken: "due", nextCrawlAt: new Date(Date.now() - 60_000) });
    board.listed = [job("1")];
    await crawlDue();
    const deadline = Date.now() + 5_000;
    while (!(await raw().company.findUniqueOrThrow({ where: { id: due.id } })).lastCrawledAt && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await raw().company.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({ openJobs: 1, crawlingUntil: null });
  });

  it("stays off unless PATHFINDER_CRAWL is on, and when on adds the starter companies and crawls them", async () => {
    settings.crawl = undefined;
    expect(crawlerEnabled()).toBe(false);
    await startCrawler();
    expect(await raw().company.count()).toBe(0);

    settings.crawl = "on";
    board.listed = [job("1")];
    try {
      await startCrawler();
      const deadline = Date.now() + 5_000;
      while (!(await raw().company.findFirst({ where: { boardToken: "starter" } }))?.lastCrawledAt && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(await raw().company.findFirstOrThrow({ where: { boardToken: "starter" } })).toMatchObject({ openJobs: 1 });
    } finally {
      stopCrawler();
      settings.crawl = undefined;
    }
  });

  it("adds the starter companies once, and never changes one that's there", async () => {
    expect(await addStarterCompanies()).toBe(1);
    await raw().company.updateMany({ where: { boardToken: "starter" }, data: { active: false } });
    expect(await addStarterCompanies()).toBe(0);
    expect(await raw().company.findFirstOrThrow({ where: { boardToken: "starter" } })).toMatchObject({ active: false, countries: ["in"] });
  });
});
