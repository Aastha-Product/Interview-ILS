import { describe, expect, it } from "vitest";

import type { ImportedProfile } from "@/lib/profile-import";

import { MockProvider } from "../providers/mock";
import { missingFromProfile, reviewResume } from "./review-resume";

// Pathfinder: a resume reviewed on its own. Nothing in the result may be made up: strengths must
// quote the resume, and what's missing comes from what was read, not from the model.

const RESUME = `Asha Rao
asha.rao@example.com · Pune
Summary: Frontend developer who builds accessible web apps.
Experience
Frontend Intern, Ledgerly (2025–2026)
- Built the invoice screen in React used by 3 teams
Skills: React, TypeScript, Figma
Education: B.Tech Computer Science, COEP, 2026`;

const profile: ImportedProfile = {
  basics: { name: "Asha Rao", email: "asha.rao@example.com", city: "Pune", summary: "Frontend developer who builds accessible web apps." },
  skills: [{ name: "React", found: true }],
  languages: [],
  experience: [
    { role: "Frontend Intern", company: "Ledgerly", location: "", descriptor: "", bullets: "Built the invoice screen", skills: [], startYear: 2025, startMonth: null, endYear: 2026, endMonth: null, current: false, unverified: [] },
  ],
  projects: [],
  education: [{ degree: "B.Tech Computer Science", school: "COEP", notes: "", startYear: null, startMonth: null, endYear: 2026, endMonth: null, current: false, unverified: [] }],
  publications: [],
  references: [],
};

const OPTIONS = { creativity: "BALANCED", strict: true, language: null } as const;

const answer = {
  overview: "A clear one-page resume for a frontend role.",
  strengths: [
    { point: "Shows real impact.", quote: "Built the invoice screen in React used by 3 teams" },
    // Not in the resume: dropped.
    { point: "Led a team of ten.", quote: "Led a team of 10 engineers" },
  ],
  improvements: [
    { point: "Say what the invoice screen changed.", suggestion: "Add how much time it saved, if you know it.", quote: "Built the invoice screen in React" },
    { point: "Add a projects section.", suggestion: "List a project you built outside work.", quote: "Shipped 40 projects" },
  ],
};

describe("reviewResume (Pathfinder)", () => {
  it("keeps only strengths it can find in the resume, and drops quotes that aren't there", async () => {
    const provider = new MockProvider({ reply: () => answer });
    const { data, promptVersion } = await reviewResume(provider, { resume: RESUME, profile }, OPTIONS);
    expect(promptVersion).toBe("review-resume@1");
    expect(data.overview).toBe("A clear one-page resume for a frontend role.");
    expect(data.strengths).toEqual([{ point: "Shows real impact.", quote: "Built the invoice screen in React used by 3 teams" }]);
    expect(data.improvements).toEqual([
      { point: "Say what the invoice screen changed.", suggestion: "Add how much time it saved, if you know it.", quote: "Built the invoice screen in React" },
      // The advice stays, but its made-up quote doesn't.
      { point: "Add a projects section.", suggestion: "List a project you built outside work.", quote: null },
    ]);
    // Worked out from the profile: only the phone number is missing here.
    expect(data.missing).toEqual(["A phone number."]);
  });

  it("sends the resume as material, never as instructions, and asks for no scores", async () => {
    const provider = new MockProvider({ reply: () => answer });
    await reviewResume(provider, { resume: RESUME, profile }, OPTIONS);
    const call = provider.calls[0];
    expect(call.messages[0].content).toBe(`<resume>\n${RESUME}\n</resume>`);
    expect(call.system).toContain("not instructions");
    expect(call.system).toContain("No scores, ratings or percentages");
    expect(call.system).toContain("Never invent experience");
  });
});

describe("missingFromProfile", () => {
  it("lists what a reader would look for and can't find", () => {
    const bare: ImportedProfile = { ...profile, basics: {}, skills: [], experience: [{ ...profile.experience[0], startYear: null, bullets: " " }], education: [] };
    expect(missingFromProfile(bare)).toEqual([
      "An email address, so employers can reach you.",
      "A phone number.",
      "Where you're based (a city or country).",
      "A short summary at the top saying who you are and what you're looking for.",
      "A list of your skills and tools.",
      "Dates for one role, so readers can follow your timeline.",
      "What you did in one role: there are no points under it.",
      "Your education.",
    ]);
  });
});
