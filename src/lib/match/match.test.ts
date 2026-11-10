import { describe, expect, it } from "vitest";

import type { ProfileData } from "@/lib/profile";

import { experienceMonths, preferencesFromProfile } from "./preferences";
import { forNewGraduates, requiredYears, searchQueries, searchQuery, words } from "./query";
import { tierFor } from "./tiers";

const span = (startYear: number, startMonth: number, endYear: number | null, endMonth: number | null, current = false) => ({
  startYear,
  startMonth,
  endYear,
  endMonth,
  current,
});

describe("the search query (auto-apply step 3)", () => {
  it("cuts terms to letters and digits", () => {
    expect(words("Node.js")).toEqual(["node", "js"]);
    expect(words("C++")).toEqual(["c"]);
    expect(words("Café & Résumé")).toEqual(["cafe", "resume"]);
  });

  it("ORs roles and skills, keeping a phrase's words together, roles first", () => {
    expect(searchQuery({ titles: ["Data Analyst"], skills: ["SQL", "Power BI", "Python", "sql"] })).toBe("(data <-> analyst) | sql | (power <-> bi) | python");
  });

  it("leaves out one-letter words on their own, and gives nothing for nothing", () => {
    expect(searchQuery({ titles: [], skills: ["C", "R", "Go"] })).toBe("go");
    expect(searchQuery({ titles: [" "], skills: ["!!", "C++"] })).toBeNull();
  });

  it("can't be made to break the query's syntax", () => {
    const query = searchQuery({ titles: ["dev') | !(ops"], skills: ["x:* & y", "<-> | !"] });
    expect(query).toMatch(/^[a-z0-9 ()<>|-]+$/);
    expect(query).toBe("(dev <-> ops) | (x <-> y)");
  });

  it("ranks titles by the roles' words without filler, and the whole job by the skills", () => {
    expect(searchQueries({ titles: ["Aspiring Data Analyst", "Business Analyst"], skills: ["SQL", "Power BI"] })).toEqual({
      any: "(data <-> analyst) | (business <-> analyst) | sql | (power <-> bi)",
      roleWords: "data | analyst | business",
      rolePhrases: "(data <-> analyst) | (business <-> analyst)",
      skills: "sql | (power <-> bi)",
    });
    expect(searchQueries({ titles: ["Designer"], skills: [] })).toEqual({ any: "designer", roleWords: "designer", rolePhrases: null, skills: null });
    expect(searchQueries({ titles: [], skills: [] })).toBeNull();
  });
});

describe("how senior a job is (auto-apply step 3)", () => {
  it("reads the fewest years of experience a job asks for", () => {
    expect(requiredYears("Growth Analytics I Exp- 4-6 Years", "")).toBe(4);
    expect(requiredYears("Analyst", "You have 3+ years of experience with SQL.")).toBe(3);
    expect(requiredYears("Analyst", "Experience: 1 to 2 yrs in analytics; 5 years preferred experience")).toBe(1);
    // Years that aren't about experience don't count.
    expect(requiredYears("Analyst", "We are a 20 years old company building payments.")).toBeNull();
    expect(requiredYears("Analyst", "Freshers welcome.")).toBeNull();
  });

  it("keeps senior titles, levels III and up, grades and 3+ years away from new graduates", () => {
    const fresh = (title: string, description = "") => forNewGraduates(title, description);
    expect(fresh("Data Analyst")).toBe(true);
    expect(fresh("Software Engineer II")).toBe(true);
    expect(fresh("Data Analyst", "0-2 years of experience")).toBe(true);
    expect(fresh("Data Scientist III (Team- Valmo)")).toBe(false);
    expect(fresh("Security Engineer IV")).toBe(false);
    expect(fresh("AM/M - Risk Analytics - User Lending")).toBe(false);
    expect(fresh("GM/DGM - Telco Sales")).toBe(false);
    expect(fresh("Team Leader-LRM- Chennai")).toBe(true);
    expect(fresh("Tech Lead")).toBe(false);
    expect(fresh("Business Analytics- Paytm Gold Experience : 5-7 yrs")).toBe(false);
    expect(fresh("Data Analyst", "Minimum 3 years of experience in SQL")).toBe(false);
  });
});

describe("preferences from a profile (auto-apply step 3)", () => {
  const now = new Date("2026-11-10T00:00:00Z");

  it("counts months of experience once where roles overlap", () => {
    expect(experienceMonths([], now)).toBe(0);
    expect(experienceMonths([span(2025, 1, 2025, 6)], now)).toBe(6);
    // Jan–Jun and Apr–Sep overlap: nine months, not twelve.
    expect(experienceMonths([span(2025, 1, 2025, 6), span(2025, 4, 2025, 9)], now)).toBe(9);
    expect(experienceMonths([span(2026, 1, null, null, true)], now)).toBe(11);
    // An undated or backwards entry counts for nothing.
    expect(experienceMonths([{ startYear: null, startMonth: null, endYear: null, endMonth: null, current: false }, span(2025, 6, 2025, 1)], now)).toBe(0);
  });

  it("takes roles, skills and country from the profile, and treats under two years as entry level", () => {
    const profile = {
      basics: { headline: "Aspiring Data Analyst", country: "India" },
      skills: [{ name: "SQL" }, { name: "Python" }, { name: "SQL " }],
      experience: [{ role: "Data Intern", ...span(2026, 1, 2026, 6) }],
    } as unknown as ProfileData;
    expect(preferencesFromProfile(profile, now)).toEqual({
      titles: ["Aspiring Data Analyst", "Data Intern"],
      skills: ["SQL", "Python"],
      countries: ["in"],
      cities: [],
      remoteOk: true,
      level: "entry",
      employmentTypes: [],
    });
  });

  it("looks in India when the profile doesn't say where", () => {
    const profile = { basics: { headline: "", country: "" }, skills: [], experience: [] } as unknown as ProfileData;
    expect(preferencesFromProfile(profile, now).countries).toEqual(["in"]);
  });
});

describe("tiers (auto-apply step 3)", () => {
  it("puts a 0–100 score in one of four groups", () => {
    expect([100, 80, 79, 65, 64, 50, 49, 0].map(tierFor)).toEqual(["STRONG", "STRONG", "GOOD", "GOOD", "PARTIAL", "PARTIAL", "NOT_RECOMMENDED", "NOT_RECOMMENDED"]);
  });
});
