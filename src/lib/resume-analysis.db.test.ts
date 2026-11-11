import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageLevel } from "@/generated/prisma/enums";
import { EMPTY_QUERY } from "@/lib/job-search/search";
import { runAsUser } from "@/lib/owner/context";
import type { ImportedProfile } from "@/lib/profile-import";
import { settingsFromRows } from "@/lib/settings";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

import { fillProfileIfEmpty } from "./resume-analysis";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const asUser = <T>(fn: () => Promise<T>) => runAsUser(TEST_USER_ID, fn);

const noDates = { startYear: null, startMonth: null, endYear: null, endMonth: null, current: false };
const profile = (over: Partial<ImportedProfile> = {}): ImportedProfile => ({
  basics: { name: "Asha Rao", headline: "ML Engineer", city: "Bengaluru", country: "India" },
  skills: [{ name: "python", found: true }],
  languages: [{ name: "English", level: LanguageLevel.C2, levelGiven: true }],
  experience: [
    { role: "Data Scientist", company: "Acme", location: "Bengaluru", descriptor: "", bullets: "Built models", skills: ["python"], ...noDates, unverified: [] },
  ],
  projects: [],
  education: [],
  publications: [],
  references: [],
  ...over,
});

/** The Job agent search saved for the test student, decoded as the app reads it (empty when none). */
const savedAgentQuery = () => asUser(async () => settingsFromRows(await prisma().setting.findMany({ where: { key: "agentQuery" } })).agentQuery);

/** Whether a Job agent search was written at all. */
const agentQueryWritten = () => asUser(async () => (await prisma().setting.count({ where: { key: "agentQuery" } })) > 0);

describe("fillProfileIfEmpty seeds the Job agent search (Pathfinder)", () => {
  it("fills the search from the first resume, taking the title, city and country", async () => {
    expect(await asUser(() => fillProfileIfEmpty(profile()))).toBe(true);
    expect(await savedAgentQuery()).toMatchObject({ keywords: "Data Scientist", place: "Bengaluru", country: "in" });
  });

  it("keeps a search the student already typed, filling only what's still empty", async () => {
    await asUser(() => saveSettings({ agentQuery: { ...EMPTY_QUERY, keywords: "Product manager" } }));
    expect(await asUser(() => fillProfileIfEmpty(profile()))).toBe(true);
    expect(await savedAgentQuery()).toMatchObject({ keywords: "Product manager", place: "Bengaluru", country: "in" });
  });

  it("leaves the search alone when the profile already has something, so nothing is filled", async () => {
    expect(await asUser(() => fillProfileIfEmpty(profile()))).toBe(true);
    // A second resume finds the profile filled and changes nothing.
    const before = await savedAgentQuery();
    expect(await asUser(() => fillProfileIfEmpty(profile({ basics: { headline: "Totally different", city: "Pune", country: "India" } })))).toBe(false);
    expect(await savedAgentQuery()).toEqual(before);
  });

  it("saves no search when the resume has no title, city or country", async () => {
    expect(await asUser(() => fillProfileIfEmpty(profile({ basics: { name: "Asha Rao" }, experience: [] })))).toBe(true);
    expect(await agentQueryWritten()).toBe(false);
  });
});
