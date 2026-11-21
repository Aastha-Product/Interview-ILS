import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentView } from "./view";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: "JSEARCH", saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
// Each with a link to apply through, which the queue needs (Phase 1); pass url: "" for one without.
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({
    data: { source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, url: `https://jobs.example/${externalId}`, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data },
  });

beforeEach(async () => {
  await resetDatabase(prisma());
  await saveSettings({
    agentEnabled: true,
    agentQuery: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
    agentRuns: [{ at: "2026-10-20T05:00:00Z", manual: false, message: "2 new postings are waiting for a look." }],
  });
});
afterAll(() => prisma().$disconnect());

describe("the Agent screen's data (E16-6)", () => {
  it("splits the queue into drafts and scored postings at 80 or above with a link, best first; the rest is dropped", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    const good = await candidate("good", 85);
    await candidate("better", 88);
    await candidate("middling", 75);
    await candidate("nolink", 95, { url: "" });
    await candidate("low", 30);
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    const job = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${good.id}`, input: { candidateId: good.id } } });

    const view = await loadAgentView(now);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting better", "Posting good"]);
    // Below 80, or without a link: dropped, not listed.
    expect(view.belowMinimum).toEqual([]);
    expect(view.minScore).toBe(80);
    expect(view.scored[1]).toMatchObject({ facts: "Berlin · Remote", origin: "Posted 2 days ago · via LinkedIn on JSearch", draftJobId: job.id });
    expect(view).toMatchObject({
      search: "Data scientist · Berlin, 25 km · via JSearch",
      setupProblem: null,
      limitReached: false,
      lastRun: { at: "Tue 20 Oct, 07:00", message: "2 new postings are waiting for a look." },
      nextRun: "Wed 21 Oct, 07:00",
    });
    // The badge: scored at or above the minimum with a link, and drafts.
    expect(await countAgentQueue()).toBe(3);
  });

  it("hides a blocked company's postings from the list and the badge, but keeps a draft made for one", async () => {
    await saveSettings({ agentBlockedCompanies: ["Infosys"] });
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("drafted", 90, { company: "Infosys", status: "DRAFTED", applicationId: application.id });
    await candidate("blocked", 92, { company: "Infosys BPM Limited" });
    await candidate("kept", 85);

    const view = await loadAgentView(now);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting drafted"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting kept"]);
    expect(await countAgentQueue()).toBe(2);
  });

  it("says what's missing, and when the day's runs are used up", async () => {
    await saveSettings({
      agentEnabled: false,
      agentQuery: { keywords: "", place: "", country: "", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
      agentRuns: ["09:30", "08:00", "06:00"].map((time) => ({ at: `2026-10-20T${time}:00Z`, manual: true, message: null })),
    });
    expect(await loadAgentView(now)).toMatchObject({
      enabled: false,
      search: null,
      setupProblem: "Add what to look for in Settings → Job agent first.",
      setupSection: "agent",
      limitReached: true,
      nextRun: null,
    });
  });
});
