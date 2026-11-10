import "server-only";

import type { BoardSystem } from "@/generated/prisma/enums";
import { withRateLimit, type RateLimit } from "@/lib/jobs/rate-limit";
import { RetryLater } from "@/lib/jobs/retry-later";

// Pathfinder (auto-apply step 2): requests to job boards' public APIs. Each board has a fixed host,
// so there's no address to guard; requests are limited in time, size and rate, and say who asks.

export const USER_AGENT = "PathfinderBot/1.0 (+https://pathfinderedtech.com)";
const TIMEOUT_MS = 60_000;
/** A large company's whole board with descriptions can be tens of megabytes. */
const MAX_BYTES = 40 * 1024 * 1024;

/** Requests to one board system, shared by every worker; well under what each allows. */
export const BOARD_LIMITS: Record<BoardSystem, RateLimit> = {
  GREENHOUSE: { perMinute: 30, burst: 5 },
  LEVER: { perMinute: 30, burst: 5 },
  ASHBY: { perMinute: 30, burst: 5 },
  // A job's description is a request of its own there.
  SMARTRECRUITERS: { perMinute: 60, burst: 10 },
};

export type CrawlProblem = "gone" | "blocked" | "unavailable" | "changed";

/** Why a board couldn't be read, in words for the admin console; never a posting's text. */
export class CrawlError extends Error {
  override name = "CrawlError";

  constructor(
    readonly problem: CrawlProblem,
    message: string,
  ) {
    super(message);
  }
}

/** GETs JSON from a board, within its shared rate limit. */
export async function getJson(system: BoardSystem, url: URL, signal: AbortSignal): Promise<unknown> {
  return withRateLimit(`board:${system.toLowerCase()}`, BOARD_LIMITS[system], () => fetchJson(url, signal), { maxWaitMs: 30_000, signal });
}

async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.any([signal, timeout]),
      cache: "no-store",
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CrawlError("unavailable", `${url.host} didn't answer (${timeout.aborted ? "timed out" : "network error"}).`);
  }
  if (response.status === 404) throw new CrawlError("gone", `${url.host} has no board at ${url.pathname}.`);
  if (response.status === 401 || response.status === 403) throw new CrawlError("blocked", `${url.host} refused the request (HTTP ${response.status}).`);
  if (response.status === 429) throw new RetryLater(`${url.host} asked us to slow down.`, retryAfterMs(response.headers.get("retry-after")));
  if (!response.ok) throw new CrawlError("unavailable", `${url.host} answered HTTP ${response.status}.`);
  const text = await readLimited(response);
  if (text === null) throw new CrawlError("changed", `${url.host} answered with more than ${MAX_BYTES} bytes.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CrawlError("changed", `${url.host} didn't answer with JSON.`);
  }
}

/** Retry-After in seconds or as a date; 10 minutes when it's missing or odd. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  const fallback = 10 * 60_000;
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 6 * 3600_000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? fallback : Math.max(0, Math.min(at - now, 6 * 3600_000));
}

async function readLimited(response: Response): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
