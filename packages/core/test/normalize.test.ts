import type { ResumeDraft } from "@pathfinder/ai";
import { describe, expect, it } from "vitest";
import { draftToProfileInput } from "../src/profile/normalize";
import { LIMITS, profileInputSchema } from "../src/profile/schema";

function draft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return {
    headline: "",
    summary: "",
    location: "",
    phone: "",
    links: [],
    experiences: [],
    projects: [],
    education: [],
    skills: [],
    ...overrides,
  };
}

const project = (name: string, extra: Partial<ResumeDraft["projects"][number]> = {}) => ({
  name,
  role: "",
  url: "",
  startDate: "",
  endDate: "",
  technologies: [],
  highlights: [],
  ...extra,
});

describe("draftToProfileInput", () => {
  it("returns a profile that passes the profile schema", () => {
    const result = draftToProfileInput(draft({ headline: "  QA   fresher  " }));
    expect(profileInputSchema.safeParse(result).success).toBe(true);
    expect(result.headline).toBe("QA fresher");
  });

  it("truncates over-long text to the profile limits", () => {
    const result = draftToProfileInput(
      draft({ headline: "h".repeat(500), summary: "s".repeat(5000), projects: [project("p", { highlights: ["x".repeat(900)] })] }),
    );
    expect(result.headline).toHaveLength(150);
    expect(result.summary).toHaveLength(2000);
    expect(result.projects[0]!.highlights[0]).toHaveLength(300);
  });

  it("caps list lengths", () => {
    const result = draftToProfileInput(
      draft({
        skills: Array.from({ length: 100 }, (_, i) => ({ name: `Skill ${i}`, category: "" })),
        projects: [project("p", { highlights: Array.from({ length: 30 }, (_, i) => `point ${i}`) })],
      }),
    );
    expect(result.skills).toHaveLength(LIMITS.skills);
    expect(result.projects[0]!.highlights).toHaveLength(LIMITS.highlights);
  });

  it("adds https:// to bare links and drops links that are not web addresses", () => {
    const result = draftToProfileInput(
      draft({
        links: [
          { label: "LinkedIn", url: "linkedin.com/in/example" },
          { label: "Bad", url: "javascript:alert(1)" },
          { label: "", url: "https://github.com/example" },
          { label: "Empty", url: "" },
        ],
        projects: [project("p", { url: "ftp://files.example.com/x" })],
      }),
    );
    expect(result.links).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/example" },
      { label: "Link", url: "https://github.com/example" },
    ]);
    expect(result.projects[0]!.url).toBe("");
  });

  it("removes duplicate skills, ignoring case", () => {
    const result = draftToProfileInput(
      draft({ skills: ["Python", "python", " PYTHON ", "SQL", ""].map((name) => ({ name, category: "" })) }),
    );
    expect(result.skills.map((s) => s.name)).toEqual(["Python", "SQL"]);
  });

  it("drops items missing their required field and empty bullet points", () => {
    const result = draftToProfileInput(
      draft({
        projects: [project(""), project("Real", { highlights: ["", "  ", "Did a thing"] })],
        experiences: [
          { title: "", company: "Acme", location: "", startDate: "", endDate: "", current: false, highlights: [] },
          { title: "Intern", company: "", location: "", startDate: "", endDate: "", current: false, highlights: [] },
        ],
        education: [{ institution: " ", degree: "B.Tech", field: "", startDate: "", endDate: "", grade: "" }],
      }),
    );
    expect(result.projects.map((p) => p.name)).toEqual(["Real"]);
    expect(result.projects[0]!.highlights).toEqual(["Did a thing"]);
    expect(result.experiences).toEqual([
      { title: "Intern", company: "", location: "", startDate: "", endDate: "", current: false, highlights: [] },
    ]);
    expect(result.education).toEqual([]);
  });

  it("never adds content that was not in the draft", () => {
    const result = draftToProfileInput(
      draft({
        experiences: [{ title: "Intern", company: "", location: "", startDate: "", endDate: "", current: false, highlights: [] }],
      }),
    );
    const values = JSON.stringify(result);
    // Only the words that came in, plus structural defaults.
    expect(values).not.toMatch(/not stated|unknown|n\/a/i);
    expect(result.experiences[0]!.company).toBe("");
    expect(result.headline).toBe("");
    expect(result.summary).toBe("");
  });
});
