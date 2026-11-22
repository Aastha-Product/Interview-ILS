import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});

const { loadPublicJobs } = await import("./public-jobs-data");

const raw = () => rawClientOf(db.client!);
const now = new Date("2026-11-21T10:00:00Z");
const all = { q: "", city: "", remote: false, page: 1 };

async function posting(companyId: string, id: string, data: Record<string, unknown> = {}) {
  return raw().sharedPosting.create({
    data: {
      companyId,
      system: "GREENHOUSE",
      externalId: id,
      title: "Data Analyst",
      companyName: "Groww",
      location: "Bengaluru",
      country: "in",
      description: "SQL.",
      url: `https://job-boards.greenhouse.io/groww/jobs/${id}`,
      applyUrl: `https://job-boards.greenhouse.io/groww/jobs/${id}`,
      dedupeKey: id,
      contentHash: "v1",
      ...data,
    },
  });
}

beforeEach(async () => {
  await resetDatabase(db.client!);
  await raw().sharedPosting.deleteMany();
  await raw().company.deleteMany();
});
afterAll(() => db.client!.$disconnect());

describe("the open jobs board's jobs (Phase 5)", () => {
  it("lists open jobs in India and remote ones, newest first, and searches them", async () => {
    const groww = (await raw().company.create({ data: { name: "Groww", system: "GREENHOUSE", boardToken: "groww" } })).id;
    const atlan = (await raw().company.create({ data: { name: "Atlan", system: "ASHBY", boardToken: "atlan" } })).id;
    await posting(groww, "old", { postedAt: new Date("2026-11-10T00:00:00Z") });
    await posting(groww, "new", { title: "Business Analyst", postedAt: new Date("2026-11-20T00:00:00Z") });
    await posting(atlan, "remote", { companyName: "Atlan", title: "Backend Engineer", location: "Remote", country: "", remote: true, postedAt: new Date("2026-11-15T00:00:00Z") });
    // Closed, or in another country: never shown.
    await posting(groww, "closed", { closedAt: new Date() });
    await posting(groww, "us", { country: "us", location: "New York" });
    // A link that isn't an ordinary web address isn't given out.
    await posting(atlan, "bad-link", { companyName: "Atlan", title: "QA", location: "Pune", url: "javascript:alert(1)", postedAt: new Date("2026-11-01T00:00:00Z") });

    const view = await loadPublicJobs(all, now);
    expect(view.jobs.map((job) => job.id)).toHaveLength(4);
    expect(view.jobs.map((job) => job.title)).toEqual(["Business Analyst", "Backend Engineer", "Data Analyst", "QA"]);
    expect(view).toMatchObject({ total: 4, companies: 2, pages: 1 });
    expect(view.jobs[0]).toMatchObject({ company: "Groww", posted: "Yesterday", url: "https://job-boards.greenhouse.io/groww/jobs/new" });
    expect(view.jobs[3].url).toBe("");

    expect((await loadPublicJobs({ ...all, q: "analyst" }, now)).jobs.map((job) => job.title)).toEqual(["Business Analyst", "Data Analyst"]);
    expect((await loadPublicJobs({ ...all, q: "atlan" }, now)).total).toBe(2);
    expect((await loadPublicJobs({ ...all, city: "bengaluru" }, now)).total).toBe(2);
    expect((await loadPublicJobs({ ...all, remote: true }, now)).jobs.map((job) => job.title)).toEqual(["Backend Engineer"]);
  });
});
