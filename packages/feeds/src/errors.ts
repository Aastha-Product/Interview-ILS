import type { JobSourceName } from "./types";

export type FeedErrorKind = "auth" | "quota" | "server" | "network" | "timeout" | "bad_response";

/**
 * A failed feed call. Messages are fixed text: they never contain API keys, request URLs or the
 * student's query, so they are safe to log.
 */
export class FeedError extends Error {
  constructor(
    readonly source: Exclude<JobSourceName, "manual">,
    readonly kind: FeedErrorKind,
    readonly status?: number,
  ) {
    super(`${source} feed failed: ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "FeedError";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** GET a JSON document with a timeout, mapping every failure onto a FeedError. */
export async function getJson(
  source: Exclude<JobSourceName, "manual">,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, method: "GET", signal: combined });
  } catch (error) {
    const name = (error as Error)?.name;
    if (timeout.aborted || name === "TimeoutError") throw new FeedError(source, "timeout");
    throw new FeedError(source, "network");
  }
  if (response.status === 401 || response.status === 403) throw new FeedError(source, "auth", response.status);
  if (response.status === 429) throw new FeedError(source, "quota", response.status);
  if (response.status >= 500) throw new FeedError(source, "server", response.status);
  if (!response.ok) throw new FeedError(source, "bad_response", response.status);
  try {
    return await response.json();
  } catch {
    throw new FeedError(source, "bad_response", response.status);
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Plain text from a short HTML fragment (Adzuna wraps matched words in <strong>). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
