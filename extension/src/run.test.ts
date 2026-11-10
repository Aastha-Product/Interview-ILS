import { beforeEach, describe, expect, it, vi } from "vitest";

import "./test/data-transfer";
import { lever } from "./boards";
import { comboboxChoices } from "./fill";
import { REASONS, type FormAnswers, type FormField, type LeasedTask, type Reply, type TabRequest } from "./protocol";
import { apply, WAIT, type Port } from "./run";
import { ashbyPage, ashbyThanks } from "./test/ashby-page";
import { confirmationPage, greenhousePage } from "./test/greenhouse-page";
import { leverPage, leverThanks } from "./test/lever-page";

vi.setConfig({ testTimeout: 20_000 });
WAIT.form = 300;
WAIT.confirmation = 1500;

const greenhouse = { hostname: "job-boards.greenhouse.io", pathname: "/acme/jobs/1", href: "https://job-boards.greenhouse.io/acme/jobs/1" };

const task = (overrides: Partial<LeasedTask> = {}): LeasedTask => ({
  taskId: "t1",
  leaseId: "lease-1",
  leaseUntil: "2026-11-10T10:10:00Z",
  applyUrl: greenhouse.href,
  system: "GREENHOUSE",
  title: "Data Analyst",
  company: "Acme",
  dryRun: false,
  documents: { resume: true, coverLetter: false },
  answers: {
    first_name: { kind: "text", value: "Asha" },
    last_name: { kind: "text", value: "Rao" },
    email: { kind: "text", value: "asha@example.test" },
    country: { kind: "text", value: "India" },
    question_1: { kind: "option", value: "1", label: "Yes" },
    "question_2[]": { kind: "options", values: ["9"], labels: ["LinkedIn"] },
    resume: { kind: "file", file: "resume" },
  },
  ...overrides,
});

/** The background, as the tab sees it: records every request; answers what the server would. */
function fakePort(options: { more?: (fields: FormField[]) => FormAnswers; refuseSubmitting?: boolean } = {}) {
  const requests: TabRequest[] = [];
  const port: Port = async <T,>(request: TabRequest): Promise<Reply<T>> => {
    requests.push(request);
    const ok = (data: unknown) => ({ ok: true as const, data: data as T });
    switch (request.type) {
      case "answers":
        return ok(
          options.more?.(request.fields) ?? {
            // What the server's rules say for these two (src/lib/apply/answers.ts).
            answers: {
              "4014225007": { kind: "option", value: "Decline To Self Identify", label: "Decline To Self Identify" },
              "question_4[]": { kind: "options", values: ["77"], labels: ["I Agree"] },
            },
            missing: [],
          },
        );
      case "document":
        return ok({ name: "Asha Rao - Resume.pdf", type: "application/pdf", base64: btoa("%PDF-1.7") });
      case "report":
        if (request.report.outcome === "submitting" && options.refuseSubmitting) return { ok: false, error: "This application isn't held by this browser any more." };
        return ok(null);
      default:
        return { ok: false, error: "unexpected" };
    }
  };
  return { port, requests };
}

let submits: number;
/** Greenhouse's response to Submit: the confirmation, or what `respond` puts on the page. */
function onSubmit(respond: (form: HTMLFormElement) => void = () => confirmationPage(document)) {
  const form = document.getElementById("application-form") as HTMLFormElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submits++;
    setTimeout(() => respond(form), 200);
  });
}

beforeEach(() => {
  submits = 0;
  greenhousePage(document);
});

describe("applying in the job's tab (auto-apply step 5b)", () => {
  it("fills everything, asks the server about what its copy of the form lacked, says it's submitting, then submits once", async () => {
    const { port, requests } = fakePort();
    let reportsBeforeSubmit: string[] = [];
    onSubmit();
    document.getElementById("application-form")!.addEventListener("submit", () => {
      reportsBeforeSubmit = requests.flatMap((request) => (request.type === "report" ? [request.report.outcome] : []));
    });

    const finish = await apply(port, document, greenhouse, { task: task(), submitted: false });

    expect(finish).toEqual({ report: { outcome: "applied", evidence: { url: greenhouse.href, text: expect.stringContaining("Thank you for applying.") } }, keepTab: false });
    expect(submits).toBe(1);
    expect(reportsBeforeSubmit).toEqual(["submitting"]);
    expect(requests.map((request) => request.type)).toEqual(["document", "answers", "report"]);
    const asked = requests.find((request) => request.type === "answers");
    expect(asked?.type === "answers" && asked.fields.map((field) => field.label)).toEqual(["Sex", "I agree to the privacy notice"]);
  });

  it("never presses Submit when Pathfinder took the application back", async () => {
    const { port } = fakePort({ refuseSubmitting: true });
    onSubmit();
    await expect(apply(port, document, greenhouse, { task: task(), submitted: false })).rejects.toThrow("isn't held");
    expect(submits).toBe(0);
  });

  it("stops filled in, without submitting, in a dry run", async () => {
    const { port, requests } = fakePort();
    onSubmit();
    expect(await apply(port, document, greenhouse, { task: task({ dryRun: true }), submitted: false })).toEqual({ report: { outcome: "dry-run" }, keepTab: true });
    expect(submits).toBe(0);
    expect(requests.some((request) => request.type === "report")).toBe(false);
    expect(comboboxChoices(document.getElementById("4014225007") as HTMLInputElement)).toEqual(["Decline To Self Identify"]);
  });

  it("hands the student what nobody can answer for them, with the rest filled in", async () => {
    const { port } = fakePort({ more: () => ({ answers: { "question_4[]": { kind: "options", values: ["77"], labels: ["I Agree"] } }, missing: ["Sex"] }) });
    onSubmit();
    expect(await apply(port, document, greenhouse, { task: task(), submitted: false })).toEqual({ report: { outcome: "needs-student", reason: REASONS.unanswered(["Sex"]) }, keepTab: true });
    expect(submits).toBe(0);
    expect((document.getElementById("first_name") as HTMLInputElement).value).toBe("Asha");
  });

  it("asks the server for every answer when it couldn't read the form itself", async () => {
    const { port, requests } = fakePort({ more: (fields) => ({ answers: Object.fromEntries(fields.filter((field) => field.key === "first_name").map((field) => [field.key, { kind: "text", value: "Asha" }])), missing: [] }) });
    const finish = await apply(port, document, greenhouse, { task: task({ answers: null }), submitted: false });
    const first = requests[0];
    expect(first.type === "answers" && first.fields.length).toBe(12);
    expect(finish.report.outcome).toBe("needs-student");
  });

  it("leaves companies' own application pages to the student", async () => {
    const { port, requests } = fakePort();
    expect(await apply(port, document, { hostname: "www.okta.com", pathname: "/careers/1", href: "https://www.okta.com/careers/1" }, { task: task(), submitted: false })).toEqual({
      report: { outcome: "needs-student", reason: REASONS.noForm },
      keepTab: false,
    });
    document.body.innerHTML = "<main>Job not found</main>";
    expect((await apply(port, document, greenhouse, { task: task(), submitted: false })).report).toEqual({ outcome: "needs-student", reason: REASONS.noForm });
    expect(requests).toEqual([]);
  });

  it("hands over what the browser's own required check objects to, rather than pressing a Submit that does nothing", async () => {
    greenhousePage(document, { extra: '<label>Pronouns <input name="custom_pronouns" required></label>' });
    onSubmit();
    const { port, requests } = fakePort();
    expect((await apply(port, document, greenhouse, { task: task(), submitted: false })).report).toEqual({ outcome: "needs-student", reason: REASONS.unanswered(["Pronouns"]) });
    expect(requests.some((request) => request.type === "report")).toBe(false);
    expect(submits).toBe(0);
  });

  it("stops for a puzzle before Submit", async () => {
    greenhousePage(document, { extra: '<iframe src="https://www.google.com/recaptcha/api2/anchor?k=1&size=normal"></iframe>' });
    onSubmit();
    const { port } = fakePort();
    expect((await apply(port, document, greenhouse, { task: task(), submitted: false })).report).toEqual({ outcome: "needs-student", reason: REASONS.challenge });
    expect(submits).toBe(0);
  });

  it("on the page after Submit (it loaded anew), only reads what it says", async () => {
    confirmationPage(document);
    const { port, requests } = fakePort();
    expect((await apply(port, document, { ...greenhouse, pathname: "/acme/jobs/1/confirmation" }, { task: task(), submitted: true })).report.outcome).toBe("applied");
    expect(requests).toEqual([]);
  });

  it("after Submit: an error, an emailed code, or silence", async () => {
    const run = async (respond: (form: HTMLFormElement) => void) => {
      greenhousePage(document);
      onSubmit(respond);
      return (await apply(fakePort().port, document, greenhouse, { task: task(), submitted: false })).report;
    };
    expect(await run((form) => form.insertAdjacentHTML("beforeend", '<p class="helper-text--error">Resume is required</p>'))).toEqual({ outcome: "needs-student", reason: REASONS.formError("Resume is required") });
    expect(await run((form) => form.insertAdjacentHTML("beforeend", '<p>A security code was sent to your email.</p><input id="security-input-0">'))).toEqual({ outcome: "needs-student", reason: REASONS.emailCode });
    expect(await run(() => undefined)).toEqual({ outcome: "uncertain", reason: REASONS.noAnswer });
  });
});

describe("applying on Lever and Ashby (auto-apply step 5c)", () => {
  /** What the server's rules answer for the questions the page shows (src/lib/apply/answers.ts). */
  const rules = (known: Record<string, string>) => (fields: FormField[]): FormAnswers => {
    const answers: FormAnswers["answers"] = {};
    const missing: string[] = [];
    for (const field of fields) {
      const value = known[field.label];
      if (field.type === "file") continue;
      if (value === undefined) {
        if (field.required) missing.push(field.label);
        continue;
      }
      const option = field.options.find((candidate) => candidate.label === value);
      answers[field.key] = option ? { kind: "option", value: option.value, label: option.label } : { kind: "text", value };
    }
    return { answers, missing };
  };

  it("reads Lever's form, has the server answer it, attaches the resume, and submits with Lever's own button", async () => {
    lever.afterResumeMs = 100;
    leverPage(document);
    let clicked = 0;
    document.getElementById("btn-submit")!.addEventListener("click", () => {
      clicked++;
      setTimeout(() => leverThanks(document), 100);
    });
    const { port, requests } = fakePort({
      more: rules({ "Full name": "Asha Rao", Email: "asha@example.test", Phone: "+91 98765 43210", "Current company": "Fresher", Gender: "Prefer not to disclose", "Total Years of experience": "0", "Are you willing to relocate to Bangalore?": "Yes", "How did you get to know about this role?": "Linkedin" }),
    });
    const finish = await apply(port, document, { hostname: "jobs.lever.co", pathname: "/meesho/1/apply", href: "https://jobs.lever.co/meesho/1/apply" }, { task: task({ answers: null, system: "LEVER" }), submitted: false });
    expect(finish.report).toEqual({ outcome: "applied", evidence: { url: "https://jobs.lever.co/meesho/1/apply", text: expect.stringContaining("Application submitted!") } });
    expect(clicked).toBe(1);
    expect(requests.map((request) => request.type)).toEqual(["answers", "document", "report"]);
  });

  it("on Ashby, which has no <form>, stops for a question nobody can answer for the student", async () => {
    ashbyPage(document);
    const { port } = fakePort({ more: rules({ Name: "Asha Rao", Email: "asha@example.test", "Phone Number": "+91 98765 43210", Location: "Pune", "Have you previously worked at Acme?": "No" }) });
    const finish = await apply(port, document, { hostname: "jobs.ashbyhq.com", pathname: "/Acme/1/application", href: "" }, { task: task({ answers: null, system: "ASHBY" }), submitted: false });
    expect(finish).toEqual({ report: { outcome: "needs-student", reason: REASONS.unanswered(["What is your notice period?"]) }, keepTab: true });
  });

  it("submits on Ashby once everything is answered", async () => {
    ashbyPage(document);
    document.querySelector(".ashby-application-form-submit-button")!.addEventListener("click", () => setTimeout(() => ashbyThanks(document), 100));
    const { port } = fakePort({ more: rules({ Name: "Asha Rao", Email: "asha@example.test", "Phone Number": "+91 98765 43210", Location: "Pune", "Have you previously worked at Acme?": "No", "What is your notice period?": "Immediate" }) });
    const finish = await apply(port, document, { hostname: "jobs.ashbyhq.com", pathname: "/Acme/1/application", href: "https://jobs.ashbyhq.com/Acme/1/application" }, { task: task({ answers: null, system: "ASHBY" }), submitted: false });
    expect(finish.report).toMatchObject({ outcome: "applied", evidence: { text: expect.stringContaining("successfully submitted") } });
  });
});
