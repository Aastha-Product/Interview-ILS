import { afterEach, describe, expect, it, vi } from "vitest";

import { RetryLater } from "@/lib/jobs/retry-later";

vi.mock("@/lib/jobs/rate-limit", () => ({ withRateLimit: (_p: string, _l: unknown, work: () => unknown) => work() }));

const { getJson, retryAfterMs, USER_AGENT } = await import("./http");
type CrawlError = import("./http").CrawlError;

const url = new URL("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
const signal = new AbortController().signal;

function answer(status: number, body: string, headers: Record<string, string> = {}) {
  const fetch = vi.fn(async () => new Response(body, { status, headers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("asking a job board (auto-apply step 2)", () => {
  it("returns the board's JSON, saying who asks", async () => {
    const fetch = answer(200, '{"jobs":[]}');
    expect(await getJson("GREENHOUSE", url, signal)).toEqual({ jobs: [] });
    const init = (fetch.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(USER_AGENT);
  });

  it("names each kind of failure", async () => {
    const problem = async () => (await getJson("GREENHOUSE", url, signal).catch((error: unknown) => error)) as CrawlError;
    answer(404, "");
    expect(await problem()).toMatchObject({ problem: "gone", message: "boards-api.greenhouse.io has no board at /v1/boards/acme/jobs." });
    answer(403, "");
    expect(await problem()).toMatchObject({ problem: "blocked" });
    answer(503, "");
    expect(await problem()).toMatchObject({ problem: "unavailable", message: "boards-api.greenhouse.io answered HTTP 503." });
    answer(200, "<html>not json</html>");
    expect(await problem()).toMatchObject({ problem: "changed" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await problem()).toMatchObject({ problem: "unavailable", message: "boards-api.greenhouse.io didn't answer (network error)." });
  });

  it("waits as long as the board asks when it says to slow down", async () => {
    answer(429, "", { "retry-after": "120" });
    const error = await getJson("GREENHOUSE", url, signal).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RetryLater);
    expect((error as RetryLater).afterMs).toBe(120_000);
  });

  it("reads Retry-After in seconds or as a date, within reason", () => {
    const now = Date.parse("2026-11-10T06:00:00Z");
    expect(retryAfterMs("30", now)).toBe(30_000);
    expect(retryAfterMs("Tue, 10 Nov 2026 06:05:00 GMT", now)).toBe(5 * 60_000);
    expect(retryAfterMs(null, now)).toBe(10 * 60_000);
    expect(retryAfterMs("soon", now)).toBe(10 * 60_000);
    // Never more than six hours.
    expect(retryAfterMs("999999", now)).toBe(6 * 3600_000);
  });

  it("gives up on an answer too large to be a job board", async () => {
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(huge, { status: 200 })));
    await expect(getJson("GREENHOUSE", url, signal)).rejects.toMatchObject({ problem: "changed" });
  });
});
