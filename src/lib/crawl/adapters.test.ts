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
  // Workday's job list is a POSTed search: answered by its offset and filter.
  postJson: vi.fn(async (_system: string, url: URL, body: { offset: number; appliedFacets: Record<string, string[]> }) => {
    asked.push(`${url.toString()} offset=${body.offset} facets=${JSON.stringify(body.appliedFacets)}`);
    const pages = answers.get(`POST ${url.toString()}`) as ((body: { offset: number; appliedFacets: Record<string, string[]> }) => unknown) | undefined;
    if (!pages) throw new Error(`No answer for POST ${url}`);
    return pages(body);
  }),
}));
vi.mock("@/lib/jobs/rate-limit", () => ({ withRateLimit: (_p: string, _l: unknown, work: () => unknown) => work() }));

const { ashby } = await import("./ashby");
const { greenhouse } = await import("./greenhouse");
const { lever } = await import("./lever");
const { smartrecruiters } = await import("./smartrecruiters");
const { bamboohr } = await import("./bamboohr");
const { MAX_JOBS, workday, workdaySite } = await import("./workday");

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

describe("BambooHR (Phase 2)", () => {
  it("lists from the careers list, places each job, and loads its description from its own page", async () => {
    // Read from live boards on 21 November 2026: the list, then /careers/<id>/detail.
    answers.set("https://acme.bamboohr.com/careers/list", {
      meta: { totalCount: 2 },
      result: [
        { id: "12", jobOpeningName: "Data Analyst", departmentLabel: "Analytics", employmentStatusLabel: "Full-Time", location: { city: "Pune", state: "Maharashtra" }, atsLocation: { country: "India", state: null, province: null, city: null }, isRemote: false },
        { id: 13, jobOpeningName: "Support", location: { city: "Tampa", state: "Florida" }, atsLocation: { country: null }, isRemote: null },
        { notAJob: true },
      ],
    });
    answers.set("https://acme.bamboohr.com/careers/12/detail", {
      result: {
        jobOpening: {
          jobOpeningShareUrl: "https://acme.bamboohr.com/careers/12",
          jobOpeningName: "Data Analyst",
          description: "<p>Turn data into <b>decisions</b>.</p><ul><li>SQL</li></ul>",
          datePosted: "2026-11-18",
          location: { city: "Pune", state: "Maharashtra", addressCountry: "India" },
          compensation: "INR 8–12 LPA",
        },
      },
    });
    const jobs = await bamboohr.list(company, signal);
    expect(jobs.map((job) => [job.externalId, job.countries, job.remote, job.location])).toEqual([
      ["12", ["in"], false, "Pune, Maharashtra, India"],
      // A US city alone names no country here: kept only if it were remote and open to anywhere.
      ["13", [], null, "Tampa, Florida"],
    ]);
    expect(await jobs[0].load()).toMatchObject({
      title: "Data Analyst",
      companyName: "Acme",
      country: "in",
      employmentType: "Full-Time",
      department: "Analytics",
      salary: "INR 8–12 LPA",
      description: expect.stringContaining("Turn data into decisions."),
      url: "https://acme.bamboohr.com/careers/12",
      applyUrl: "https://acme.bamboohr.com/careers/12",
      postedAt: new Date("2026-11-18"),
    });
    expect(asked).toContain("https://acme.bamboohr.com/careers/12/detail");
  });

  it("says so when the board answers in another shape", async () => {
    answers.set("https://acme.bamboohr.com/careers/list", { result: [{ id: "1" }] });
    answers.set("https://acme.bamboohr.com/careers/1/detail", { unexpected: true });
    const [job] = await bamboohr.list(company, signal);
    await expect(job.load()).rejects.toBeInstanceOf(CrawlError);
    answers.set("https://acme.bamboohr.com/careers/list", "not json");
    await expect(bamboohr.list(company, signal)).rejects.toBeInstanceOf(CrawlError);
  });
});

describe("Workday (Phase 2)", () => {
  const site: BoardCompany = { name: "NVIDIA", boardToken: "nvidia.wd5/NVIDIAExternalCareerSite", countries: ["in"] };
  const jobsUrl = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";
  const posting = (n: number, locationsText = "India, Bengaluru") => ({ title: `Engineer ${n}`, externalPath: `/job/India-Bengaluru/Engineer_JR${n}`, locationsText, postedOn: "Posted Today", bulletFields: [`JR${n}`] });
  const facets = [{ facetParameter: "locationCountry", values: [{ descriptor: "India", id: "c4f7" }, { descriptor: "Taiwan", id: "aa11" }] }];

  it("reads a tenant's site from its board, and refuses anything else", () => {
    expect(workdaySite("nvidia.wd5/NVIDIAExternalCareerSite")).toEqual({ host: "nvidia.wd5.myworkdayjobs.com", base: "/wday/cxs/nvidia/NVIDIAExternalCareerSite", site: "NVIDIAExternalCareerSite" });
    expect(workdaySite("nvidia")).toBeNull();
    expect(workdaySite("evil.example/x")).toBeNull();
  });

  it("filters by the company's country where the site can, pages through, and loads each job", async () => {
    // As read from NVIDIA's site on 22 November 2026: 22 jobs in India over two pages.
    answers.set(`POST ${jobsUrl}`, ({ offset, appliedFacets }: { offset: number; appliedFacets: Record<string, string[]> }) =>
      Object.keys(appliedFacets).length === 0
        ? { total: 500, jobPostings: [posting(0, "Taiwan, Taipei")], facets }
        : { total: 22, jobPostings: offset === 0 ? Array.from({ length: 20 }, (_, n) => posting(n + 1, n === 0 ? "3 Locations" : "India, Bengaluru")) : [posting(21), posting(22)], facets },
    );
    answers.set("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/India-Bengaluru/Engineer_JR1", {
      jobPostingInfo: {
        title: "Engineer 1",
        jobDescription: "<p>Build <b>GPUs</b>.</p>",
        location: "India, Bengaluru",
        additionalLocations: ["India, Pune"],
        startDate: "2026-11-19",
        timeType: "Full time",
        jobReqId: "JR1",
        externalUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/India-Bengaluru/Engineer_JR1",
        country: { descriptor: "India" },
      },
    });
    const jobs = await workday.list(site, signal);
    expect(jobs).toHaveLength(22);
    expect(asked.filter((url) => url.startsWith(jobsUrl)).map((url) => url.replace(jobsUrl, ""))).toEqual([' offset=0 facets={}', ' offset=0 facets={"locationCountry":["c4f7"]}', ' offset=20 facets={"locationCountry":["c4f7"]}']);
    // "3 Locations" names no country, but the filter says it's in India.
    expect(jobs[0]).toMatchObject({ externalId: "/job/India-Bengaluru/Engineer_JR1", countries: ["in"], location: "3 Locations" });
    expect(await jobs[0].load()).toMatchObject({
      title: "Engineer 1",
      companyName: "NVIDIA",
      location: "India, Bengaluru · India, Pune",
      country: "in",
      employmentType: "Full time",
      description: expect.stringContaining("Build GPUs."),
      applyUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/India-Bengaluru/Engineer_JR1",
      postedAt: new Date("2026-11-19"),
    });
  });

  it("keeps the version when only 'Posted N days ago' changes, and reads at most MAX_JOBS", async () => {
    answers.set(`POST ${jobsUrl}`, ({ offset }: { offset: number }) => ({ total: 10_000, jobPostings: Array.from({ length: 20 }, (_, n) => ({ ...posting(offset + n), postedOn: `Posted ${offset} Days Ago` })) }));
    const jobs = await workday.list(site, signal);
    expect(jobs).toHaveLength(MAX_JOBS);
    // Without a country filter, only what the place names.
    expect(jobs[0].countries).toEqual(["in"]);
    answers.set(`POST ${jobsUrl}`, ({ offset }: { offset: number }) => ({ total: 20, jobPostings: Array.from({ length: 20 }, (_, n) => ({ ...posting(offset + n), postedOn: "Posted 30+ Days Ago" })) }));
    expect((await workday.list(site, signal))[0].version).toBe(jobs[0].version);
  });

  it("says so for a board that isn't a Workday site, or an answer in another shape", async () => {
    await expect(workday.list({ ...site, boardToken: "nvidia" }, signal)).rejects.toBeInstanceOf(CrawlError);
    answers.set(`POST ${jobsUrl}`, () => "not json");
    await expect(workday.list(site, signal)).rejects.toBeInstanceOf(CrawlError);
  });
});
