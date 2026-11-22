import { beforeEach, describe, expect, it, vi } from "vitest";

import "./test/data-transfer";
import { bamboohr, boardFor } from "./boards";
import { fill, readFields } from "./form";
import { REASONS, type FormField, type LeasedTask, type Reply, type TabRequest } from "./protocol";
import { apply, WAIT, type Port } from "./run";
import { bambooJobPage, bambooThanks } from "./test/bamboohr-page";

vi.setConfig({ testTimeout: 20_000 });
WAIT.form = 1000;
WAIT.confirmation = 1500;

const resume = new File(["%PDF-1.7"], "Asha Rao - Resume.pdf", { type: "application/pdf" });

describe("BambooHR's form (Phase 2)", () => {
  beforeEach(() => bambooJobPage(document));

  it("is the board for a company's own bamboohr.com subdomain only", () => {
    expect(boardFor("knack.bamboohr.com")).toBe(bamboohr);
    expect(boardFor("bamboohr.com.evil.example")).toBeNull();
    expect(boardFor("bamboohr.com")).toBeNull();
  });

  it("finds Apply for This Job while the form is hidden, then reads the form's questions", async () => {
    expect(bamboohr.findForm(document)).toBeNull();
    bamboohr.openButton!(document)!.click();
    const form = bamboohr.findForm(document)!;
    expect(bamboohr.openButton!(document)).not.toBeNull();
    const fields = await readFields(bamboohr, form);
    expect(fields.map(({ key, label, required, type }) => [key, label, required, type])).toEqual([
      ["firstName", "First Name", true, "text"],
      ["lastName", "Last Name", true, "text"],
      ["email", "Email", true, "text"],
      ["phone", "Phone", true, "text"],
      ["streetAddress.value", "Address", true, "text"],
      ["city.value", "City", true, "text"],
      ["countryId.value", "Country", true, "single"],
      ["resume", "Resume", true, "file"],
      ["linkedinUrl", "LinkedIn URL", false, "text"],
      ["customQuestionAnswers.long_73", "Why do you want to work at Knack?", true, "textarea"],
    ]);
    // The bot trap and reCAPTCHA's box are never questions.
    expect(fields.map((field) => field.key)).not.toContain("nickname_hpcsaf");
    expect(fields.map((field) => field.key)).not.toContain("g-recaptcha-response");
    expect(fields.find((field) => field.key === "countryId.value")!.options.map((option) => option.label)).toEqual(["India", "United States"]);
  });

  it("fills the answers and the resume, and never touches the bot trap", async () => {
    bamboohr.openButton!(document)!.click();
    const form = bamboohr.findForm(document)!;
    const unfilled = await fill(
      bamboohr,
      form,
      {
        firstName: { kind: "text", value: "Asha" },
        "countryId.value": { kind: "option", value: "99", label: "India" },
        resume: { kind: "file", file: "resume" },
        nickname_hpcsaf: { kind: "text", value: "should never be typed" },
      },
      { resume },
    );
    expect(unfilled).toEqual([]);
    expect((document.getElementById("firstName") as HTMLInputElement).value).toBe("Asha");
    expect((document.getElementById("fab-select66") as HTMLSelectElement).value).toBe("99");
    expect(form.querySelector<HTMLInputElement>('input[type="file"]')!.files?.[0]?.name).toBe("Asha Rao - Resume.pdf");
    expect((document.getElementById("nickname_hpcsaf") as HTMLInputElement).value).toBe("");
    expect(bamboohr.submitButton(form)?.textContent).toBe("Submit Application");
  });
});

describe("applying on BambooHR (Phase 2)", () => {
  const location = { hostname: "knack.bamboohr.com", pathname: "/careers/56", href: "https://knack.bamboohr.com/careers/56" };
  const task = (overrides: Partial<LeasedTask> = {}): LeasedTask => ({
    taskId: "t1",
    leaseId: "lease-1",
    leaseUntil: "2026-11-22T10:10:00Z",
    applyUrl: location.href,
    system: "BAMBOOHR",
    title: "Data Analyst",
    company: "Knack",
    dryRun: false,
    documents: { resume: true, coverLetter: false },
    answers: null,
    ...overrides,
  });
  const BY_LABEL: Record<string, unknown> = {
    "First Name": { kind: "text", value: "Asha" },
    "Last Name": { kind: "text", value: "Rao" },
    Email: { kind: "text", value: "asha@example.test" },
    Phone: { kind: "text", value: "+91 98765 43210" },
    Address: { kind: "text", value: "12 MG Road" },
    City: { kind: "text", value: "Bengaluru" },
    Country: { kind: "option", value: "99", label: "India" },
    "Why do you want to work at Knack?": { kind: "text", value: "I like peer learning." },
  };
  function fakePort() {
    const requests: TabRequest[] = [];
    const port: Port = async <T,>(request: TabRequest): Promise<Reply<T>> => {
      requests.push(request);
      const ok = (data: unknown) => ({ ok: true as const, data: data as T });
      if (request.type === "answers") return ok({ answers: Object.fromEntries(request.fields.flatMap((field: FormField) => (BY_LABEL[field.label] ? [[field.key, BY_LABEL[field.label]]] : []))), missing: [] });
      if (request.type === "document") return ok({ name: "Asha Rao - Resume.pdf", type: "application/pdf", base64: btoa("%PDF-1.7") });
      if (request.type === "report") return ok(null);
      return { ok: false, error: "unexpected" };
    };
    return { port, requests };
  }

  it("opens the form, fills it, submits once and reads the confirmation", async () => {
    let submits = 0;
    bambooJobPage(document, {
      onSubmit: () => {
        submits++;
        bambooThanks(document);
      },
    });
    const { port, requests } = fakePort();
    const finish = await apply(port, document, location, { task: task(), submitted: false });
    expect(finish.report).toMatchObject({ outcome: "applied", evidence: { text: expect.stringContaining("Application submitted") } });
    expect(submits).toBe(1);
    expect(requests.some((request) => request.type === "report" && request.report.outcome === "submitting")).toBe(true);
  });

  it("in a dry run opens and fills the form but never submits", async () => {
    let submits = 0;
    bambooJobPage(document, { onSubmit: () => submits++ });
    const finish = await apply(fakePort().port, document, location, { task: task({ dryRun: true }), submitted: false });
    expect(finish).toEqual({ report: { outcome: "dry-run" }, keepTab: true });
    expect(submits).toBe(0);
    expect((document.getElementById("city.value") ?? document.getElementById("FabricTextField-63")) as HTMLInputElement).toHaveProperty("value", "Bengaluru");
  });

  it("hands the form to the student when a required answer is missing", async () => {
    bambooJobPage(document);
    delete BY_LABEL.Address;
    try {
      const finish = await apply(fakePort().port, document, location, { task: task(), submitted: false });
      expect(finish).toEqual({ report: { outcome: "needs-student", reason: REASONS.unanswered(["Address"]) }, keepTab: true });
    } finally {
      BY_LABEL.Address = { kind: "text", value: "12 MG Road" };
    }
  });
});
