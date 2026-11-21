import "server-only";

import type { BoardSystem } from "@/generated/prisma/enums";
import { RetryLater } from "@/lib/jobs/retry-later";
import { logServerError } from "@/lib/log";
import { systemPrisma } from "@/lib/prisma";

import { ADAPTERS } from "./adapters";
import { MAX_LINKS_PER_PASTE, parseBoardLinks, type BoardLink } from "./board-links";
import { CrawlError } from "./http";
import { relevant } from "./place";

// Phase 2 (reach): Admin → Job boards. The boards the crawler reads, and adding more from pasted
// careers links. Each new board is asked live through its public API first, and kept only when it
// exists and has open jobs in the countries it's crawled for, so a typo or an empty board doesn't
// add crawl load.

/** How long one board's live check may take. */
const CHECK_TIMEOUT_MS = 30_000;

export type JobBoardRow = {
  id: string;
  name: string;
  system: BoardSystem;
  boardToken: string;
  countries: string[];
  active: boolean;
  openJobs: number;
  lastCrawledAt: Date | null;
  lastError: string | null;
};

export type JobBoardsView = { boards: JobBoardRow[]; totals: { boards: number; active: number; openJobs: number } };

/** Every board, the active ones with the most jobs first. */
export async function loadJobBoards(): Promise<JobBoardsView> {
  const boards = await systemPrisma.company.findMany({
    orderBy: [{ active: "desc" }, { openJobs: "desc" }, { name: "asc" }],
    select: { id: true, name: true, system: true, boardToken: true, countries: true, active: true, openJobs: true, lastCrawledAt: true, lastError: true },
  });
  const active = boards.filter((board) => board.active);
  return { boards, totals: { boards: boards.length, active: active.length, openJobs: active.reduce((sum, board) => sum + board.openJobs, 0) } };
}

export type BoardCheck = { ok: true; openJobs: number; relevantJobs: number } | { ok: false; problem: "not-found" | "unavailable" };

/** Asks a board live for its open jobs, and how many are in `countries` (or open to anywhere). */
export async function checkBoard(board: Pick<BoardLink, "system" | "boardToken" | "name">, countries: readonly string[]): Promise<BoardCheck> {
  try {
    const listed = await ADAPTERS[board.system].list({ name: board.name, boardToken: board.boardToken, countries: [...countries] }, AbortSignal.timeout(CHECK_TIMEOUT_MS));
    return { ok: true, openJobs: listed.length, relevantJobs: listed.filter((job) => relevant(job, countries)).length };
  } catch (error) {
    if (error instanceof CrawlError && error.problem === "gone") return { ok: false, problem: "not-found" };
    if (!(error instanceof CrawlError) && !(error instanceof RetryLater) && !(error instanceof DOMException)) logServerError(`board check ${board.system} ${board.boardToken}`, error);
    return { ok: false, problem: "unavailable" };
  }
}

export type AddedBoard =
  | { kind: "added"; board: BoardLink; relevantJobs: number }
  | { kind: "exists"; board: BoardLink }
  | { kind: "not-found"; board: BoardLink }
  | { kind: "no-jobs"; board: BoardLink; openJobs: number }
  | { kind: "unavailable"; board: BoardLink };

export type AddBoardsResult = { results: AddedBoard[]; unread: string[]; overLimit: number };

/** ISO country codes as typed ("in, US"): lower case, two letters each, each once; India when none. */
export function parseCountries(text: string): string[] {
  const codes = [...new Set(text.toLowerCase().split(/[\s,]+/).filter((code) => /^[a-z]{2}$/.test(code)))];
  return codes.length > 0 ? codes.slice(0, 10) : ["in"];
}

/**
 * Adds the pasted boards that exist and have open jobs in `countries`, up to MAX_LINKS_PER_PASTE
 * at a time, one after another so the boards' rate limits hold. A board already there is left
 * as it is. A new one is crawled at the crawler's next look.
 */
export async function addJobBoards(text: string, countries: readonly string[], now = new Date()): Promise<AddBoardsResult> {
  const { boards, unread } = parseBoardLinks(text);
  const batch = boards.slice(0, MAX_LINKS_PER_PASTE);
  const results: AddedBoard[] = [];
  for (const board of batch) {
    const existing = await systemPrisma.company.findFirst({
      where: { system: board.system, boardToken: { equals: board.boardToken, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      results.push({ kind: "exists", board });
      continue;
    }
    const check = await checkBoard(board, countries);
    if (!check.ok) {
      results.push({ kind: check.problem, board });
      continue;
    }
    if (check.relevantJobs === 0) {
      results.push({ kind: "no-jobs", board, openJobs: check.openJobs });
      continue;
    }
    await systemPrisma.company.upsert({
      where: { system_boardToken: { system: board.system, boardToken: board.boardToken } },
      create: { name: board.name, system: board.system, boardToken: board.boardToken, countries: [...countries], nextCrawlAt: now },
      update: {},
    });
    results.push({ kind: "added", board, relevantJobs: check.relevantJobs });
  }
  return { results, unread, overLimit: boards.length - batch.length };
}

/** Pauses a board, or crawls it again from the next look; resuming clears its last failure. */
export async function setJobBoardActive(id: string, active: boolean, now = new Date()): Promise<boolean> {
  const { count } = await systemPrisma.company.updateMany({
    where: { id },
    data: active ? { active: true, failures: 0, lastError: null, nextCrawlAt: now, crawlingUntil: null } : { active: false },
  });
  return count > 0;
}
