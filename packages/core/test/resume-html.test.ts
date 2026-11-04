import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../src/applications/types";
import { escapeHtml, resumeToHtml, safeHref } from "../src/pdf/resume-html";

export function sampleResume(overrides: Partial<ResumeContent> = {}): ResumeContent {
  return {
    header: {
      name: "Asha Verma",
      email: "asha@example.test",
      phone: "+91 98765 43210",
      location: "Indore, Madhya Pradesh",
      links: [{ label: "GitHub", url: "https://github.com/asha-example" }],
    },
    headline: "Final-year B.Tech CSE student aiming for QA roles",
    summary: { text: "Looking for an entry-level software testing role.", factIds: ["summary"] },
    skills: ["Selenium", "SQL", "Python"],
    experiences: [
      {
        sourceId: "exp:0",
        title: "QA Intern",
        company: "Example Softech Pvt Ltd",
        location: "Indore",
        dates: "Jun 2025 – Aug 2025",
        bullets: [{ id: "b1", text: "Wrote and ran 120 manual test cases for a web billing module", factIds: ["exp:0:h0"] }],
      },
    ],
    projects: [
      {
        sourceId: "proj:0",
        name: "Library Management System",
        role: "",
        technologies: ["Java", "MySQL"],
        url: "",
        dates: "",
        bullets: [{ id: "b2", text: "Wrote 40 JUnit test cases", factIds: ["proj:0:h1"] }],
      },
    ],
    education: [
      {
        sourceId: "edu:0",
        institution: "Shri Example Institute of Technology",
        degree: "B.Tech",
        field: "Computer Science and Engineering",
        dates: "2022 – 2026",
        grade: "CGPA 7.8/10",
      },
    ],
    ...overrides,
  };
}

describe("resumeToHtml", () => {
  it("renders every section as real text with headings", () => {
    const html = resumeToHtml(sampleResume());
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<h1>Asha Verma</h1>");
    for (const heading of ["Summary", "Skills", "Experience", "Projects", "Education"]) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    expect(html).toContain("<li>Wrote and ran 120 manual test cases for a web billing module</li>");
    expect(html).not.toMatch(/<table|<img|<script/i);
  });

  it("has a strict content security policy and no external resources", () => {
    const html = resumeToHtml(sampleResume());
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
    expect(html).not.toMatch(/<link\b|@import|src=|url\(/i);
  });

  it("escapes script and markup in any field", () => {
    const html = resumeToHtml(
      sampleResume({
        headline: `"><script>alert(1)</script>`,
        experiences: [
          {
            sourceId: "exp:0",
            title: "<b>QA</b>",
            company: "A & B",
            location: "",
            dates: "",
            bullets: [{ id: "x", text: `<img src="https://example.com/x.png" onerror="alert(1)">`, factIds: [] }],
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;QA&lt;/b&gt; — A &amp; B");
  });

  it("drops links that aren't http(s)", () => {
    const html = resumeToHtml(
      sampleResume({
        header: {
          ...sampleResume().header,
          links: [
            { label: "Evil", url: "javascript:alert(1)" },
            { label: "Data", url: "data:text/html,hi" },
            { label: "Site", url: "https://asha.example.test" },
          ],
        },
      }),
    );
    expect(html).not.toMatch(/javascript:|data:text/);
    expect(html).toContain(`<a href="https://asha.example.test/">Site</a>`);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });

  it("omits empty sections", () => {
    const html = resumeToHtml(
      sampleResume({ summary: { text: "  ", factIds: [] }, experiences: [], projects: [], skills: [] }),
    );
    expect(html).not.toContain("<h2>Summary</h2>");
    expect(html).not.toContain("<h2>Experience</h2>");
    expect(html).not.toContain("<h2>Projects</h2>");
    expect(html).not.toContain("<h2>Skills</h2>");
    expect(html).toContain("<h2>Education</h2>");
  });

  it("escapeHtml covers quotes and backticks", () => {
    expect(escapeHtml(`<a href='x' title="y">\`</a>`)).toBe("&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;&#96;&lt;/a&gt;");
  });
});
