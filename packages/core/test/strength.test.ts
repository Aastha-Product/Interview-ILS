import { describe, expect, it } from "vitest";
import { emptyProfile } from "../src/profile/schema";
import { profileStrength } from "../src/profile/strength";
import { fullProfile } from "./fixtures";

describe("profileStrength", () => {
  it("scores an empty profile 0 with three plain-English tips", () => {
    const s = profileStrength(emptyProfile());
    expect(s.score).toBe(0);
    expect(s.label).toBe("Just started");
    expect(s.tips).toHaveLength(3);
    expect(s.tips[0]).toMatch(/headline/i);
  });

  it("scores a complete profile 100 with no tips", () => {
    const s = profileStrength(fullProfile());
    expect(s).toEqual({ score: 100, label: "Strong", tips: [] });
  });

  it("counts projects as much as experience, so freshers without jobs can reach Strong", () => {
    const p = { ...fullProfile(), experiences: [] };
    p.projects.push({ ...p.projects[0]!, name: "Third project" });
    expect(profileStrength(p).score).toBe(100);
  });

  it("asks for more skills when there are fewer than eight", () => {
    const p = { ...fullProfile(), skills: [{ name: "Python", category: "" }] };
    const s = profileStrength(p);
    // 7 missing skills x 2.5 points = 17.5 fewer; 82.5 rounds to 83.
    expect(s.score).toBe(83);
    expect(s.tips.join(" ")).toMatch(/Add 7 more skills/);
  });

  it("is always between 0 and 100 and gives the same answer for the same input", () => {
    const p = fullProfile();
    expect(profileStrength(p)).toEqual(profileStrength(structuredClone(p)));
    expect(profileStrength(p).score).toBeLessThanOrEqual(100);
  });
});
