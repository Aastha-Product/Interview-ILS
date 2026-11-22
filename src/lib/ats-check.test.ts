import { describe, expect, it } from "vitest";

import { checkResume, jobKeywords } from "./ats-check";

const strong = `Asha Rao
asha.rao@example.com | +91 98765 43210 | linkedin.com/in/asharao

Experience
Data Analyst Intern, Groww · Jun 2025 – Dec 2025
• Built a Python pipeline that cut weekly reporting time by 40%
• Analysed 2 million transactions in SQL to find 3 drop-off points in onboarding
• Designed Tableau dashboards used by 25 people in the growth team
• Reduced query costs by 18% by rewriting slow joins

Projects
• Developed a churn model in Python with 82% accuracy on 10,000 users
• Led a team of 4 to ship a budgeting app with 1,200 downloads

Education
B.Tech, Computer Science, IIT Delhi · 2021 – 2025 · CGPA 8.4

Skills
Python, SQL, Tableau, Excel, pandas, statistics, A/B testing
${"Worked across product, engineering and marketing to turn data into decisions for the onboarding and payments teams. ".repeat(12)}`;

describe("the ATS checker (Phase 5)", () => {
  it("scores a well-made resume high, with nothing to fix", () => {
    const result = checkResume(strong);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.label).toBe("Strong");
    expect(result.checks.map((check) => check.id)).toEqual(["contact", "sections", "length", "impact", "verbs", "dates", "readability"]);
    expect(result.checks.find((check) => check.id === "contact")).toMatchObject({ status: "pass", points: 15, tip: null });
    expect(result.checks.find((check) => check.id === "sections")).toMatchObject({ status: "pass", detail: "Experience, Education and Skills each have their own heading." });
    expect(result.keywords).toBeNull();
  });

  it("says what's missing on a weak one, with a tip for each", () => {
    const weak = "Asha Rao\nMy journey\nResponsible for reports at a company. Worked on many things with the team and helped them. ".repeat(4);
    const result = checkResume(weak);
    expect(result.score).toBeLessThan(45);
    expect(result.label).toBe("Weak");
    const contact = result.checks.find((check) => check.id === "contact")!;
    expect(contact).toMatchObject({ status: "fix", detail: "Missing an email address, a phone number, a LinkedIn or portfolio link." });
    expect(contact.tip).toMatch(/at the top/);
    expect(result.checks.find((check) => check.id === "sections")!.detail).toBe("No Experience or Education or Skills heading found.");
    expect(result.checks.find((check) => check.id === "impact")!.detail).toBe("No bullet points found to check.");
    expect(result.checks.find((check) => check.id === "dates")!.status).toBe("fix");
  });

  it("checks the job's keywords when a description is given", () => {
    const job = "We need a Data Analyst with SQL, Python and Tableau. You will build dashboards, run A/B tests, and work with Snowflake and dbt. SQL and Python daily.";
    const result = checkResume(strong, job);
    expect(result.checks.at(-1)!.id).toBe("keywords");
    expect(result.keywords!.found).toEqual(expect.arrayContaining(["sql", "python", "tableau"]));
    expect(result.keywords!.missing).toEqual(expect.arrayContaining(["snowflake", "dbt"]));
    // Filler words aren't keywords.
    expect(jobKeywords(job)).not.toContain("with");
    expect(jobKeywords(job)[0]).toBe("python");
  });

  it("finds the bullets of a PDF that lost its bullet marks, and counts every date (testing, 22 November)", () => {
    const pdfText = [
      "Asha Verma",
      "Experience",
      "Data Analyst Intern, Groww, Jan 2025 - Jun 2025",
      "Built SQL dashboards in Tableau used by 3 teams",
      "Automated weekly reports with Python, saving 6 hours a week",
      "Skills",
      "SQL, Python",
    ].join("\n");
    const result = checkResume(pdfText);
    const detail = (id: string) => result.checks.find((check) => check.id === id)!.detail;
    expect(detail("impact")).toBe("2 of 2 bullet points have a number in them.");
    expect(detail("verbs")).toBe("2 of 2 bullet points start with an action verb.");
    expect(detail("dates")).toBe("2 dates found.");
    // A short line or one not led by a verb isn't taken for a bullet.
    expect(detail("readability")).toMatch(/^2 bullet points/);
  });

  it("keeps skills of more than one word together, and leaves out words every posting uses (testing, 22 November)", () => {
    const job = "Data Analyst, Pune. You will write SQL, build dashboards in Power BI or Tableau, use Python and Excel, and present insights to stakeholders. Nice to have: A/B testing, statistics, dbt.";
    const keywords = jobKeywords(job);
    expect(keywords).toEqual(expect.arrayContaining(["power bi", "a/b testing", "sql", "tableau", "python"]));
    for (const filler of ["nice", "write", "build", "present", "power", "testing"]) expect(keywords).not.toContain(filler);
    const result = checkResume("Skills\nSQL, Power  BI, Python, A/B testing", job);
    expect(result.keywords!.found).toEqual(expect.arrayContaining(["power bi", "a/b testing", "sql", "python"]));
    expect(result.keywords!.missing).toEqual(expect.arrayContaining(["tableau", "dbt"]));
  });

  it("reads the email apart from the phone, and caps how much it reads", () => {
    const result = checkResume(`a@b.co\n${"word ".repeat(40_000)}`);
    expect(result.checks.find((check) => check.id === "contact")!.detail).toBe("Missing a phone number, a LinkedIn or portfolio link.");
    expect(result.words).toBeLessThanOrEqual(6_100);
  });
});
