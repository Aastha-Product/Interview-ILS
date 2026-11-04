import { describe, expect, it } from "vitest";
import adzunaFixture from "../fixtures/adzuna-search.json";
import jsearchFixture from "../fixtures/jsearch-search-v2.json";
import { createAdzunaAdapter } from "../src/adzuna";
import { FeedError, stripHtml } from "../src/errors";
import { createFeedAdapters, createFixtureAdapter } from "../src/fixtures";
import { createJSearchAdapter } from "../src/jsearch";
import { dedupeKey } from "../src/normalise";

const SECRET = "secret-key-123";

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return Object.assign(fn, { calls });
}

describe("JSearch adapter", () => {
  it("calls search-v2 with the documented headers and India parameters", async () => {
    const fetch = fakeFetch(jsearchFixture);
    await createJSearchAdapter({ apiKey: SECRET, fetch }).search({ query: "QA engineer", location: "Pune" });
    const call = fetch.calls[0]!;
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://jsearch.p.rapidapi.com/search-v2");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "QA engineer in Pune",
      country: "in",
      num_pages: "1",
      date_posted: "month",
      job_requirements: "no_experience,under_3_years_experience",
    });
    expect(call.init?.headers).toMatchObject({ "x-rapidapi-key": SECRET, "x-rapidapi-host": "jsearch.p.rapidapi.com" });
  });

  it("passes the cursor for later pages", async () => {
    const fetch = fakeFetch(jsearchFixture);
    await createJSearchAdapter({ apiKey: SECRET, fetch }).search({ query: "qa", location: "", page: "CURSOR1" });
    expect(new URL(fetch.calls[0]!.url).searchParams.get("cursor")).toBe("CURSOR1");
    expect(new URL(fetch.calls[0]!.url).searchParams.get("query")).toBe("qa");
  });

  it("maps jobs to the common shape", async () => {
    const { jobs, nextPage } = await createJSearchAdapter({ apiKey: SECRET, fetch: fakeFetch(jsearchFixture) }).search({
      query: "qa",
      location: "",
    });
    expect(jobs).toHaveLength(6);
    expect(nextPage).toBeUndefined();
    const qa = jobs[0]!;
    expect(qa).toMatchObject({
      source: "jsearch",
      sourceId: "fx-js-qa-example-softech",
      title: "QA Engineer (Fresher)",
      company: "Example Softech Pvt Ltd",
      location: "Bangalore, Karnataka",
      remote: false,
      employmentType: "Full-time",
    });
    expect(qa.postedAt?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(qa.description).toContain("Selenium");
    // A direct apply option wins over the aggregator link.
    expect(jobs.find((j) => j.company === "Deccan Cloudworks")?.applyUrl).toBe("https://deccancloudworks.example/careers/ste-hyd");
    // Employment type falls back to the enum list; remote job with no city uses job_location.
    expect(jobs.find((j) => j.company === "Konkan Fintech Limited")?.employmentType).toBe("Full-time");
    const remote = jobs.find((j) => j.company === "Brightpath Learning")!;
    expect(remote.remote).toBe(true);
    expect(remote.location).toBe("India");
  });

  it("skips malformed jobs instead of failing the whole search", async () => {
    const body = {
      status: "OK",
      data: { jobs: [{ job_id: "x" }, (jsearchFixture.data.jobs as unknown[])[1]], cursor: "NEXT" },
    };
    const { jobs, nextPage } = await createJSearchAdapter({ apiKey: SECRET, fetch: fakeFetch(body) }).search({ query: "q", location: "" });
    expect(jobs).toHaveLength(1);
    expect(nextPage).toBe("NEXT");
  });
});

describe("Adzuna adapter", () => {
  it("calls the documented search URL for the configured country", async () => {
    const fetch = fakeFetch(adzunaFixture);
    await createAdzunaAdapter({ appId: "id-1", appKey: SECRET, country: "in", fetch }).search({ query: "data analyst", location: "Pune" });
    const url = new URL(fetch.calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.adzuna.com/v1/api/jobs/in/search/1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: "id-1",
      app_key: SECRET,
      what: "data analyst",
      where: "Pune",
      results_per_page: "10",
      "content-type": "application/json",
    });
  });

  it("maps results, stripping HTML and sending all traffic through redirect_url", async () => {
    const { jobs } = await createAdzunaAdapter({ appId: "a", appKey: SECRET, country: "in", fetch: fakeFetch(adzunaFixture) }).search({
      query: "qa",
      location: "",
    });
    expect(jobs).toHaveLength(6);
    const qa = jobs[0]!;
    expect(qa).toMatchObject({
      source: "adzuna",
      sourceId: "4401000001",
      title: "QA Engineer",
      company: "Example Softech",
      location: "Bengaluru, Karnataka",
      employmentType: "Full-time, Permanent",
      url: "https://adzuna.example/land/ad/4401000001?se=fixture&v=1",
      applyUrl: "https://adzuna.example/land/ad/4401000001?se=fixture&v=1",
    });
    expect(qa.description).not.toContain("<strong>");
    expect(jobs.find((j) => j.sourceId === "4401000004")?.title).toBe("Trainee Software Developer"); // numeric id
    expect(jobs.find((j) => j.sourceId === "4401000006")?.remote).toBe(true); // "Work From Home"
  });

  it("produces the same dedupe key as JSearch for the same job", async () => {
    const [js] = (await createJSearchAdapter({ apiKey: "k", fetch: fakeFetch(jsearchFixture) }).search({ query: "q", location: "" })).jobs;
    const [az] = (await createAdzunaAdapter({ appId: "a", appKey: "k", country: "in", fetch: fakeFetch(adzunaFixture) }).search({ query: "q", location: "" })).jobs;
    expect(dedupeKey(js!)).toBe(dedupeKey(az!));
  });
});

describe("feed errors", () => {
  const cases: Array<[number, string]> = [
    [401, "auth"],
    [403, "auth"],
    [429, "quota"],
    [500, "server"],
    [503, "server"],
    [404, "bad_response"],
  ];
  for (const [status, kind] of cases) {
    it(`maps HTTP ${status} to ${kind} without leaking the key`, async () => {
      const fetch = fakeFetch({ message: "nope" }, status);
      for (const adapter of [
        createJSearchAdapter({ apiKey: SECRET, fetch }),
        createAdzunaAdapter({ appId: "a", appKey: SECRET, country: "in", fetch }),
      ]) {
        const error = await adapter.search({ query: "qa", location: "" }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(FeedError);
        expect((error as FeedError).kind).toBe(kind);
        expect(String((error as Error).message)).not.toContain(SECRET);
        expect(String((error as Error).message)).not.toContain("http");
      }
    });
  }

  it("reports invalid JSON and wrong shapes as bad_response", async () => {
    for (const body of ["<html>oops</html>", { unexpected: true }]) {
      const error = await createJSearchAdapter({ apiKey: SECRET, fetch: fakeFetch(body) })
        .search({ query: "q", location: "" })
        .catch((e: unknown) => e);
      expect((error as FeedError).kind).toBe("bad_response");
    }
  });

  it("reports network failures and timeouts", async () => {
    const down = async () => {
      throw new TypeError(`fetch failed for https://x/?app_key=${SECRET}`);
    };
    const net = await createAdzunaAdapter({ appId: "a", appKey: SECRET, country: "in", fetch: down })
      .search({ query: "q", location: "" })
      .catch((e: unknown) => e);
    expect((net as FeedError).kind).toBe("network");
    expect((net as Error).message).not.toContain(SECRET);

    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const slow = await createJSearchAdapter({ apiKey: SECRET, fetch: hang, timeoutMs: 20 })
      .search({ query: "q", location: "" })
      .catch((e: unknown) => e);
    expect((slow as FeedError).kind).toBe("timeout");
  });
});

describe("fixture adapters", () => {
  it("are marked not live and filter by query words and city", async () => {
    const adapter = createFixtureAdapter("jsearch");
    expect(adapter.live).toBe(false);
    const { jobs } = await adapter.search({ query: "data analyst jobs", location: "Pune" });
    // Pune data job plus the remote one; Bengaluru QA job filtered out.
    expect(jobs.map((j) => j.company).sort()).toEqual(["Brightpath Learning", "Nimbus Analytics"]);
  });

  it("are used when keys are missing, live adapters otherwise", () => {
    expect(createFeedAdapters({ ADZUNA_COUNTRY: "in" }).map((a) => [a.source, a.live])).toEqual([
      ["jsearch", false],
      ["adzuna", false],
    ]);
    expect(
      createFeedAdapters({ JSEARCH_API_KEY: "k", ADZUNA_APP_ID: "a", ADZUNA_APP_KEY: "b", ADZUNA_COUNTRY: "in" }).map((a) => a.live),
    ).toEqual([true, true]);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<strong>QA</strong> &amp; Testing&nbsp;role<br/>Next")).toBe("QA & Testing role\nNext");
  });
});
