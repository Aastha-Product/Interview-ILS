import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { ANALYSIS_STEPS } from "@/lib/resume-analysis-steps";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

import { analyzeResumeJob } from "./analyze-resume";

// Pathfinder: upload → results with nothing to choose. The job reads the resume, reviews it, fills
// an empty profile, and keeps the results for the student who uploaded it only.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const RESUME = `Asha Rao, asha.rao@example.com, Pune
Frontend Intern, Ledgerly, 2025 to 2026
Built the invoice screen in React used by 3 teams
Skills: React, TypeScript`;

const answers: Record<string, unknown> = {
  extracted_profile: {
    basics: { name: "Asha Rao", headline: null, email: "asha.rao@example.com", phone: null, dob: null, website: null, address: null, city: "Pune", country: null, linkedin: null, summary: null },
    skills: ["React", "TypeScript"],
    languages: [],
    experience: [
      { role: "Frontend Intern", company: "Ledgerly", location: null, descriptor: null, startYear: 2025, startMonth: null, endYear: 2026, endMonth: null, current: false, bullets: ["Built the invoice screen in React used by 3 teams"], skills: ["React"] },
    ],
    projects: [],
    education: [],
    publications: [],
    references: [],
  },
  resume_review: {
    overview: "A short, clear resume for a frontend internship.",
    strengths: [{ point: "Shows impact with a number.", quote: "used by 3 teams" }],
    improvements: [{ point: "Add a summary.", suggestion: "Write two lines about what you want to do next.", quote: null }],
  },
};
const provider = vi.hoisted(() => ({ current: undefined as MockProvider | undefined }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => provider.current!,
}));

const prisma = () => db.client!;
const OTHER = "other-student";

function run(fileName = "Asha CV.pdf") {
  const steps: string[] = [];
  const result = analyzeResumeJob.run({ resume: RESUME, fileName }, { step: async (name: string) => void steps.push(name), signal: new AbortController().signal } as never);
  return { result, steps };
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await rawClientOf(prisma()).user.create({ data: { id: OTHER, email: "other@example.test" } });
  provider.current = new MockProvider({ reply: (call) => answers[call.json?.name ?? ""] });
});
afterAll(() => prisma().$disconnect());

describe("the resume analysis job (Pathfinder)", () => {
  it("reports each real step, reads, reviews and keeps the results", async () => {
    const { result, steps } = run();
    const { analysisId } = await result;
    expect(steps).toEqual(ANALYSIS_STEPS.slice(1));
    // Two AI requests per analysis: reading and reviewing.
    expect(provider.current!.calls.map((call) => call.json?.name)).toEqual(["extracted_profile", "resume_review"]);

    const saved = await prisma().resumeAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(saved).toMatchObject({ fileName: "Asha CV.pdf", profileFilled: true, readWith: "extract-profile@4 review-resume@1" });
    expect(saved.review).toMatchObject({
      overview: "A short, clear resume for a frontend internship.",
      strengths: [{ point: "Shows impact with a number.", quote: "used by 3 teams" }],
      missing: expect.arrayContaining(["A phone number.", "Your education."]),
    });
    // The resume's text isn't kept with the results.
    expect(JSON.stringify(saved)).not.toContain("Built the invoice screen in React used by 3 teams\nSkills");
  });

  it("fills an empty profile from the first resume, and never overwrites one that has content", async () => {
    await run().result;
    expect(await prisma().experience.findMany({ select: { role: true, company: true } })).toEqual([{ role: "Frontend Intern", company: "Ledgerly" }]);

    await prisma().experience.updateMany({ data: { role: "Frontend Developer" } });
    const { analysisId } = await run("Second.pdf").result;
    expect(await prisma().experience.findMany({ select: { role: true } })).toEqual([{ role: "Frontend Developer" }]);
    expect(await prisma().resumeAnalysis.findUniqueOrThrow({ where: { id: analysisId }, select: { profileFilled: true } })).toEqual({ profileFilled: false });
  });

  it("fills the profile once when a new student uploads several resumes at once (QA M-1)", async () => {
    const results = await Promise.allSettled([run("One.pdf").result, run("Two.pdf").result, run("Three.pdf").result]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const filled = await prisma().resumeAnalysis.findMany({ select: { profileFilled: true } });
    expect(filled.filter((analysis) => analysis.profileFilled)).toHaveLength(1);
    expect(filled).toHaveLength(3);
    // One copy of each, not three.
    expect(await prisma().experience.count()).toBe(1);
    expect((await prisma().skill.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((skill) => skill.name)).toEqual(["React", "TypeScript"]);
  });

  it("keeps each student's analyses to themselves", async () => {
    const { analysisId } = await run().result;
    await runAsUser(OTHER, async () => {
      expect(await prisma().resumeAnalysis.findMany()).toEqual([]);
      expect(await prisma().resumeAnalysis.findUnique({ where: { id: analysisId } })).toBeNull();
      expect(await prisma().resumeAnalysis.deleteMany({ where: { id: analysisId } })).toEqual({ count: 0 });
    });
    const owners = await rawClientOf(prisma()).resumeAnalysis.findMany({ select: { userId: true } });
    expect(owners).toEqual([{ userId: TEST_USER_ID }]);
  });
});
