import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { hasWorkToSummarize } from "./work-summary";

describe("the work summary (Phase 1)", () => {
  it("needs work, projects, studies or skills to write about", () => {
    const empty = { experience: [], projects: [], education: [], skills: [] };
    expect(hasWorkToSummarize(empty)).toBe(false);
    expect(hasWorkToSummarize({ ...empty, skills: demoProfile().skills.slice(0, 1) })).toBe(true);
    expect(hasWorkToSummarize(demoProfile())).toBe(true);
  });
});
