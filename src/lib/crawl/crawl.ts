import "server-only";

import type { Company } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { RetryLater } from "@/lib/jobs/retry-later";
import { logServerError } from "@/lib/log";
import { systemPrisma } from "@/lib/prisma";

import { ADAPTERS } from "./adapters";
import { STARTER_COMPANIES } from "./companies";
import { CrawlError } from "./http";
import { relevant } from "./place";
import { dedupeKey } from "./text";
import type { CrawledJob } from "./types";

// Pathfinder (auto-apply step 2): the crawler. Every 6 hours each company's public job board is
// read once and its jobs kept in SharedPosting, shared by every student, so 100 students cost no
// more requests than one. The Company table is the schedule: a worker takes companies whose time
// has come with FOR UPDATE SKIP LOCKED and holds them for a while, so two workers never crawl the
// same board and a crashed worker's hold just runs out. A failed board waits longer each time.
// It needs no student and touches no student's data, so it runs on the unscoped client.

export const CRAWL_EVERY_MS = 6 * 3600_000;
/** A worker's hold on a company; a crawl taking longer is cut short by its own timeout first. */
const HOLD_MS = 20 * 60_000;
/** How often a worker looks for companies due. */
const LOOP_MS = 60_000;
/** Companies one worker crawls at once (the boards' shared rate limits pace them anyway). */
const AT_ONCE = 2;
/** The first wait after a failure; four times longer each time, at most a day. */
const FAILURE_BASE_MS = 15 * 60_000;
const FAILURE_MAX_MS = 24 * 3600_000;
/** One crawl's time limit. */
const CRAWL_TIMEOUT_MS = 15 * 60_000;

export type CrawlOutcome = { kept: number; added: number; updated: number; closed: number; skipped: number };

/** The wait before crawling a board again after its `failures`th failure in a row. */
export function failureDelay(failures: number): number {
  return Math.min(FAILURE_MAX_MS, FAILURE_BASE_MS * 4 ** Math.max(0, failures - 1));
}

/**
 * Reads one company's board and brings its jobs up to date: new jobs added, changed ones
 * rewritten, the rest just marked as seen, and jobs gone from the board closed.
 */
export async function crawlCompany(company: Company, signal: AbortSignal): Promise<CrawlOutcome> {
  const started = new Date();
  const listed = await ADAPTERS[company.system].list({ name: company.name, boardToken: company.boardToken, countries: company.countries }, signal);
  const wanted = listed.filter((job) => relevant(job, company.countries));
  const existing = new Map(
    (await systemPrisma.sharedPosting.findMany({ where: { companyId: company.id }, select: { id: true, externalId: true, contentHash: true, closedAt: true } })).map(
      (row) => [row.externalId, row],
    ),
  );

  const outcome: CrawlOutcome = { kept: 0, added: 0, updated: 0, closed: 0, skipped: 0 };
  const unchanged: string[] = [];
  for (const job of wanted) {
    signal.throwIfAborted();
    const known = existing.get(job.externalId);
    if (known && known.contentHash === job.version && known.closedAt === null) {
      unchanged.push(known.id);
      outcome.kept++;
      continue;
    }
    let crawled: CrawledJob;
    try {
      crawled = await job.load();
    } catch (error) {
      // One job that won't load (taken down meanwhile) doesn't stop the rest; a rate limit does.
      if (error instanceof RetryLater || signal.aborted) throw error;
      outcome.skipped++;
      continue;
    }
    if (!crawled.title || !crawled.applyUrl) {
      outcome.skipped++;
      continue;
    }
    const data = {
      system: company.system,
      title: crawled.title,
      companyName: crawled.companyName || company.name,
      location: crawled.location,
      country: crawled.country,
      remote: crawled.remote,
      employmentType: crawled.employmentType,
      department: crawled.department,
      salary: crawled.salary,
      description: crawled.description,
      url: crawled.url || crawled.applyUrl,
      applyUrl: crawled.applyUrl,
      postedAt: crawled.postedAt,
      lastSeenAt: started,
      closedAt: null,
      dedupeKey: dedupeKey({ companyName: crawled.companyName || company.name, title: crawled.title, location: crawled.location }),
      contentHash: job.version,
    };
    await systemPrisma.sharedPosting.upsert({
      where: { companyId_externalId: { companyId: company.id, externalId: job.externalId } },
      create: { ...data, companyId: company.id, externalId: job.externalId, firstSeenAt: started },
      update: data,
    });
    if (known) outcome.updated++;
    else outcome.added++;
    outcome.kept++;
  }

  if (unchanged.length > 0) await systemPrisma.sharedPosting.updateMany({ where: { id: { in: unchanged } }, data: { lastSeenAt: started } });
  // Not seen in this crawl: gone from the board, or no longer in the company's countries.
  const closed = await systemPrisma.sharedPosting.updateMany({
    where: { companyId: company.id, closedAt: null, lastSeenAt: { lt: started } },
    data: { closedAt: started },
  });
  outcome.closed = closed.count;
  return outcome;
}

/** Takes up to `limit` companies whose crawl is due and holds them for this worker. */
export async function claimDueCompanies(limit: number): Promise<Company[]> {
  // Prisma keeps times in UTC in columns without a time zone, so now() is turned into UTC too.
  const ids = await systemPrisma.$queryRaw<{ id: string }[]>`
    WITH utc AS (SELECT now() AT TIME ZONE 'UTC' AS now),
    due AS (
      SELECT c.id FROM "Company" c, utc
      WHERE c.active AND c."nextCrawlAt" <= utc.now AND (c."crawlingUntil" IS NULL OR c."crawlingUntil" < utc.now)
      ORDER BY c."nextCrawlAt"
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE "Company" SET "crawlingUntil" = utc.now + make_interval(secs => ${HOLD_MS / 1000}), "updatedAt" = utc.now
    FROM due, utc WHERE "Company".id = due.id
    RETURNING "Company".id`;
  if (ids.length === 0) return [];
  return systemPrisma.company.findMany({ where: { id: { in: ids.map(({ id }) => id) } } });
}

/** Crawls one held company and records how it went; never throws. */
export async function crawlAndRecord(company: Company, now = () => new Date()): Promise<CrawlOutcome | null> {
  const signal = AbortSignal.timeout(CRAWL_TIMEOUT_MS);
  try {
    const outcome = await crawlCompany(company, signal);
    const openJobs = await systemPrisma.sharedPosting.count({ where: { companyId: company.id, closedAt: null } });
    const at = now();
    await systemPrisma.company.update({
      where: { id: company.id },
      data: { lastCrawledAt: at, nextCrawlAt: new Date(at.getTime() + CRAWL_EVERY_MS), crawlingUntil: null, failures: 0, lastError: null, openJobs },
    });
    return outcome;
  } catch (error) {
    const at = now();
    const failures = company.failures + 1;
    const gone = error instanceof CrawlError && error.problem === "gone";
    const wait = error instanceof RetryLater && error.afterMs !== undefined ? error.afterMs : failureDelay(failures);
    const lastError =
      error instanceof CrawlError || error instanceof RetryLater
        ? error.message
        : signal.aborted
          ? "The crawl took longer than 15 minutes."
          : "The crawl failed unexpectedly; see the server log.";
    if (!(error instanceof CrawlError) && !(error instanceof RetryLater)) logServerError(`crawl ${company.system} ${company.boardToken}`, error);
    await systemPrisma.company
      .update({
        where: { id: company.id },
        // A board that doesn't exist stops being crawled until someone checks its name.
        data: { failures, lastError: gone ? `${lastError} Check the board's name; crawling is paused.` : lastError, active: gone ? false : undefined, nextCrawlAt: new Date(at.getTime() + wait), crawlingUntil: null },
      })
      .catch((cause: unknown) => logServerError("crawl", cause));
    return null;
  }
}

/** Adds the starter companies that aren't there yet; never changes or removes one. */
export async function addStarterCompanies(): Promise<number> {
  let added = 0;
  for (const company of STARTER_COMPANIES) {
    const where = { system_boardToken: { system: company.system, boardToken: company.boardToken } };
    if (await systemPrisma.company.findUnique({ where, select: { id: true } })) continue;
    // An upsert that changes nothing on a match, in case another worker added it meanwhile.
    await systemPrisma.company.upsert({ where, create: { ...company, countries: company.countries ?? ["in"] }, update: {} });
    added++;
  }
  return added;
}

type CrawlerState = { timer?: NodeJS.Timeout; running: number };
const globalForCrawler = globalThis as unknown as { crawler?: CrawlerState };
const state: CrawlerState = (globalForCrawler.crawler ??= { running: 0 });

/** One look for due companies, crawling as many as this worker has room for. */
export async function crawlDue(): Promise<void> {
  const room = AT_ONCE - state.running;
  if (room <= 0) return;
  const companies = await claimDueCompanies(room);
  for (const company of companies) {
    state.running++;
    void crawlAndRecord(company).finally(() => {
      state.running--;
    });
  }
}

/** Whether this server crawls job boards (PATHFINDER_CRAWL=on); off unless switched on. */
export function crawlerEnabled(): boolean {
  try {
    return env.PATHFINDER_CRAWL === "on";
  } catch {
    return false;
  }
}

/**
 * Called once at startup where this process runs jobs and the crawler is on. Resolves once the
 * starter companies are in and the first look for due companies has been made.
 */
export async function startCrawler(): Promise<void> {
  if (state.timer || !crawlerEnabled()) return;
  const tick = () => crawlDue().catch((error: unknown) => logServerError("crawl", error));
  state.timer = setInterval(() => void tick(), LOOP_MS);
  state.timer.unref?.();
  await addStarterCompanies().catch((error: unknown) => logServerError("crawl", error));
  await tick();
}

/** Stops looking for due companies; crawls under way finish. */
export function stopCrawler(): void {
  clearInterval(state.timer);
  state.timer = undefined;
}
