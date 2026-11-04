import { getPrisma } from "@pathfinder/db/raw";
import type { NormalizedJob } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../../db/test/helpers";
import adzunaFixture from "../../feeds/fixtures/adzuna-search.json";
import jsearchFixture from "../../feeds/fixtures/jsearch-search-v2.json";
import { parseAdzunaResponse } from "../../feeds/src/adzuna";
import { parseJSearchResponse } from "../../feeds/src/jsearch";
import { DEDUPE_WINDOW_MS, saveListing } from "../src/jobs/listings";

const jsearchJobs = parseJSearchResponse(jsearchFixture).jobs;
const adzunaJobs = parseAdzunaResponse(adzunaFixture, 1).jobs;

function manual(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    source: "manual",
    sourceId: `m-${Math.random().toString(36).slice(2)}`,
    title: "Software Tester",
    company: "Vindhya Infotech",
    location: "Indore",
    remote: false,
    employmentType: "",
    description: "Test web apps.",
    url: null,
    applyUrl: null,
    postedAt: null,
    closesAt: null,
    raw: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  await getPrisma().$executeRawUnsafe('TRUNCATE TABLE "FeedCache", "FeedBudget"');
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("saveListing", () => {
  it("stores the same job from JSearch and Adzuna once", async () => {
    const fromJSearch = await saveListing(jsearchJobs[0]!); // Example Softech Pvt Ltd, QA Engineer (Fresher), Bangalore
    const fromAdzuna = await saveListing(adzunaJobs[0]!); // Example Softech, QA Engineer, Bengaluru
    expect(fromAdzuna.id).toBe(fromJSearch.id);
    expect(await getPrisma().jobListing.count()).toBe(1);
    expect(fromJSearch.dedupeKey).toBe("example softech|qa engineer|bengaluru");
  });

  it("stores every distinct fixture job, collapsing only the shared ones", async () => {
    for (const job of [...jsearchJobs, ...adzunaJobs]) await saveListing(job);
    // 6 + 6 jobs, of which Example Softech QA and Nimbus Junior Data Analyst appear on both.
    expect(await getPrisma().jobListing.count()).toBe(10);
  });

  it("strips tracking parameters and collapses URL variants", async () => {
    const first = await saveListing(jsearchJobs[0]!);
    expect(first.urlNormalised).toBe("https://careers.examplesoftech.example/jobs/qa-engineer-fresher");
    const pasted = await saveListing(
      manual({
        title: "Quality Analyst",
        company: "Someone Else",
        url: "https://www.careers.examplesoftech.example/jobs/qa-engineer-fresher/?utm_campaign=whatsapp#top",
      }),
    );
    expect(pasted.id).toBe(first.id);
  });

  it("refreshes details when the same source sends the job again", async () => {
    const first = await saveListing(jsearchJobs[1]!);
    const again = await saveListing({ ...jsearchJobs[1]!, description: "Updated description" });
    expect(again.id).toBe(first.id);
    expect(again.description).toBe("Updated description");
  });

  it("treats a repost after 30 days as a new listing", async () => {
    const old = new Date("2026-09-01T00:00:00Z");
    const first = await saveListing(manual({ sourceId: "a" }), { now: old });
    const later = await saveListing(manual({ sourceId: "b" }), { now: new Date(old.getTime() + DEDUPE_WINDOW_MS + 1000) });
    expect(later.id).not.toBe(first.id);
  });

  it("does not merge jobs whose company or title is blank", async () => {
    const a = await saveListing(manual({ sourceId: "x1", company: "", title: "Tester" }));
    const b = await saveListing(manual({ sourceId: "x2", company: "", title: "Tester" }));
    expect(a.id).not.toBe(b.id);
  });

  it("survives two requests saving the same new posting at once", async () => {
    const job = manual({ sourceId: "race", company: "Race Co", title: "QA" });
    const [a, b] = await Promise.all([saveListing(job), saveListing(job)]);
    expect(a.id).toBe(b.id);
    expect(await getPrisma().jobListing.count({ where: { sourceId: "race" } })).toBe(1);
  });
});
