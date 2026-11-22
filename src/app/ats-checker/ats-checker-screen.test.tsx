import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AtsCheckerScreen } from "./ats-checker-screen";

const reader = vi.hoisted(() => ({ result: { ok: true, text: "" } as { ok: true; text: string } | { ok: false; error: string } }));
vi.mock("@/lib/resume-text-browser", () => ({ readResumeFile: vi.fn(async () => reader.result) }));

const resume = `Asha Rao
asha.rao@example.com | +91 98765 43210 | linkedin.com/in/asharao
Experience
Data Analyst Intern, Groww · Jun 2025 – Dec 2025
• Built a Python pipeline that cut weekly reporting time by 40%
• Analysed 2 million transactions in SQL to find 3 drop-off points
• Designed Tableau dashboards used by 25 people
Education
B.Tech, IIT Delhi · 2021 – 2025
Skills
Python, SQL, Tableau, Excel`;

describe("the ATS checker page (Phase 5)", () => {
  it("checks pasted text and shows the score and each check, with a tip where there's one", async () => {
    const user = userEvent.setup();
    render(<AtsCheckerScreen signedIn={false} canSignUp />);
    expect(screen.getByText(/your resume\s+never leaves your device/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Or paste its text"));
    await user.paste(resume);
    await user.click(screen.getByLabelText(/Job description/));
    await user.paste("Data Analyst with SQL, Python, Snowflake and dbt.");
    await user.click(screen.getByRole("button", { name: "Check my resume" }));
    expect(screen.getByRole("heading", { level: 2, name: /^\d+\/100 · (Strong|Good|Needs work|Weak)$/ })).toBeInTheDocument();
    const checks = within(screen.getByRole("list", { name: "Checks" })).getAllByRole("listitem");
    expect(checks.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Contact details",
      "Standard sections",
      "Length",
      "Measurable results",
      "Action verbs",
      "Dates",
      "Easy to scan",
      "Job keywords",
    ]);
    // Short, so the length check has a tip.
    expect(checks[2]).toHaveTextContent("It's short");
    expect(screen.getByText(/Keywords from the job not in your resume:/).closest("p")).toHaveTextContent("snowflake");
    expect(screen.getByRole("link", { name: "Sign up free" })).toHaveAttribute("href", "/signup");
  });

  it("asks for a whole resume first", async () => {
    const user = userEvent.setup();
    render(<AtsCheckerScreen signedIn={false} canSignUp />);
    await user.click(screen.getByRole("button", { name: "Check my resume" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add your whole resume first");
    expect(screen.queryByRole("list", { name: "Checks" })).toBeNull();
  });

  it("reads a chosen file into the text box, or says why it can't", async () => {
    const user = userEvent.setup();
    render(<AtsCheckerScreen signedIn canSignUp />);
    reader.result = { ok: true, text: resume };
    await user.upload(screen.getByLabelText(/Your resume/), new File(["%PDF"], "asha.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Read from asha.pdf. Check the text below if anything looks off.")).toBeInTheDocument();
    expect(screen.getByLabelText("Or paste its text")).toHaveValue(resume);

    reader.result = { ok: false, error: "There's hardly any text in that file: it may be a scan. Paste your resume's text instead." };
    await user.upload(screen.getByLabelText(/Your resume/), new File(["%PDF"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("it may be a scan");
  });
});
