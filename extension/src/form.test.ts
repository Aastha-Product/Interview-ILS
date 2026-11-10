import { beforeEach, describe, expect, it } from "vitest";

import { comboboxChoices } from "./fill";
import "./test/data-transfer";
import { boardFor, greenhouse } from "./boards";
import { challengeShown, emptyRequired, fill, outcome, readFields } from "./form";
import { confirmationPage, greenhousePage } from "./test/greenhouse-page";

const resume = new File(["%PDF"], "Asha Rao - Resume.pdf", { type: "application/pdf" });
const at = { pathname: "/acme/jobs/1", href: "https://job-boards.greenhouse.io/acme/jobs/1" };
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

let form: HTMLFormElement;
beforeEach(() => {
  form = greenhousePage(document);
});

describe("Greenhouse's form (auto-apply step 5b)", () => {
  it("finds the form only on Greenhouse's own pages", () => {
    expect(greenhouse.findForm(document)).toBe(form);
    expect(boardFor("job-boards.greenhouse.io")).toBe(greenhouse);
    expect(boardFor("boards.greenhouse.io")).toBe(greenhouse);
    expect(boardFor("www.okta.com")).toBeNull();
    expect(boardFor("greenhouse.io.evil.example")).toBeNull();
  });

  it("fills the server's answers: text, drop-downs (also ones that only show what's typed), checkboxes and the resume", async () => {
    const unfilled = await fill(greenhouse, form,
      {
        first_name: { kind: "text", value: "Asha" },
        last_name: { kind: "text", value: "Rao" },
        email: { kind: "text", value: "asha@example.test" },
        country: { kind: "text", value: "India" },
        question_1: { kind: "option", value: "1", label: "Yes" },
        "question_2[]": { kind: "options", values: ["a", "b"], labels: ["LinkedIn", "Friend"] },
        "question_4[]": { kind: "options", values: ["77"], labels: ["I Agree"] },
        resume: { kind: "file", file: "resume" },
        // Not on this page any more: ignored.
        question_99: { kind: "text", value: "x" },
      },
      { resume },
    );
    expect(unfilled).toEqual([]);
    expect(input("first_name").value).toBe("Asha");
    expect(comboboxChoices(input("country"))).toEqual(["India"]);
    expect(comboboxChoices(input("question_1"))).toEqual(["Yes"]);
    expect(comboboxChoices(input("question_2[]")).sort()).toEqual(["Friend", "LinkedIn"]);
    expect(input("question_4[]_77").checked).toBe(true);
    expect(input("resume").files?.[0]?.name).toBe("Asha Rao - Resume.pdf");
  });

  it("finds multi-selects named with or without []", async () => {
    expect(await fill(greenhouse, form, { question_2: { kind: "options", values: [], labels: ["Other"] }, question_4: { kind: "options", values: ["77"], labels: [] } }, {})).toEqual([]);
    expect(comboboxChoices(input("question_2[]"))).toEqual(["Other"]);
    expect(input("question_4[]_77").checked).toBe(true);
  });

  it("says which answers didn't fit, by the question's wording", async () => {
    const unfilled = await fill(greenhouse, form, { question_1: { kind: "option", value: "x", label: "Maybe" }, resume: { kind: "file", file: "resume" } }, {});
    // Files go in first.
    expect(unfilled).toEqual(["Resume/CV", "Are you legally authorized to work in India?"]);
  });

  it("lists the required questions still empty, with their options, for the server to answer", async () => {
    await fill(greenhouse, form, { first_name: { kind: "text", value: "Asha" }, question_1: { kind: "option", value: "1", label: "Yes" } }, {});
    const empty = await emptyRequired(greenhouse, form);
    expect(empty.map((field) => field.label)).toEqual(["Last Name", "Email", "Resume/CV", "Country", "How did you hear about us?", "Sex", "I agree to the privacy notice"]);
    expect(empty.find((field) => field.key === "4014225007")).toEqual({ key: "4014225007", label: "Sex", required: true, type: "single", options: ["Male", "Female", "Decline To Self Identify"].map((label) => ({ label, value: label })) });
    expect(empty.find((field) => field.key === "question_2[]")?.type).toBe("multi");
    expect(empty.find((field) => field.key === "question_4[]")).toMatchObject({ type: "multi", options: [{ label: "I Agree", value: "77" }] });
    // Opening a menu to read it closes it again.
    expect(document.querySelector(".select__menu")).toBeNull();
  });

  it("reads every question when the server couldn't", async () => {
    const fields = await readFields(greenhouse, form);
    expect(fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ["first_name", "text", true],
      ["last_name", "text", true],
      ["email", "text", true],
      ["phone", "text", false],
      ["resume", "file", true],
      ["cover_letter", "file", false],
      ["country", "single", true],
      ["question_1", "single", true],
      ["question_2[]", "multi", true],
      ["4014225007", "single", true],
      ["question_3", "textarea", false],
      ["question_4[]", "multi", true],
    ]);
    // A list that only shows what's typed can't be read: the server sees no options.
    expect(fields.find((field) => field.key === "country")?.options).toEqual([]);
  });

  it("fills native drop-downs and radio buttons too", async () => {
    form = greenhousePage(document, {
      combos: [],
      extra: `<label for="question_5">Notice period</label><select id="question_5"><option value="">Pick</option><option value="30">30 days</option></select>
        <fieldset><legend>Relocate?</legend><label><input type="radio" name="question_6" value="y">Yes</label><label><input type="radio" name="question_6" value="n">No</label></fieldset>`,
    });
    expect(await fill(greenhouse, form, { question_5: { kind: "option", value: "30", label: "30 days" }, question_6: { kind: "option", value: "n", label: "No" } }, {})).toEqual([]);
    expect((document.getElementById("question_5") as HTMLSelectElement).value).toBe("30");
    expect((document.querySelector('input[value="n"]') as HTMLInputElement).checked).toBe(true);
    expect((await readFields(greenhouse, form)).filter((field) => field.key.startsWith("question_")).map((field) => [field.key, field.type, field.options.length])).toEqual([
      ["question_3", "textarea", 0],
      ["question_4[]", "multi", 1],
      ["question_5", "single", 1],
      ["question_6", "single", 2],
    ]);
  });

  it("finds the Submit button", () => {
    expect(greenhouse.submitButton(form)?.textContent).toBe("Submit application");
  });
});

describe("what the page says after Submit", () => {
  it("nothing yet while the form is still there without errors", () => {
    expect(outcome(greenhouse, document, at)).toBeNull();
  });

  it("a confirmation, with its words as evidence", () => {
    confirmationPage(document);
    expect(outcome(greenhouse, document, at)).toEqual({ kind: "confirmed", text: expect.stringContaining("Thank you for applying.") });
    expect(outcome(greenhouse, document, { pathname: "/acme/jobs/1/confirmation", href: "" })?.kind).toBe("confirmed");
  });

  it("never takes thanks on the form's own page for a confirmation", () => {
    form.insertAdjacentHTML("afterbegin", "<p>Thank you for your interest in Acme!</p>");
    expect(outcome(greenhouse, document, at)).toBeNull();
  });

  it("an error the form shows", () => {
    form.insertAdjacentHTML("beforeend", '<p class="helper-text--error" id="email-error">Enter a valid email</p>');
    expect(outcome(greenhouse, document, at)).toEqual({ kind: "error", text: "Enter a valid email" });
  });

  it("an emailed code", () => {
    form.insertAdjacentHTML("beforeend", '<p>Enter the 8-character security code sent to your email.</p><input id="security-input-0">');
    expect(outcome(greenhouse, document, at)).toEqual({ kind: "email-code" });
  });

  it("a puzzle, but not reCAPTCHA's invisible check", () => {
    form.insertAdjacentHTML("beforeend", '<div style="visibility: hidden"><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe?k=1"></iframe></div><iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor?k=1&size=invisible"></iframe>');
    expect(challengeShown(document)).toBe(false);
    form.insertAdjacentHTML("beforeend", '<div><iframe src="https://www.google.com/recaptcha/api2/bframe?k=1"></iframe></div>');
    expect(challengeShown(document)).toBe(true);
    expect(outcome(greenhouse, document, at)).toEqual({ kind: "challenge" });
  });

  it("a visible \"I'm not a robot\" box, or hCaptcha, or Cloudflare's check", () => {
    for (const source of ["https://www.google.com/recaptcha/api2/anchor?k=1&size=normal", "https://newassets.hcaptcha.com/captcha/v1/x", "https://challenges.cloudflare.com/cdn-cgi/challenge"]) {
      greenhousePage(document, { extra: `<iframe src="${source}"></iframe>` });
      expect(challengeShown(document), source).toBe(true);
    }
  });
});
