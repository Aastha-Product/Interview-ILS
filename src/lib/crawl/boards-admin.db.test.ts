import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.spyOn(console, "error").mockImplementation(() => {});

// Boards the test controls, by token: the jobs each lists, or the error it gives.
const boards = vi.hoisted(() => ({ jobs: {} as Record<string, { countries: string[]; remote: boolean | null; location: string }[]>, errors: {} as Record<string, unknown> }));
vi.mock("./adapters", () => {
  const fake = {
    list: async ({ boardToken }: { boardToken: string }) => {
      if (boards.errors[boardToken]) throw boards.errors[boardToken];
      return (boards.jobs[boardToken] ?? []).map((job, index) => ({ externalId: `${boardToken}-${index}`, ...job }));
    },
  };
  return { ADAPTERS: { GREENHOUSE: fake, LEVER: fake, ASHBY: fake, SMARTRECRUITERS: fake } };
});

const { addJobBoards, loadJobBoards, parseCountries, setJobBoardActive } = await import("./boards-admin");
const { CrawlError } = await import("./http");

const raw = () => rawClientOf(db.client!);
const now = new Date("2026-11-21T10:00:00Z");
const india = { countries: ["in"], remote: false, location: "Bengaluru" };
const us = { countries: ["us"], remote: false, location: "New York" };

beforeEach(async () => {
  await resetDatabase(db.client!);
  boards.jobs = {};
  boards.errors = {};
});
afterAll(() => db.client!.$disconnect());

describe("Admin → Job boards (Phase 2)", () => {
  it("adds a pasted board that exists and has jobs in the countries, and nothing else", async () => {
    boards.jobs = { okta: [india, india, us], acme: [us], empty: [] };
    boards.errors = { gone: new CrawlError("gone", "No such board."), down: new CrawlError("unavailable", "Down.") };
    await raw().company.create({ data: { name: "Meesho", system: "LEVER", boardToken: "meesho" } });

    const { results, unread, overLimit } = await addJobBoards(
      [
        "https://job-boards.greenhouse.io/okta",
        "https://jobs.lever.co/MEESHO",
        "https://jobs.lever.co/acme",
        "https://jobs.lever.co/empty",
        "https://jobs.ashbyhq.com/gone",
        "https://jobs.ashbyhq.com/down",
        "https://www.naukri.com/acme",
      ].join("\n"),
      ["in"],
      now,
    );
    expect(results.map((entry) => [entry.board.boardToken, entry.kind])).toEqual([
      ["okta", "added"],
      ["meesho", "exists"],
      ["acme", "no-jobs"],
      ["empty", "no-jobs"],
      ["gone", "not-found"],
      ["down", "unavailable"],
    ]);
    expect(results[0]).toMatchObject({ relevantJobs: 2 });
    expect(unread).toEqual(["https://www.naukri.com/acme"]);
    expect(overLimit).toBe(0);
    const added = await raw().company.findMany({ orderBy: { boardToken: "asc" }, select: { name: true, system: true, boardToken: true, countries: true, active: true, nextCrawlAt: true } });
    expect(added).toEqual([
      { name: "Meesho", system: "LEVER", boardToken: "meesho", countries: ["in"], active: true, nextCrawlAt: expect.any(Date) },
      // Due at once, so the crawler's next look reads it.
      { name: "Okta", system: "GREENHOUSE", boardToken: "okta", countries: ["in"], active: true, nextCrawlAt: now },
    ]);
  });

  it("lists the boards, active first with the most jobs, and pauses or resumes one", async () => {
    const okta = await raw().company.create({ data: { name: "Okta", system: "GREENHOUSE", boardToken: "okta", openJobs: 105 } });
    await raw().company.create({ data: { name: "Glance", system: "GREENHOUSE", boardToken: "glance", openJobs: 22 } });
    const gone = await raw().company.create({ data: { name: "Acme", system: "LEVER", boardToken: "acme", active: false, failures: 4, lastError: "No such board." } });

    const view = await loadJobBoards();
    expect(view.boards.map((board) => board.name)).toEqual(["Okta", "Glance", "Acme"]);
    expect(view.totals).toEqual({ boards: 3, active: 2, openJobs: 127 });

    expect(await setJobBoardActive(okta.id, false)).toBe(true);
    expect(await raw().company.findUniqueOrThrow({ where: { id: okta.id } })).toMatchObject({ active: false });
    // Resuming clears the last failure and reads it at the next look.
    expect(await setJobBoardActive(gone.id, true, now)).toBe(true);
    expect(await raw().company.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({ active: true, failures: 0, lastError: null, nextCrawlAt: now });
    expect(await setJobBoardActive("missing", true)).toBe(false);
  });

  it("reads countries as typed, India when none", () => {
    expect(parseCountries("IN, sg  us")).toEqual(["in", "sg", "us"]);
    expect(parseCountries("india")).toEqual(["in"]);
    expect(parseCountries("")).toEqual(["in"]);
  });
});
