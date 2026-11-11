import { describe, expect, it } from "vitest";

import { EMPTY_QUERY, type SearchQuery } from "@/lib/job-search/search";
import type { ImportedProfile } from "@/lib/profile-import";

import { seedAgentQuery } from "./seed-query";

const emptyProfile: ImportedProfile = {
  basics: {},
  skills: [],
  languages: [],
  experience: [],
  projects: [],
  education: [],
  publications: [],
  references: [],
};

const role = (over: Partial<ImportedProfile["experience"][number]>): ImportedProfile["experience"][number] => ({
  role: "Data Scientist",
  company: "Acme",
  location: "",
  descriptor: "",
  bullets: "",
  skills: [],
  startYear: null,
  startMonth: null,
  endYear: null,
  endMonth: null,
  current: false,
  unverified: [],
  ...over,
});

const profile = (over: Partial<ImportedProfile>): ImportedProfile => ({ ...emptyProfile, ...over });

describe("seedAgentQuery (Pathfinder)", () => {
  it("fills keywords, place and country from the resume", () => {
    const patch = seedAgentQuery(EMPTY_QUERY, profile({ basics: { headline: "ML Engineer", city: "Berlin", country: "Germany" }, experience: [role({})] }));
    expect(patch).toEqual({ keywords: "Data Scientist", place: "Berlin", country: "de" });
  });

  it("uses the headline when there's no role to take a title from", () => {
    expect(seedAgentQuery(EMPTY_QUERY, profile({ basics: { headline: "Aspiring UX designer" } }))).toEqual({ keywords: "Aspiring UX designer" });
  });

  it("maps a country code as well as a name, and leaves an unknown country out", () => {
    expect(seedAgentQuery(EMPTY_QUERY, profile({ basics: { country: "NL" } }))).toEqual({ country: "nl" });
    expect(seedAgentQuery(EMPTY_QUERY, profile({ basics: { country: "Freedonia" } }))).toEqual({});
  });

  it("never overwrites a field the student already set", () => {
    const current: SearchQuery = { ...EMPTY_QUERY, keywords: "Product manager", country: "nl" };
    const patch = seedAgentQuery(current, profile({ basics: { city: "Utrecht", country: "Germany" }, experience: [role({})] }));
    expect(patch).toEqual({ place: "Utrecht" });
  });

  it("gives nothing when the resume has no title, city or country", () => {
    expect(seedAgentQuery(EMPTY_QUERY, profile({ basics: { name: "Asha Rao", email: "asha@example.com" } }))).toEqual({});
  });

  it("tidies whitespace and caps the length of what it takes", () => {
    const long = "A".repeat(250);
    const patch = seedAgentQuery(EMPTY_QUERY, profile({ experience: [role({ role: `  Senior   ${long}  ` })] }));
    expect(patch.keywords).toBe(`Senior ${long}`.slice(0, 200));
    expect(patch.keywords).toHaveLength(200);
  });
});
