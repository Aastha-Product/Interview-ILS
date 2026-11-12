import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResumeReview } from "@/lib/ai/tasks/review-resume";
import type { ImportedProfile } from "@/lib/profile-import";
import { createTestClient, resetDatabase } from "@/test/db";

// The actions run against the test database, signed in as the test student.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ userId: "test-student", persistent: false, version: 0, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { importAnalysisIntoProfile } from "./actions";
import { saveResumeAnalysis } from "@/lib/resume-analysis";

const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const review: ResumeReview = { overview: "A clear resume.", strengths: [], improvements: [], missing: [] };

function profileWith(skills: string[], role: string): ImportedProfile {
  return {
    basics: { name: "Asha Rao", city: "Bengaluru", summary: "Backend engineer." },
    skills: skills.map((name) => ({ name, found: true })),
    languages: [],
    experience: [
      { role, company: "Acme", location: "Bengaluru", descriptor: "", bullets: "Built APIs.", skills: [], startYear: 2021, startMonth: 6, endYear: null, endMonth: null, current: true, unverified: [] },
    ],
    projects: [],
    education: [],
    publications: [],
    references: [],
  };
}

const saveAnalysis = (profile: ImportedProfile) =>
  saveResumeAnalysis({ fileName: "resume.pdf", profile, review, readWith: "extract-profile@4", profileFilled: false });

describe("importAnalysisIntoProfile (Pathfinder, Phase C: add a resume to an existing profile)", () => {
  it("merges a saved analysis into the profile", async () => {
    const id = await saveAnalysis(profileWith(["Python", "Django"], "Backend Engineer"));

    const result = await importAnalysisIntoProfile({ id });
    expect(result.ok).toBe(true);

    const skills = await prisma().skill.findMany({ select: { name: true } });
    expect(skills.map((s) => s.name).sort()).toEqual(["Django", "Python"]);
    expect(await prisma().experience.count()).toBe(1);
    const name = await prisma().profileField.findFirst({ where: { key: "name" }, select: { value: true } });
    expect(name?.value).toBe("Asha Rao");
  });

  it("adds to an existing profile without removing what's already there", async () => {
    // First resume populates the profile.
    await importAnalysisIntoProfile({ id: await saveAnalysis(profileWith(["Python", "Django"], "Backend Engineer")) });
    // A newer resume brings a new skill and a new role.
    const result = await importAnalysisIntoProfile({ id: await saveAnalysis(profileWith(["Python", "Kubernetes"], "Platform Engineer")) });
    expect(result.ok).toBe(true);

    const skills = await prisma().skill.findMany({ select: { name: true } });
    expect(skills.map((s) => s.name).sort()).toEqual(["Django", "Kubernetes", "Python"]);
    const roles = await prisma().experience.findMany({ select: { role: true } });
    expect(roles.map((r) => r.role).sort()).toEqual(["Backend Engineer", "Platform Engineer"]);
  });

  it("reports a friendly error when the analysis is gone", async () => {
    const result = await importAnalysisIntoProfile({ id: "no-such-analysis" });
    expect(result).toMatchObject({ ok: false });
  });
});
