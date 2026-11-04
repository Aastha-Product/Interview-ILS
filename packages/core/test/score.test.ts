import type { JobRequirements } from "@pathfinder/ai";
import { describe, expect, it } from "vitest";
import { scoreMatch, WEIGHTS, type MatchInput } from "../src/matching/score";
import { profileInputSchema, type PreferencesInput, type ProfileInput } from "../src/profile/schema";

const profile: ProfileInput = profileInputSchema.parse({
  headline: "Final-year B.Tech CSE student aiming for QA roles",
  location: "Indore, Madhya Pradesh",
  skills: [{ name: "Python" }, { name: "SQL" }, { name: "Selenium WebDriver" }, { name: "Git" }],
  projects: [
    {
      name: "Library Management System",
      technologies: ["Java", "MySQL"],
      highlights: ["Wrote 40 JUnit test cases covering issue and return", "Built a desktop app for a college library"],
    },
  ],
  experiences: [{ title: "QA Intern", company: "Example Softech", highlights: ["Ran 120 manual test cases using JIRA"] }],
  education: [{ institution: "Example Institute", degree: "B.Tech", field: "Computer Science" }],
});

const preferences: PreferencesInput = {
  roles: ["QA Engineer"],
  locations: ["Pune", "Bangalore"],
  remoteOk: true,
  minSalary: null,
  experienceLevel: "FRESHER",
};

const requirements: JobRequirements = {
  title: "QA Engineer",
  company: "Acme",
  location: "Bengaluru, Karnataka",
  workMode: "onsite",
  seniority: "fresher",
  minYearsExperience: 0,
  requiredSkills: ["Selenium", "SQL", "Java", "Postman"],
  niceToHaveSkills: ["JIRA", "Docker"],
  education: "B.Tech",
  responsibilities: [],
  otherRequirements: [],
  employmentType: "Full-time",
  salaryText: "",
};

const job = {
  title: "QA Engineer",
  location: "Bengaluru, Karnataka",
  remote: false,
  description: "Test web applications with Selenium and Java. Write SQL queries. Use Postman for API checks. Write test cases.",
};

const base: MatchInput = { profile, preferences, requirements, job };

describe("scoreMatch", () => {
  it("weights add up to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("scores skills, seniority and location and explains them", () => {
    const r = scoreMatch(base);
    expect(r.matchedSkills).toEqual(["Java", "Selenium", "SQL"]);
    expect(r.missingSkills).toEqual(["Postman"]);
    expect(r.breakdown.skills).toEqual({ points: 36.3, max: 50 }); // 3/4 × 45 + 1/2 × 5
    expect(r.breakdown.seniority).toEqual({ points: 20, max: 20 });
    expect(r.breakdown.location).toEqual({ points: 15, max: 15 }); // Bangalore = Bengaluru
    expect(r.reasons[0]).toBe("You have 3 of the 4 required skills: Java, Selenium and SQL.");
    expect(r.reasons[1]).toBe("You also have 1 of the 2 preferred skills: JIRA.");
    expect(r.gaps).toEqual([{ kind: "skill", text: "Postman" }]);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic and ignores the order of the profile's lists", () => {
    const first = scoreMatch(base);
    expect(scoreMatch(base)).toEqual(first);
    const shuffled: MatchInput = {
      ...base,
      profile: { ...profile, skills: [...profile.skills].reverse(), projects: [...profile.projects].reverse() },
      preferences: { ...preferences, locations: [...preferences.locations].reverse() },
      requirements: { ...requirements, requiredSkills: [...requirements.requiredSkills].reverse(), niceToHaveSkills: ["Docker", "JIRA"] },
    };
    expect(scoreMatch(shuffled)).toEqual(first);
  });

  it("scores a fresher lower for a 3+ year role and lists it as a gap", () => {
    const fresherJob = scoreMatch(base);
    const midJob = scoreMatch({ ...base, requirements: { ...requirements, seniority: "mid", minYearsExperience: 3 } });
    expect(midJob.breakdown.seniority.points).toBe(3);
    expect(midJob.score).toBeLessThan(fresherJob.score);
    expect(midJob.gaps).toContainEqual({ kind: "experience", text: "Asks for at least 3 years of experience." });
    const twoYears = scoreMatch({ ...base, requirements: { ...requirements, seniority: "junior", minYearsExperience: 2 } });
    expect(twoYears.breakdown.seniority.points).toBe(12);
    const senior = scoreMatch({ ...base, requirements: { ...requirements, seniority: "senior", minYearsExperience: null } });
    expect(senior.breakdown.seniority.points).toBe(2);
  });

  it("handles remote jobs and cities outside the student's preferences", () => {
    const remote = scoreMatch({ ...base, job: { ...job, location: "", remote: true } });
    expect(remote.breakdown.location.points).toBe(15);
    const remoteNotWanted = scoreMatch({
      ...base,
      preferences: { ...preferences, remoteOk: false },
      requirements: { ...requirements, location: "", workMode: "remote" },
      job: { ...job, remote: true, location: "" },
    });
    expect(remoteNotWanted.breakdown.location.points).toBe(5);
    const elsewhere = scoreMatch({ ...base, job: { ...job, location: "Chennai, Tamil Nadu" }, requirements: { ...requirements, location: "Chennai" } });
    expect(elsewhere.breakdown.location.points).toBe(3);
    expect(elsewhere.gaps).toContainEqual({ kind: "location", text: "This job is in Chennai, which isn't one of your preferred cities." });
    const unknown = scoreMatch({ ...base, job: { ...job, location: "" }, requirements: { ...requirements, location: "" } });
    expect(unknown.breakdown.location.points).toBe(7.5);
    const home = scoreMatch({ ...base, job: { ...job, location: "Indore" } });
    expect(home.breakdown.location.points).toBe(15); // profile city counts
  });

  it("falls back to skills found in the description when none are listed", () => {
    const r = scoreMatch({ ...base, requirements: { ...requirements, requiredSkills: [], niceToHaveSkills: [] } });
    // "test cases" appears in the profile's highlights, so it counts.
    expect(r.matchedSkills).toEqual(["Java", "Selenium", "SQL", "Test Cases"]);
    expect(r.missingSkills).toEqual(["Postman"]);
    expect(r.reasons[0]).toMatch(/skills the posting mentions/);
  });

  it("gives half marks for skills when the posting names none at all", () => {
    const r = scoreMatch({
      ...base,
      requirements: { ...requirements, requiredSkills: [], niceToHaveSkills: [] },
      job: { ...job, title: "Trainee", description: "Join our friendly team." },
    });
    expect(r.breakdown.skills.points).toBe(25);
    expect(r.missingSkills).toEqual([]);
  });

  it("stays within 0 to 100", () => {
    const empty = profileInputSchema.parse({});
    const worst = scoreMatch({
      profile: empty,
      preferences: { ...preferences, remoteOk: false, locations: ["Delhi"] },
      requirements: { ...requirements, seniority: "senior", minYearsExperience: 10 },
      job: { ...job, location: "Chennai" },
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(20);
    const best = scoreMatch({
      ...base,
      profile: { ...profile, skills: [...profile.skills, { name: "Postman", category: "" }, { name: "Docker", category: "" }] },
    });
    expect(best.score).toBeLessThanOrEqual(100);
    expect(best.breakdown.skills.points).toBe(50);
  });
});
