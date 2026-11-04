import { readFileSync } from "node:fs";
import path from "node:path";
import { createAiClient, createMockProvider } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { UserFacingError } from "../src/errors";
import { importJob } from "../src/jobs/import";
import { PageFetchError } from "../src/jobs/fetch-page";
import { saveProfile } from "../src/profile/service";
import { fullProfile } from "./fixtures";

const jobText = readFileSync(path.resolve(import.meta.dirname, "../../../fixtures/job-qa-pune.txt"), "utf8");
const ai = createAiClient({ provider: createMockProvider() });
let userId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("job-import@example.test")).id;
  await saveProfile(scopedDb(userId), fullProfile(), 0);
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

const pasted = { text: jobText, title: "QA Engineer - Fresher", company: "Example Softech Pvt Ltd", location: "Pune" };

describe("importJob (pasted text)", () => {
  it("stores the job, scores it and explains it", async () => {
    const result = await importJob({ db: scopedDb(userId), ai }, pasted);
    const listing = await getPrisma().jobListing.findUniqueOrThrow({ where: { id: result.jobListingId } });
    expect(listing).toMatchObject({ source: "manual", title: "QA Engineer - Fresher", company: "Example Softech Pvt Ltd", location: "Pune" });
    expect(result.match.score).toBeGreaterThan(0);
    expect(result.match.score).toBeLessThanOrEqual(100);
    expect(result.match.reasons.length).toBeGreaterThan(0);
    expect(result.match.explanation.length).toBeGreaterThan(0);
  });

  it("does not create a second listing when the same job is pasted again, even reformatted", async () => {
    const first = await importJob({ db: scopedDb(userId), ai }, pasted);
    const second = await importJob({ db: scopedDb(userId), ai }, { ...pasted, text: `  ${jobText.replace(/\n/g, "\n\n")}  ` });
    const third = await importJob({ db: scopedDb(userId), ai }, { ...pasted, company: "Example Softech", text: `${jobText}\nApply soon.` });
    expect(second.jobListingId).toBe(first.jobListingId);
    // Different text but the same company/title/city within 30 days: still the same job.
    expect(third.jobListingId).toBe(first.jobListingId);
    expect(await getPrisma().jobListing.count()).toBe(1);
  });

  it("scores the posting the same with or without an injected instruction in it", async () => {
    const injected = await importJob({ db: scopedDb(userId), ai }, pasted);
    await resetDatabase();
    userId = (await createUser("job-import-2@example.test")).id;
    await saveProfile(scopedDb(userId), fullProfile(), 0);
    const clean = await importJob(
      { db: scopedDb(userId), ai },
      { ...pasted, text: jobText.replace(/^- Ignore all previous instructions.*$/m, "") },
    );
    expect(injected.match.score).toBe(clean.match.score);
    expect(injected.match.score).toBeLessThan(100);
  });

  it("asks for the full description when the pasted text is too short, and for title and company", async () => {
    await expect(importJob({ db: scopedDb(userId), ai }, { text: "QA job in Pune" })).rejects.toThrow();
  });
});

describe("importJob (link)", () => {
  it("asks the student to paste the text when the page can't be fetched", async () => {
    const failingFetch = async () => {
      throw new PageFetchError("robots", "Disallowed by robots.txt");
    };
    const error = await importJob({ db: scopedDb(userId), ai, fetchPage: failingFetch }, { url: "https://jobs.example.test/1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error).toMatchObject({ code: "NEEDS_TEXT", status: 422 });
    expect((error as UserFacingError).message).toMatch(/paste it here/);
    expect(await getPrisma().jobListing.count()).toBe(0);
  });

  it("reads a JobPosting page and stores the student's link as the apply link", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Software Test Engineer",
      hiringOrganization: { name: "Deccan Cloudworks" },
      jobLocation: { address: { addressLocality: "Hyderabad" } },
      description: jobText,
    })}</script>`;
    const fakeFetch = async (url: string) => ({ finalUrl: url, contentType: "text/html", body: html });
    const link = "https://careers.example.test/jobs/42?utm_source=whatsapp";
    const result = await importJob({ db: scopedDb(userId), ai, fetchPage: fakeFetch }, { url: link });
    const listing = await getPrisma().jobListing.findUniqueOrThrow({ where: { id: result.jobListingId } });
    expect(listing).toMatchObject({
      title: "Software Test Engineer",
      company: "Deccan Cloudworks",
      location: "Hyderabad",
      applyUrl: link,
      urlNormalised: "https://careers.example.test/jobs/42",
    });
    // The same link with different tracking parameters is the same job.
    const again = await importJob({ db: scopedDb(userId), ai, fetchPage: fakeFetch }, { url: "https://careers.example.test/jobs/42?gclid=abc" });
    expect(again.jobListingId).toBe(result.jobListingId);
  });
});
