import type { AiClient } from "@pathfinder/ai";
import type { ScopedDb } from "@pathfinder/db";
import { enqueuePdf } from "../applications/tasks";
import { createApplication, updateApplication } from "../applications/service";
import { generateDrafts } from "../applications/tailor";
import { UserFacingError } from "../errors";
import { importJob } from "../jobs/import";
import { getProfile, savePreferences, saveProfile } from "../profile/service";
import type { ProfileInput } from "../profile/schema";

/**
 * Demo data for local development, demos and staging: one student's profile, preferences, eight
 * scored jobs and seven applications spread over five weeks, so every screen has something to show.
 * Everything is fictional. All of it goes through the same domain functions (and the same
 * user-scoped database client) as the app itself, with the mock AI.
 */

export const DEMO_PROFILE: ProfileInput = {
  headline: "Final-year B.Tech Computer Science student looking for QA and data roles",
  summary:
    "Final-year computer science student with an internship in software testing and projects in Java and Python. Looking for an entry-level QA or data analyst role.",
  location: "Indore, Madhya Pradesh",
  phone: "",
  links: [{ label: "GitHub", url: "https://github.com/example-student" }],
  experiences: [
    {
      title: "QA Intern",
      company: "Example Softech Pvt Ltd",
      location: "Indore",
      startDate: "Jun 2025",
      endDate: "Aug 2025",
      current: false,
      highlights: [
        "Wrote and ran 120 manual test cases for a web billing module",
        "Automated 15 regression tests with Selenium and Python",
        "Logged and tracked 40 defects in JIRA",
      ],
    },
  ],
  projects: [
    {
      name: "Library Management System",
      role: "Developer",
      url: "",
      startDate: "Jan 2025",
      endDate: "Apr 2025",
      technologies: ["Java", "MySQL", "JUnit"],
      highlights: ["Built a desktop app for issuing and returning books", "Wrote 40 JUnit tests"],
    },
    {
      name: "Sales Dashboard",
      role: "Developer",
      url: "",
      startDate: "Aug 2024",
      endDate: "Oct 2024",
      technologies: ["Python", "Pandas", "Power BI"],
      highlights: ["Cleaned two years of sales data with Pandas", "Built a Power BI dashboard of monthly trends"],
    },
  ],
  education: [
    { institution: "Example Institute of Technology, Indore", degree: "B.Tech", field: "Computer Science", startDate: "2022", endDate: "2026", grade: "7.8 CGPA" },
  ],
  skills: ["Manual testing", "Selenium", "Python", "Java", "SQL", "JIRA", "Postman", "Git", "Excel", "Power BI"].map((name) => ({
    name,
    category: "",
  })),
};

interface DemoJob {
  title: string;
  company: string;
  location: string;
  text: string;
  /** Days ago the student applied, and days ago the employer replied (and how), if they did. */
  applied?: number;
  reply?: { daysAgo: number; status: "RESPONSE" | "INTERVIEW" | "REJECTED" };
  /** Draft a tailored resume and answers for this one. */
  draft?: boolean;
  /**
   * Only scored, not started: a job the student is still considering. (In the app every started
   * application gets a draft, so an application without one would show "Drafting…" forever.)
   */
  considering?: boolean;
}

const posting = (role: string, about: string, needs: string[], extra: string) =>
  [
    `About the role`,
    `${about}`,
    ``,
    `What we're looking for`,
    ...needs.map((n) => `- ${n}`),
    ``,
    extra,
    `This is a fictional posting created for Pathfinder's demo data.`,
  ].join("\n");

export const DEMO_JOBS: DemoJob[] = [
  {
    title: "QA Engineer - Fresher",
    company: "Northwind Softech (demo)",
    location: "Pune",
    text: posting("QA", "Join our quality team to test our web billing product, write test cases and help automate regression testing.", ["0-1 years of experience (2025/2026 batch)", "Manual testing and test case design", "Selenium with Java or Python", "SQL basics", "Bug tracking in JIRA"], "Immediate joiners preferred."),
    applied: 34,
    reply: { daysAgo: 30, status: "RESPONSE" },
  },
  {
    title: "Software Tester",
    company: "Nimbus Labs (demo)",
    location: "Indore",
    text: posting("Tester", "Test our mobile and web apps before every release and report defects clearly.", ["Manual testing of web and mobile apps", "Writing clear bug reports", "Postman for API testing", "Good communication"], "Freshers welcome."),
    applied: 33,
    reply: { daysAgo: 25, status: "REJECTED" },
  },
  {
    title: "Data Analyst Trainee",
    company: "Bluepeak Analytics (demo)",
    location: "Bengaluru",
    text: posting("Data", "Help our clients understand their sales data through reports and dashboards.", ["SQL for querying data", "Excel and pivot tables", "Python with Pandas", "Power BI or Tableau", "Statistics basics"], "Six-month training period, then a full-time role."),
    applied: 27,
  },
  {
    title: "Junior QA Automation Engineer",
    company: "Carrot Systems (demo)",
    location: "Pune",
    text: posting("QA", "Grow our automated regression suite and keep releases stable.", ["Selenium WebDriver", "Python or Java", "Git", "CI basics (Jenkins)", "REST API testing with Postman"], "Hybrid, three days a week in the office."),
    applied: 20,
    reply: { daysAgo: 14, status: "INTERVIEW" },
    draft: true,
  },
  {
    title: "Associate Software Engineer",
    company: "Vertex Infotech (demo)",
    location: "Hyderabad",
    text: posting("Dev", "Work on internal tools with a small team, writing and testing Java services.", ["Java and OOP", "SQL and MySQL", "Unit testing with JUnit", "Git", "Problem solving"], "2026 batch graduates can apply."),
    applied: 13,
  },
  {
    title: "Manual Test Engineer",
    company: "Lotus Retail Tech (demo)",
    location: "Indore",
    text: posting("QA", "Test our point-of-sale software in-store and in the office.", ["Manual testing", "Test case writing", "JIRA", "Excel", "Attention to detail"], "Local candidates preferred."),
    applied: 8,
    reply: { daysAgo: 5, status: "RESPONSE" },
    draft: true,
  },
  {
    title: "QA Intern",
    company: "Example Fintech (demo)",
    location: "Remote",
    text: posting("QA", "A six-month paid internship testing our payments dashboard.", ["Manual testing", "SQL", "Postman", "Willingness to learn automation"], "Remote within India."),
    draft: true,
  },
  {
    title: "Junior Data Analyst",
    company: "Greenleaf Foods (demo)",
    location: "Pune",
    text: posting("Data", "Track inventory and sales across our stores and report weekly.", ["Excel", "SQL", "Power BI", "Python is a plus"], "Full-time, office-based."),
    considering: true,
  },
];

export interface SeedDemoResult {
  jobs: number;
  applications: number;
  drafted: number;
  pdfsQueued: number;
}

/**
 * Fills one (empty) account with the demo data. Refuses an account that already has a profile or
 * applications, so it can't overwrite real work. `queuePdfs` needs the queue (a running Postgres;
 * the worker renders them whenever it runs).
 */
export async function seedDemoData(
  deps: { db: ScopedDb; ai: AiClient },
  options: { now?: Date; queuePdfs?: boolean } = {},
): Promise<SeedDemoResult> {
  const { db, ai } = deps;
  const now = options.now ?? new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  if ((await getProfile(db)).version !== 0 || (await db.application.count()) > 0) {
    throw new UserFacingError("NOT_EMPTY", "This account already has a profile or applications, so demo data wasn't added.", 409);
  }

  await saveProfile(db, DEMO_PROFILE, 0);
  await savePreferences(db, {
    roles: ["QA Engineer", "Software Tester", "Data Analyst"],
    locations: ["Indore", "Pune"],
    remoteOk: true,
    experienceLevel: "FRESHER",
    minSalary: null,
  });

  const result: SeedDemoResult = { jobs: 0, applications: 0, drafted: 0, pdfsQueued: 0 };
  for (const job of DEMO_JOBS) {
    const { jobListingId } = await importJob({ db, ai }, { text: job.text, title: job.title, company: job.company, location: job.location });
    result.jobs++;
    if (job.considering) continue;
    const { applicationId } = await createApplication(db, jobListingId, { confirmSimilar: true, now });
    result.applications++;

    if (job.draft) {
      const drafts = await generateDrafts({ db, ai }, applicationId);
      result.drafted++;
      if (options.queuePdfs) {
        await enqueuePdf(db, drafts.resumeDocumentId, { fromWorker: true });
        result.pdfsQueued++;
      }
    }
    if (job.applied !== undefined) await updateApplication(db, applicationId, { status: "APPLIED" }, daysAgo(job.applied));
    if (job.reply) await updateApplication(db, applicationId, { status: job.reply.status }, daysAgo(job.reply.daysAgo));
  }
  return result;
}
