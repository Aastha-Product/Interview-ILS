import { beforeEach, describe, expect, it, vi } from "vitest";

import "./test/data-transfer";
import { boardFor, smartrecruiters } from "./boards";
import { emptyRequired, fill, outcome, readFields } from "./form";
import { REASONS, type FormAnswers, type FormField, type LeasedTask, type Reply, type TabRequest } from "./protocol";
import { apply, WAIT, type Port } from "./run";
import { footerNative, inShadow, screeningPage, smartRecruitersPage, smartRecruitersThanks } from "./test/smartrecruiters-page";

vi.setConfig({ testTimeout: 20_000 });
WAIT.form = 1000;
WAIT.confirmation = 1500;

const resume = new File(["%PDF-1.7"], "Asha Rao - Resume.pdf", { type: "application/pdf" });

describe("SmartRecruiters' form (Phase 2)", () => {
  beforeEach(() => smartRecruitersPage(document));

  it("is the board for jobs.smartrecruiters.com only", () => {
    expect(boardFor("jobs.smartrecruiters.com")).toBe(smartrecruiters);
    expect(boardFor("smartrecruiters.com.evil.example")).toBeNull();
  });

  it("reads the details page's questions inside shadow roots, by id, wording and whether they're required", async () => {
    const form = smartrecruiters.findForm(document)!;
    const fields = await readFields(smartrecruiters, form);
    expect(fields.map(({ key, label, required, type }) => [key, label, required, type])).toEqual([
      ["first-name-input", "First name", true, "text"],
      ["last-name-input", "Last name", true, "text"],
      ["email-input", "Email", true, "text"],
      ["confirm-email-input", "Confirm your email", true, "text"],
      ["spl-form-element_5", "Phone number", true, "text"],
      ["linkedin-input", "LinkedIn", false, "text"],
      // The drop zone says "Choose a file": its section makes it the resume.
      ["resume", "Resume", false, "file"],
      ["hiring-manager-message-input", "Let the company know about your interest working there", false, "textarea"],
    ]);
    // Not asked: the resume reader at the top (it would rewrite the form), the phone's country
    // search, and the optional city autocomplete.
    expect(fields.map((field) => field.key)).not.toContain("spl-dropzone-file-input-2");
  });

  it("fills fields inside shadow roots and attaches the resume to the resume section's drop zone", async () => {
    const form = smartrecruiters.findForm(document)!;
    const heard: string[] = [];
    // The component around a field hears its input (the events cross the shadow boundary).
    inShadow(document, "first-name-input").getRootNode().addEventListener("input", () => heard.push("input"));
    const unfilled = await fill(
      smartrecruiters,
      form,
      {
        "first-name-input": { kind: "text", value: "Asha" },
        "last-name-input": { kind: "text", value: "Rao" },
        "email-input": { kind: "text", value: "asha@example.test" },
        "confirm-email-input": { kind: "text", value: "asha@example.test" },
        "spl-form-element_5": { kind: "text", value: "+91 98765 43210" },
        resume: { kind: "file", file: "resume" },
      },
      { resume },
    );
    expect(unfilled).toEqual([]);
    expect(inShadow(document, "confirm-email-input").value).toBe("asha@example.test");
    expect(inShadow(document, "spl-dropzone-file-input-1").files?.[0]?.name).toBe("Asha Rao - Resume.pdf");
    expect(inShadow(document, "spl-dropzone-file-input-2").files?.length ?? 0).toBe(0);
    expect(heard).toContain("input");
    expect(await emptyRequired(smartrecruiters, form)).toEqual([]);
  });

  it("finds Next on the details page and Submit on the screening page, and reads the company's questions", async () => {
    const form = smartrecruiters.findForm(document)!;
    expect(smartrecruiters.nextButton!(form)).toBe(footerNative(document, "footer-next"));
    expect(smartrecruiters.submitButton(form)).toBeNull();

    screeningPage(document);
    const screening = smartrecruiters.findForm(document)!;
    expect(smartrecruiters.nextButton!(screening)).toBeNull();
    expect(smartrecruiters.submitButton(screening)).toBe(footerNative(document, "footer-submit"));
    const fields = await readFields(smartrecruiters, screening);
    expect(fields.map(({ label, required, type, options }) => [label, required, type, options.map((option) => option.label)])).toEqual([
      ["Are you willing to relocate to Bengaluru?", true, "single", ["Yes", "No"]],
      ["What is your expected salary?", true, "text", []],
    ]);
  });

  it("says what the page wants when it won't go on", () => {
    const form = smartrecruiters.findForm(document)!;
    footerNative(document, "footer-next").click();
    expect(smartrecruiters.preSubmitInvalid!(form)).toEqual(["Please fill in the required fields."]);
  });

  it("knows the page once sent, though its words are in a shadow root", () => {
    smartRecruitersThanks(document);
    const seen = outcome(smartrecruiters, document, { pathname: "/oneclick-ui/success", href: "https://jobs.smartrecruiters.com/oneclick-ui/success" });
    expect(seen).toMatchObject({ kind: "confirmed" });
    expect(seen?.kind === "confirmed" && seen.text).toContain("Your application has been submitted.");
  });
});

describe("applying on SmartRecruiters, page by page (Phase 2)", () => {
  const location = { hostname: "jobs.smartrecruiters.com", pathname: "/oneclick-ui/company/Acme/publication/1", href: "https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/1" };
  const task = (overrides: Partial<LeasedTask> = {}): LeasedTask => ({
    taskId: "t1",
    leaseId: "lease-1",
    leaseUntil: "2026-11-21T10:10:00Z",
    applyUrl: location.href,
    system: "SMARTRECRUITERS",
    title: "Data Analyst",
    company: "Acme",
    dryRun: false,
    documents: { resume: true, coverLetter: false },
    answers: null,
    ...overrides,
  });

  /** The server's answers, by each page's wording, as its rules would give them. */
  const BY_LABEL: Record<string, FormAnswers["answers"][string]> = {
    "First name": { kind: "text", value: "Asha" },
    "Last name": { kind: "text", value: "Rao" },
    Email: { kind: "text", value: "asha@example.test" },
    "Confirm your email": { kind: "text", value: "asha@example.test" },
    "Phone number": { kind: "text", value: "+91 98765 43210" },
    "Are you willing to relocate to Bengaluru?": { kind: "option", value: "yes", label: "Yes" },
    "What is your expected salary?": { kind: "text", value: "6 LPA" },
  };
  function fakePort() {
    const requests: TabRequest[] = [];
    const port: Port = async <T,>(request: TabRequest): Promise<Reply<T>> => {
      requests.push(request);
      const ok = (data: unknown) => ({ ok: true as const, data: data as T });
      if (request.type === "answers")
        return ok({ answers: Object.fromEntries(request.fields.flatMap((field: FormField) => (BY_LABEL[field.label] ? [[field.key, BY_LABEL[field.label]]] : []))), missing: [] });
      if (request.type === "document") return ok({ name: "Asha Rao - Resume.pdf", type: "application/pdf", base64: btoa("%PDF-1.7") });
      if (request.type === "report") return ok(null);
      return { ok: false, error: "unexpected" };
    };
    return { port, requests };
  }

  it("fills the details, presses Next, fills the company's questions, then submits once and reads the confirmation", async () => {
    const at = { ...location };
    let submits = 0;
    smartRecruitersPage(document, {
      onNext: () =>
        screeningPage(document, {
          onSubmit: () => {
            submits++;
            smartRecruitersThanks(document);
            at.pathname = "/oneclick-ui/success";
          },
        }),
    });
    const { port, requests } = fakePort();
    const finish = await apply(port, document, at, { task: task(), submitted: false });
    expect(finish.report).toMatchObject({ outcome: "applied", evidence: { text: expect.stringContaining("Your application has been submitted.") } });
    expect(submits).toBe(1);
    // Each page's questions were asked for, and Pathfinder agreed before Submit.
    const asked = requests.filter((request) => request.type === "answers").map((request) => (request.type === "answers" ? request.fields.map((field) => field.label) : []));
    expect(asked[0]).toContain("First name");
    expect(asked[1]).toEqual(["Are you willing to relocate to Bengaluru?", "What is your expected salary?"]);
    expect(requests.some((request) => request.type === "report" && request.report.outcome === "submitting")).toBe(true);
  });

  it("in a dry run goes through the pages but never presses Submit", async () => {
    let submits = 0;
    smartRecruitersPage(document, { onNext: () => screeningPage(document, { onSubmit: () => submits++ }) });
    const finish = await apply(fakePort().port, document, location, { task: task({ dryRun: true }), submitted: false });
    expect(finish).toEqual({ report: { outcome: "dry-run" }, keepTab: true });
    expect(submits).toBe(0);
    // It stopped on the company's questions, filled in.
    expect(inShadow(document, "question-salary").value).toBe("6 LPA");
  });

  it("hands the form to the student when a required question has no answer", async () => {
    smartRecruitersPage(document);
    BY_LABEL["Phone number"] = undefined as never;
    try {
      const finish = await apply(fakePort().port, document, location, { task: task(), submitted: false });
      expect(finish).toEqual({ report: { outcome: "needs-student", reason: REASONS.unanswered(["Phone number"]) }, keepTab: true });
    } finally {
      BY_LABEL["Phone number"] = { kind: "text", value: "+91 98765 43210" };
    }
  });
});
