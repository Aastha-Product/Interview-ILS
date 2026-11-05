import { createAiClient, createMockProvider } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { getDashboard } from "../src/applications/dashboard";
import { DEMO_JOBS, seedDemoData } from "../src/demo/seed";
import { listMatches } from "../src/jobs/match";

const ai = createAiClient({ provider: createMockProvider() });
const now = new Date("2026-11-05T06:00:00Z");
let userId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("demo@example.test")).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("seedDemoData", () => {
  it("fills an empty account so every screen has something to show", async () => {
    const db = scopedDb(userId);
    const result = await seedDemoData({ db, ai }, { now });
    expect(result).toEqual({ jobs: 8, applications: 7, drafted: 3, pdfsQueued: 0 });

    // Jobs page: eight scored jobs with reasons.
    const matches = await listMatches(db);
    expect(matches).toHaveLength(8);
    expect(matches.every((m) => m.score > 0 && m.score < 100)).toBe(true);

    // Dashboard: 6 sent, 4 replies (response, rejection, interview, response), over several weeks.
    const dashboard = await getDashboard(db, now);
    expect(dashboard.totals).toMatchObject({ sent: 6, responses: 4, interviews: 1, drafts: 1 });
    expect(dashboard.totals.responseRate).toBeCloseTo(4 / 6, 5);
    expect(dashboard.weeks.filter((w) => w.sent > 0).length).toBeGreaterThanOrEqual(4);
    expect(dashboard.byStatus).toMatchObject({ DRAFT: 1, APPLIED: 2, RESPONSE: 2, INTERVIEW: 1, REJECTED: 1 });

    // Every application that is still a draft has one (none is stuck at "Drafting…"), three in all.
    const drafts = await db.application.findMany({ where: { status: "DRAFT" }, include: { documents: true } });
    expect(drafts.every((a) => a.documents.length > 0)).toBe(true);
    expect(await db.generatedDocument.count({ where: { kind: "RESUME" } })).toBe(3);
    expect(await db.generatedDocument.count({ where: { kind: "ANSWERS" } })).toBe(3);

    // Everything is clearly fictional.
    expect(DEMO_JOBS.every((j) => j.company.endsWith("(demo)") || j.company.startsWith("Example"))).toBe(true);
  });

  it("refuses an account that already has data, and touches nothing", async () => {
    const db = scopedDb(userId);
    await seedDemoData({ db, ai }, { now });
    const before = await db.application.count();
    await expect(seedDemoData({ db, ai }, { now })).rejects.toMatchObject({ code: "NOT_EMPTY", status: 409 });
    expect(await db.application.count()).toBe(before);
  });

  it("only writes to the account it was given", async () => {
    const other = (await createUser("someone@example.test")).id;
    await seedDemoData({ db: scopedDb(userId), ai }, { now });
    expect(await scopedDb(other).application.count()).toBe(0);
    expect(await scopedDb(other).profile.count()).toBe(0);
  });
});
