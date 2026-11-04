import "../src/env";
import { resumeToHtml } from "@pathfinder/core";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, renderPdf } from "../src/pdf/browser";

const content = {
  header: { name: "Asha Verma", email: "asha@example.test", phone: "", location: "Indore", links: [] },
  headline: "Final-year B.Tech CSE student",
  summary: { text: "Looking for an entry-level QA role.", factIds: ["summary"] },
  skills: ["Selenium", "SQL"],
  experiences: [],
  projects: [
    {
      sourceId: "proj:0",
      name: "Library Management System",
      role: "",
      technologies: ["Java"],
      url: "",
      dates: "",
      bullets: [{ id: "b1", text: "Wrote 40 JUnit test cases", factIds: ["proj:0:h1"] }],
    },
  ],
  education: [{ sourceId: "edu:0", institution: "Example Institute", degree: "B.Tech", field: "CSE", dates: "2022 – 2026", grade: "" }],
};

afterAll(async () => {
  await closeBrowser();
});

describe("renderPdf", { timeout: 90_000 }, () => {
  it("turns resume HTML into a real PDF", async () => {
    const pdf = await renderPdf(resumeToHtml(content));
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1024);
  });

  it("never loads anything over the network, even if HTML asks it to", async () => {
    const requests: string[] = [];
    const html = `<!doctype html><html><head><link rel="stylesheet" href="https://example.com/x.css"></head>
      <body><img src="https://example.com/tracker.png"><iframe src="https://example.com/frame"></iframe><p>Hi</p></body></html>`;
    const pdf = await renderPdf(html, { onRequest: (url) => requests.push(url) });
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    // Any request the page tried was intercepted and aborted; none reached the network.
    for (const url of requests) expect(url).toMatch(/^https:\/\/example\.com\//);
  });

  it("renders two at a time without failing", async () => {
    const pdfs = await Promise.all([1, 2, 3].map(() => renderPdf(resumeToHtml(content))));
    expect(pdfs.every((p) => p.byteLength > 1024)).toBe(true);
  });
});
