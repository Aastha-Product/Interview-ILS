import { beforeEach, describe, expect, it } from "vitest";

import { pageSnapshot, withSnapshot } from "./snapshot";

const href = "https://job-boards.greenhouse.io/acme/jobs/1";

beforeEach(() => {
  document.title = "Job Application for Data Analyst at Acme";
  document.body.innerHTML = `
    <h1 hidden>Hidden heading</h1>
    <h1>Data Analyst</h1>
    <div role="alert">  Please complete the required   fields. </div>
    <div class="error">Resume must be a PDF.</div>
    <div class="error" style="display:none">An error nobody can see</div>
    <div class="error">Resume must be a PDF.</div>
    <form>
      <label for="first">First name *</label><input id="first" required value="Asha" />
      <label for="notice">Notice period *</label><input id="notice" required />
      <span id="why-label">Why Acme?</span><textarea aria-labelledby="why-label" aria-required="true"></textarea>
      <select aria-label="Country" required><option value="">Choose</option><option value="in">India</option></select>
      <input type="radio" name="relocate" value="yes" required aria-label="Relocate" />
      <input type="radio" name="relocate" value="no" aria-label="Relocate no" />
      <input type="hidden" name="token" required />
      <input type="password" required aria-label="Password" />
      <input id="email" type="email" required aria-invalid="true" placeholder="Email address" />
    </form>`;
});

describe("what the page said (Phase 3)", () => {
  it("reads the heading, the site's own messages and the required questions left empty", () => {
    expect(pageSnapshot(document, href)).toEqual({
      url: href,
      title: "Data Analyst",
      messages: ["Please complete the required fields.", "Resume must be a PDF."],
      unfilled: ["Notice period", "Why Acme?", "Country", "Relocate", "Email address"],
    });
  });

  it("never reads what was typed: a filled question isn't listed and no value is kept", () => {
    (document.getElementById("notice") as HTMLInputElement).value = "30 days";
    const snapshot = pageSnapshot(document, href);
    expect(snapshot.unfilled).not.toContain("Notice period");
    expect(JSON.stringify(snapshot)).not.toContain("Asha");
    expect(JSON.stringify(snapshot)).not.toContain("30 days");
  });

  it("falls back to the page's title, and keeps within its limits", () => {
    document.body.innerHTML = `${'<div class="error">x'.repeat(1)}${"y".repeat(400)}</div>${Array.from({ length: 12 }, (_, i) => `<div role="alert">Problem ${i}</div>`).join("")}`;
    const snapshot = pageSnapshot(document, `${href}?${"q".repeat(3000)}`);
    expect(snapshot.title).toBe("Job Application for Data Analyst at Acme");
    expect(snapshot.messages).toHaveLength(8);
    expect(snapshot.messages.every((message) => message.length <= 300)).toBe(true);
    expect(snapshot.url).toHaveLength(2000);
  });

  it("goes only with reports that stopped short of applied", () => {
    expect(withSnapshot({ outcome: "needs-student", reason: "Answer it." }, document, href)).toMatchObject({ snapshot: { title: "Data Analyst" } });
    expect(withSnapshot({ outcome: "failed", reason: "No form." }, document, href)).toHaveProperty("snapshot");
    expect(withSnapshot({ outcome: "uncertain" }, document, href)).toHaveProperty("snapshot");
    expect(withSnapshot({ outcome: "applied", evidence: { url: href, text: "Thanks" } }, document, href)).not.toHaveProperty("snapshot");
    expect(withSnapshot({ outcome: "dry-run" }, document, href)).not.toHaveProperty("snapshot");
  });
});
