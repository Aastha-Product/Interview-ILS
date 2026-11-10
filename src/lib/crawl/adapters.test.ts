import { beforeEach, describe, expect, it, vi } from "vitest";

import { CrawlError } from "./http";
import type { BoardCompany } from "./types";

// Answers shaped like the boards' live APIs (checked on 10 November 2026), with made-up jobs.
const answers = vi.hoisted(() => new Map<string, unknown>());
const asked = vi.hoisted(() => [] as string[]);
vi.mock("./http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./http")>()),
  getJson: vi.fn(async (_system: string, url: URL) => {
    asked.push(url.toString());
    const key = [...answers.keys()].find((prefix) => url.toString().startsWith(prefix));
    if (!key) throw new Error(`No answer for ${url}`);
    return answers.get(key);
  }),
}));
vi.mock("@/lib/jobs/rate-limit", () => ({ withRateLimit: (_p: string, _l: unknown, work: () => unknown) => work() }));

const { ashby } = await import("./ashby");
const { greenhouse } = await import("./greenhouse");
const { lever } = await import("./lever");
const { smartrecruiters } = await import("./smartrecruiters");

const company: BoardCompany = { name: "Acme", boardToken: "acme", countries: ["in"] };
const signal = new AbortController().signal;

beforeEach(() => {
  answers.clear();
  asked.length = 0;
});

describe("Greenhouse", () => {
  it("lists jobs with their countries, the board's own form and the description as text", async () => {
    answers.set("https://boards-api.greenhouse.io/v1/boards/acme/jobs", {
      jobs: [
        {
          id: 4012,
          title: " Software Engineer, Payments ",
          // Boards name themselves; the job keeps our name for the company.
          company_name: "Acme Careers",
          absolute_url: "https://acme.example/careers/4012",
          updated_at: "2026-11-02T22:52:56-05:00",
          first_published: "2026-11-01T03:52:24-05:00",
          content: "&lt;p&gt;Build things.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;TypeScript&lt;/li&gt;&lt;li&gt;Postgres&lt;/li&gt;&lt;/ul&gt;",
          location: { name: "Bengaluru" },
          departments: [{ name: "Engineering" }],
          offices: [{ name: "Bangalore", location: "Bengaluru, Karnataka, India" }],
        },
        { id: 4013, title: "Account Executive", location: { name: "Remote - US" }, updated_at: "2026-11-02T00:00:00Z" },
        { title: "No id, dropped" },
      ],
    });
    const listed = await greenhouse.list(company, signal);
    expect(asked[0]).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    expect(listed.map((job) => [job.externalId, job.countries, job.remote])).toEqual([
      ["4012", ["in"], null],
      ["4013", ["us"], true],
    ]);
    expect(await listed[0].load()).toEqual({
      externalId: "4012",
      title: "Software Engineer, Payments",
      companyName: "Acme",
      location: "Bengaluru",
      country: "in",
      remote: null,
      employmentType: "",
      department: "Engineering",
      salary: "",
      description: "Build things.\n\n- TypeScript\n- Postgres",
      url: "https://acme.example/careers/4012",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/4012",
      postedAt: new Date("2026-11-01T08:52:24.000Z"),
    });
    expect(listed[0].version).toBe("2026-11-02T22:52:56-05:00");
  });

  it("says when the board answers in a shape it doesn't know", async () => {
    answers.set("https://boards-api.greenhouse.io/", { postings: [] });
    await expect(greenhouse.list(company, signal)).rejects.toBeInstanceOf(CrawlError);
  });
});

describe("Lever", () => {
  it("reads the structured country, workplace and salary, and joins the description's parts", async () => {
    answers.set("https://api.lever.co/v0/postings/acme", [
      {
        id: "2a55d6c9-c564-443a-be3e-a3851db5a93b",
        text: "Backend Engineer",
        createdAt: 1762300000000,
        country: "IN",
        workplaceType: "hybrid",
        descriptionPlain: "About the role.",
        lists: [{ text: "What you'll do", content: "<li>Ship APIs</li><li>Review code</li>" }],
        additionalPlain: "Equal opportunity employer.",
        categories: { location: "Pune", commitment: "Full-time", department: "Engineering", team: "Core", allLocations: ["Pune"] },
        salaryRange: { min: 1800000, max: 2600000, currency: "INR", interval: "per-year-salary" },
        hostedUrl: "https://jobs.lever.co/acme/2a55d6c9",
        applyUrl: "https://jobs.lever.co/acme/2a55d6c9/apply",
      },
    ]);
    const [job] = await lever.list(company, signal);
    expect(job).toMatchObject({ countries: ["in"], remote: false });
    expect(await job.load()).toMatchObject({
      title: "Backend Engineer",
      country: "in",
      employmentType: "Full-time",
      department: "Engineering",
      salary: "INR 1,800,000–2,600,000 a year",
      description: "About the role.\n\nWhat you'll do\n- Ship APIs\n- Review code\n\nEqual opportunity employer.",
      applyUrl: "https://jobs.lever.co/acme/2a55d6c9/apply",
      postedAt: new Date(1762300000000),
    });
  });

  it("changes a job's version when the job changes", async () => {
    const job = { id: "x", text: "Analyst", categories: { location: "Mumbai" }, hostedUrl: "https://jobs.lever.co/acme/x" };
    answers.set("https://api.lever.co/", [job]);
    const before = (await lever.list(company, signal))[0].version;
    answers.set("https://api.lever.co/", [{ ...job, text: "Senior Analyst" }]);
    expect((await lever.list(company, signal))[0].version).not.toBe(before);
  });
});

describe("Ashby", () => {
  it("leaves unlisted jobs out and reads countries from every location", async () => {
    answers.set("https://api.ashbyhq.com/posting-api/job-board/acme", {
      jobs: [
        {
          id: "7458d4e9",
          title: "Data Analyst",
          department: "Analytics",
          employmentType: "Intern",
          location: "Remote - European Union",
          secondaryLocations: [{ location: "Hyderabad", address: { postalAddress: { addressCountry: "India" } } }],
          publishedAt: "2026-11-04T14:29:08.532+00:00",
          isListed: true,
          isRemote: true,
          address: { postalAddress: { addressCountry: "European Union" } },
          jobUrl: "https://jobs.ashbyhq.com/Acme/7458d4e9",
          applyUrl: "https://jobs.ashbyhq.com/Acme/7458d4e9/application",
          descriptionPlain: "Analyse   data.",
          compensation: { scrapeableCompensationSalarySummary: "₹8L – ₹12L" },
        },
        { id: "hidden", title: "Hidden", isListed: false },
      ],
    });
    const listed = await ashby.list(company, signal);
    expect(listed).toHaveLength(1);
    expect(listed[0].countries).toEqual(["in"]);
    expect(await listed[0].load()).toMatchObject({
      employmentType: "Internship",
      remote: true,
      salary: "₹8L – ₹12L",
      description: "Analyse data.",
      applyUrl: "https://jobs.ashbyhq.com/Acme/7458d4e9/application",
    });
  });
});

describe("SmartRecruiters", () => {
  it("asks per country, pages through, and loads a job's description only when asked", async () => {
    const item = (id: string) => ({
      id,
      name: `Engineer ${id}`,
      releasedDate: "2026-11-10T06:01:48.430Z",
      location: { city: "bengaluru", country: "in", remote: false, fullLocation: "bengaluru, , India" },
      typeOfEmployment: { label: "Full-time" },
      department: {},
      company: { name: "Acme Group" },
    });
    answers.set("https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0", {
      totalFound: 101,
      content: Array.from({ length: 100 }, (_, i) => item(String(i))),
    });
    answers.set("https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=100", { totalFound: 101, content: [item("100")] });
    answers.set("https://api.smartrecruiters.com/v1/companies/acme/postings/7", {
      postingUrl: "https://jobs.smartrecruiters.com/Acme/7-engineer",
      applyUrl: "https://jobs.smartrecruiters.com/Acme/7-engineer?oga=true",
      jobAd: { sections: { jobDescription: { title: "Job Description", text: "<p>Design boards.</p>" }, qualifications: { title: "Qualifications", text: "<ul><li>B.E.</li></ul>" } } },
    });
    const listed = await smartrecruiters.list(company, signal);
    expect(listed).toHaveLength(101);
    expect(asked.every((url) => url.includes("country=in"))).toBe(true);
    expect(asked).toHaveLength(2);
    const job = await listed[7].load();
    expect(asked).toHaveLength(3);
    expect(job).toMatchObject({
      title: "Engineer 7",
      companyName: "Acme Group",
      location: "bengaluru, India",
      country: "in",
      employmentType: "Full-time",
      description: "Job Description\nDesign boards.\n\nQualifications\n- B.E.",
      applyUrl: "https://jobs.smartrecruiters.com/Acme/7-engineer?oga=true",
    });
  });
});
