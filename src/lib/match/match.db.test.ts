import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import type { ProfileData } from "@/lib/profile";
import { createTestClient, resetDatabase } from "@/test/db";

import type { MatchPreferences } from "./preferences";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: "ANTHROPIC" }) }));
vi.spyOn(console, "error").mockImplementation(() => {});

// The profile and the AI scorer, as the test sets them.
const ai = vi.hoisted(() => ({ profile: undefined as unknown, failWith: undefined as unknown, scored: [] as string[] }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => ai.profile }));
vi.mock("@/lib/scoring", () => ({
  loadPostingScorer: async () => async (posting: { title: string }) => {
    ai.scored.push(posting.title);
    if (ai.failWith) throw ai.failWith;
    // Analysts fit best; everything else less well.
    const score = /analyst/i.test(posting.title) ? 86 : /data/i.test(posting.title) ? 70 : 40;
    return { data: { score, reasons: [`Fits ${posting.title}`], redFlags: ["Asks for Tableau"] }, scoredWith: "score-posting@test" };
  },
}));

const { rankPool } = await import("./rank");
const { searchQueries } = await import("./query");
const { MATCH_RUN_KEY, NOTHING_TO_LOOK_FOR, startMatchRun } = await import("./jobs");
const { getJob } = await import("@/lib/jobs/runner");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());

async function eventually(check: () => Promise<void>, timeout = 10_000) {
  const started = Date.now();
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

const preferences = (overrides: Partial<MatchPreferences> = {}): MatchPreferences => ({
  titles: ["Data Analyst"],
  skills: ["SQL", "Python"],
  countries: ["in"],
  cities: [],
  remoteOk: true,
  level: "entry",
  employmentTypes: [],
  ...overrides,
});

const profile = (headline: string, skills: string[]) =>
  ({ basics: { headline, country: "India" }, skills: skills.map((name) => ({ name })), experience: [] }) as unknown as ProfileData;

let companyId = "";
async function posting(externalId: string, data: { title: string; description?: string; location?: string; country?: string; remote?: boolean | null; employmentType?: string; closed?: boolean }) {
  const row = await raw().sharedPosting.create({
    data: {
      companyId,
      system: "GREENHOUSE",
      externalId,
      title: data.title,
      companyName: "Acme",
      location: data.location ?? "Bengaluru",
      country: data.country ?? "in",
      remote: data.remote ?? null,
      employmentType: data.employmentType ?? "",
      description: data.description ?? "",
      url: `https://acme.example/${externalId}`,
      applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${externalId}`,
      closedAt: data.closed ? new Date() : null,
      dedupeKey: externalId,
      contentHash: "v1",
    },
  });
  return row.id;
}

beforeEach(async () => {
  // A blank database with the test student in it. Without this the file relied on whichever
  // test file ran before it having left that student there, and failed when it hadn't (six
  // tests, "Foreign key constraint violated", seen once on 11 November 2026).
  await resetDatabase(prisma());
  await raw().job.deleteMany();
  await raw().jobMatch.deleteMany();
  await raw().sharedPosting.deleteMany();
  await raw().company.deleteMany();
  await raw().user.deleteMany({ where: { id: "other-student" } });
  companyId = (await raw().company.create({ data: { name: "Acme", system: "GREENHOUSE", boardToken: "acme" } })).id;
  ai.profile = profile("Data Analyst", ["SQL", "Python"]);
  ai.failWith = undefined;
  ai.scored = [];
});
afterAll(() => prisma().$disconnect());

describe("ranking the shared pool (auto-apply step 3)", () => {
  it("puts jobs whose title matches above ones that only mention the skills", async () => {
    const titleMatch = await posting("1", { title: "Data Analyst", description: "Reporting with SQL." });
    const bodyOnly = await posting("2", { title: "Operations Associate", description: "Some SQL and Python helps." });
    await posting("3", { title: "Sales Executive", description: "Meet customers." });
    const ranked = await rankPool("test-student", preferences(), searchQueries(preferences())!, 10);
    expect(ranked.map((job) => job.id)).toEqual([titleMatch, bodyOnly]);
    expect(ranked[0].rank).toBeGreaterThan(ranked[1].rank);
  });

  it("leaves out closed jobs, other countries, senior roles for freshers, and jobs already shortlisted", async () => {
    const keep = await posting("keep", { title: "Data Analyst" });
    await posting("closed", { title: "Data Analyst", closed: true });
    await posting("us", { title: "Data Analyst", location: "New York", country: "us" });
    await posting("senior", { title: "Senior Data Analyst" });
    await posting("lead", { title: "Data Analyst Lead" });
    const remote = await posting("remote", { title: "Data Analyst", location: "Remote - Worldwide", country: "", remote: true });
    const shortlisted = await posting("shortlisted", { title: "Data Analyst" });
    await raw().jobMatch.create({ data: { userId: "test-student", sharedPostingId: shortlisted, rank: 1 } });

    const ids = (await rankPool("test-student", preferences(), searchQueries(preferences())!, 10)).map((job) => job.id);
    expect(ids.sort()).toEqual([keep, remote].sort());
    // Experienced students see senior roles; without remote, the worldwide one goes.
    const experienced = (await rankPool("test-student", preferences({ level: "experienced", remoteOk: false }), searchQueries(preferences())!, 10)).map((job) => job.id);
    expect(experienced).not.toContain(remote);
    expect(experienced).toHaveLength(3);
  });

  it("narrows to the student's cities, and to internships or away from them", async () => {
    const pune = await posting("pune", { title: "Data Analyst", location: "Pune, India" });
    const intern = await posting("intern", { title: "Data Analyst Intern", location: "Bengaluru" });
    const internType = await posting("intern-type", { title: "Data Analyst", employmentType: "Internship" });
    const query = searchQueries(preferences())!;
    expect((await rankPool("test-student", preferences({ cities: ["Pune"], remoteOk: false }), query, 10)).map((job) => job.id)).toEqual([pune]);
    expect((await rankPool("test-student", preferences({ employmentTypes: ["internship"] }), query, 10)).map((job) => job.id).sort()).toEqual([intern, internType].sort());
    expect((await rankPool("test-student", preferences({ employmentTypes: ["full-time"] }), query, 10)).map((job) => job.id)).toEqual([pune]);
  });
});

describe("a match run (auto-apply step 3)", () => {
  it("shortlists from the profile, then scores each job and puts it in a tier", async () => {
    await posting("1", { title: "Data Analyst", description: "SQL dashboards." });
    await posting("2", { title: "Data Engineer", description: "Python and SQL pipelines." });
    await posting("3", { title: "Sales Executive", description: "Meet customers." });
    const runId = await startMatchRun();
    await eventually(async () => expect(await getJob(runId)).toMatchObject({ status: "DONE", result: { shortlisted: 2, problem: null } }));
    await eventually(async () => expect(await prisma().jobMatch.count({ where: { status: "SCORED" } })).toBe(2));

    const matches = await prisma().jobMatch.findMany({ include: { sharedPosting: { select: { title: true } } }, orderBy: { score: "desc" } });
    expect(matches.map((match) => [match.sharedPosting.title, match.score, match.tier])).toEqual([
      ["Data Analyst", 86, "STRONG"],
      ["Data Engineer", 70, "GOOD"],
    ]);
    expect(matches[0]).toMatchObject({ reasons: ["Fits Data Analyst"], redFlags: ["Asks for Tableau"], scoredWith: "score-posting@test", error: null });
    // The job whose title is the target role ranks first, and its scoring was queued first.
    expect(matches[0].rank).toBeGreaterThan(matches[1].rank);
    const scoring = await prisma().job.findMany({ where: { type: "score-match" }, select: { key: true, priority: true } });
    const priorityOf = (matchId: string) => scoring.find((job) => job.key === `match:${matchId}`)?.priority ?? -1;
    expect(priorityOf(matches[0].id)).toBeGreaterThan(priorityOf(matches[1].id));

    // A second run finds nothing new and scores nothing again.
    const again = await startMatchRun();
    await eventually(async () => expect(await getJob(again)).toMatchObject({ status: "DONE", result: { shortlisted: 0 } }));
    expect(ai.scored).toHaveLength(2);
  });

  it("follows the run already under way instead of starting a second", async () => {
    const [first, second] = [await startMatchRun(), await startMatchRun()];
    expect(second).toBe(first);
    await eventually(async () => expect(await getJob(first)).toMatchObject({ status: "DONE" }));
    expect(await prisma().job.count({ where: { key: MATCH_RUN_KEY } })).toBe(1);
  });

  it("says what to add when the profile gives nothing to look for", async () => {
    ai.profile = profile("", []);
    const runId = await startMatchRun();
    await eventually(async () => expect(await getJob(runId)).toMatchObject({ status: "DONE", result: { shortlisted: 0, problem: NOTHING_TO_LOOK_FOR } }));
  });

  it("keeps a failure the AI won't get past with the match, in the student's words", async () => {
    await posting("1", { title: "Data Analyst" });
    ai.failWith = AiError.of("auth");
    await startMatchRun();
    await eventually(async () => expect(await prisma().jobMatch.findFirst()).toMatchObject({ status: "FAILED" }));
    const match = await prisma().jobMatch.findFirstOrThrow();
    expect(match.error).toBe("The server didn't accept the API key. Check it in Settings → AI provider.");
    expect(match.tier).toBeNull();
  });

  it("keeps each student's matches to themselves, and shortlists the same job for both", async () => {
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    await posting("1", { title: "Data Analyst" });
    const mine = await startMatchRun();
    await eventually(async () => expect(await getJob(mine)).toMatchObject({ status: "DONE", result: { shortlisted: 1 } }));
    const theirs = await runAsUser("other-student", () => startMatchRun());
    await eventually(async () => expect(await runAsUser("other-student", () => getJob(theirs))).toMatchObject({ status: "DONE", result: { shortlisted: 1 } }));

    expect(await prisma().jobMatch.count()).toBe(1);
    expect(await runAsUser("other-student", () => prisma().jobMatch.count())).toBe(1);
    expect(await raw().jobMatch.count()).toBe(2);
    const others = await runAsUser("other-student", () => prisma().jobMatch.findMany({ select: { id: true } }));
    expect(await prisma().jobMatch.findUnique({ where: { id: others[0].id } })).toBeNull();
  });
});
