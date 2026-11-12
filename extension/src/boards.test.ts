import { beforeEach, describe, expect, it } from "vitest";

import "./test/data-transfer";
import { ashby, boardFor, greenhouse, lever } from "./boards";
import { challengeShown, emptyRequired, fill, outcome, readFields } from "./form";
import { ashbyPage, ashbyThanks } from "./test/ashby-page";
import { leverPage, leverThanks } from "./test/lever-page";

const resume = new File(["%PDF"], "Asha Rao - Resume.pdf", { type: "application/pdf" });
const field = (selector: string) => document.querySelector(selector) as HTMLInputElement;

describe("which board a page is", () => {
  it("knows Greenhouse, Lever and Ashby by their own hosts only", () => {
    expect(boardFor("jobs.lever.co")).toBe(lever);
    expect(boardFor("jobs.eu.lever.co")).toBe(lever);
    expect(boardFor("jobs.ashbyhq.com")).toBe(ashby);
    expect(boardFor("job-boards.greenhouse.io")).toBe(greenhouse);
    expect(boardFor("lever.co.evil.example")).toBeNull();
    expect(boardFor("careers.meesho.com")).toBeNull();
  });
});

describe("Lever's form (auto-apply step 5c)", () => {
  let form: HTMLElement;
  beforeEach(() => {
    lever.afterResumeMs = 200;
    form = leverPage(document);
  });

  it("reads every question by its name, with its wording and whether it's required", async () => {
    const fields = await readFields(lever, form);
    expect(fields.map((entry) => [entry.key, entry.label, entry.type, entry.required])).toEqual([
      ["resume", "Resume/CV", "file", true],
      ["name", "Full name", "text", true],
      ["email", "Email", "text", true],
      ["phone", "Phone", "text", true],
      ["location", "Current location", "text", false],
      ["org", "Current company", "text", true],
      ["urls[LinkedIn]", "LinkedIn URL", "text", false],
      ["cards[c1][field0]", "Gender", "single", true],
      ["cards[c1][field1]", "Total Years of experience", "text", true],
      ["cards[c1][field2]", "Are you willing to relocate to Bangalore?", "single", true],
      ["cards[c1][field8]", "How did you get to know about this role?", "single", true],
    ]);
    expect(fields[7].options.map((option) => option.label)).toEqual(["Male", "Female", "Other", "Prefer not to disclose"]);
    expect(fields[10].options).toEqual([
      { label: "Linkedin", value: "Linkedin" },
      { label: "Meesho Job Site", value: "Meesho Job Site" },
      { label: "Naukri", value: "Naukri" },
    ]);
  });

  it("attaches the resume first and fills in after Lever has read it, so ours win", async () => {
    const unfilled = await fill(
      lever,
      form,
      {
        name: { kind: "text", value: "Asha Rao" },
        resume: { kind: "file", file: "resume" },
        "cards[c1][field0]": { kind: "option", value: "Prefer not to disclose", label: "Prefer not to disclose" },
        "cards[c1][field2]": { kind: "option", value: "Yes", label: "Yes" },
        "cards[c1][field8]": { kind: "option", value: "Linkedin", label: "Linkedin" },
      },
      { resume },
    );
    expect(unfilled).toEqual([]);
    expect(field('input[name="name"]').value).toBe("Asha Rao");
    expect(field('input[value="Prefer not to disclose"]').checked).toBe(true);
    expect((document.querySelector('select[name="cards[c1][field8]"]') as HTMLSelectElement).value).toBe("Linkedin");
    expect((await emptyRequired(lever, form)).map((entry) => entry.label)).toEqual(["Email", "Phone", "Current company", "Total Years of experience"]);
  });

  it("presses Lever's own Submit button, not hCaptcha's hidden one, and isn't fooled by the invisible check", () => {
    expect(lever.submitButton(form)?.id).toBe("btn-submit");
    expect(challengeShown(document)).toBe(false);
    (document.querySelector(".h-captcha iframe") as HTMLElement).style.visibility = "visible";
    expect(challengeShown(document)).toBe(true);
  });

  it("knows the page after Submit", () => {
    expect(outcome(lever, document, { pathname: "/meesho/1/apply", href: "" })).toBeNull();
    leverThanks(document);
    expect(outcome(lever, document, { pathname: "/meesho/1/thanks", href: "" })).toEqual({ kind: "confirmed", text: expect.stringContaining("Application submitted!") });
  });
});

describe("Ashby's form (auto-apply step 5c)", () => {
  let form: HTMLElement;
  beforeEach(() => {
    form = ashbyPage(document);
  });

  it("reads every question by its field path", async () => {
    const fields = await readFields(ashby, form);
    expect(fields.map((entry) => [entry.key, entry.label, entry.type, entry.required])).toEqual([
      ["_systemfield_name", "Name", "text", true],
      ["_systemfield_email", "Email", "text", true],
      ["_systemfield_resume", "Resume", "file", true],
      ["phone-1", "Phone Number", "text", true],
      ["gender-1", "Gender", "single", false],
      ["_systemfield_location", "Location", "text", true],
      ["worked-1", "Have you previously worked at Acme?", "single", true],
      ["comp-1", "What type of compensation do you currently receive?", "multi", false],
      ["_systemfield_education_history", "Education History", "text", false],
      ["notice-1", "What is your notice period?", "textarea", true],
    ]);
    expect(fields.find((entry) => entry.key === "worked-1")?.options).toEqual([
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ]);
    // Options sharing one id are told apart by the words beside them.
    expect(fields.find((entry) => entry.key === "comp-1")?.options.map((option) => option.label)).toEqual(["Base", "Variable", "RSU"]);
    // Options without values of their own ("on") go to the server by their words.
    expect(fields.find((entry) => entry.key === "gender-1")?.options).toEqual(["Male", "Female", "Decline to self-identify"].map((label) => ({ label, value: label })));
  });

  it("presses Yes or No, picks the place that starts with what's written, and ticks options by their words", async () => {
    const unfilled = await fill(
      ashby,
      form,
      {
        _systemfield_name: { kind: "text", value: "Asha Rao" },
        _systemfield_resume: { kind: "file", file: "resume" },
        "phone-1": { kind: "text", value: "+91 98765 43210" },
        "gender-1": { kind: "option", value: "on", label: "Decline to self-identify" },
        _systemfield_location: { kind: "text", value: "Pune" },
        "worked-1": { kind: "option", value: "no", label: "No" },
        "comp-1": { kind: "options", values: [], labels: ["Base", "Variable"] },
        _systemfield_education_history: { kind: "text", value: "B.Tech" },
      },
      { resume },
    );
    expect(unfilled).toEqual(["Education History"]);
    expect(field('[data-field-path="_systemfield_location"] input').value).toBe("Pune, Maharashtra, India");
    expect(field('button[data-option="no"]').getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[data-field-path="comp-1"] input')).map((input) => input.checked)).toEqual([true, true, false]);
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[data-field-path="gender-1"] input')).map((input) => input.checked)).toEqual([false, false, true]);
    expect(field("#_systemfield_resume").files?.[0]?.name).toBe("Asha Rao - Resume.pdf");
    expect((await emptyRequired(ashby, form)).map((entry) => entry.label)).toEqual(["Email", "What is your notice period?"]);
  });

  it("finds a written place by its first part: \"Pune, India\" is Pune, Maharashtra, not Punjab", async () => {
    expect(await fill(ashby, form, { _systemfield_location: { kind: "text", value: "Pune, India" } }, {})).toEqual([]);
    expect(field('[data-field-path="_systemfield_location"] input').value).toBe("Pune, Maharashtra, India");
  });

  it("leaves a place it can't find empty, rather than whatever was typed", async () => {
    expect(await fill(ashby, form, { _systemfield_location: { kind: "text", value: "Atlantis" } }, {})).toEqual(["Location"]);
    expect(field('[data-field-path="_systemfield_location"] input').value).toBe("");
  });

  it("finds Submit, and the thanks that replaces the form", () => {
    expect(ashby.submitButton(form)?.textContent).toBe("Submit Application");
    expect(outcome(ashby, document, { pathname: "/Acme/1/application", href: "" })).toBeNull();
    ashbyThanks(document);
    expect(outcome(ashby, document, { pathname: "/Acme/1/application", href: "" })).toEqual({ kind: "confirmed", text: expect.stringContaining("successfully submitted") });
  });

  it("surfaces a required choice group sharing an entry with a text field, so it isn't skipped", async () => {
    // Ashby can put a required consent (a radio/checkbox) in the same entry as the phone number.
    document.querySelector<HTMLInputElement>('[data-field-path="phone-1"] input[type="radio"]')!.required = true;
    expect((await readFields(ashby, form)).map((entry) => entry.key)).toContain("phone-1#choice");
    // Required and unanswered, so it's flagged for the student instead of being silently skipped.
    expect((await emptyRequired(ashby, form)).map((entry) => entry.key)).toContain("phone-1#choice");
  });

  it("backstops Ashby before Submit (no native form check): a disabled Submit or a field error", () => {
    expect(ashby.preSubmitInvalid!(form)).toEqual([]);
    const submit = document.querySelector<HTMLButtonElement>(".ashby-application-form-submit-button")!;
    submit.disabled = true;
    expect(ashby.preSubmitInvalid!(form)).toEqual(["a required question on the form"]);
    submit.disabled = false;
    const error = document.createElement("div");
    error.className = "_error_x1";
    error.textContent = "This field is required";
    document.querySelector('[data-field-path="notice-1"]')!.append(error);
    expect(ashby.preSubmitInvalid!(form)).toEqual(["This field is required"]);
  });
});
