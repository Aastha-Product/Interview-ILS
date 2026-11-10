import { describe, expect, it } from "vitest";

import { answerForm, EMPTY_ANSWERS, splitName, type AnswerContext, type FieldOption, type FormField, type SavedAnswers } from "./answers";

const yesNo: FieldOption[] = [
  { label: "Yes", value: "1" },
  { label: "No", value: "0" },
];
const field = (key: string, label: string, type: FormField["type"], required = true, options: FieldOption[] = []): FormField => ({ key, label, required, type, options });

const answered: SavedAnswers = {
  ...EMPTY_ANSWERS,
  workAuthorized: true,
  needsSponsorship: false,
  noticePeriod: "immediate",
  relativesAtCompany: false,
  backgroundCheckConsent: true,
  acceptPrivacyNotices: true,
  outsideActivities: false,
  expectedSalary: "6 LPA",
};

const context = (overrides: Partial<AnswerContext> = {}): AnswerContext => ({
  basics: { name: "Asha Rani Verma", email: "asha@example.com", phone: "+91 98765 43210", city: "Pune", country: "India", linkedin: "https://linkedin.com/in/asha", website: "" },
  pastEmployers: ["Infosys"],
  graduationYear: "2026",
  company: "Groww",
  saved: answered,
  ...overrides,
});

// Groww's form, as its public API described it on 10 November 2026.
const groww: FormField[] = [
  field("first_name", "First Name", "text"),
  field("last_name", "Last Name", "text"),
  field("email", "Email", "text"),
  field("phone", "Phone", "text"),
  field("resume", "Resume/CV", "file"),
  field("question_1", "LinkedIn Profile Link", "text", false),
  field("question_2", "What is the notice period in your current employment?", "single", false, [
    { label: "Available to join immediate", value: "a" },
    { label: "Less than 30 days", value: "b" },
    { label: "30 days", value: "c" },
    { label: "60 days", value: "d" },
  ]),
  field("question_3", "Do you have a relative/ family member working currently in Groww?", "single", true, yesNo),
  field("question_4", "Have you previously been employed by Groww in any capacity (e.g., full-time, intern)?", "single", true, yesNo),
  field("question_5", "Do you provide your consent for us to conduct your background verification?", "single", true, yesNo),
  field("longitude", "Longitude", "hidden"),
];

describe("answering a form (auto-apply step 4)", () => {
  it("answers Groww's whole form from the profile and the saved answers", () => {
    const { answers, missing } = answerForm(groww, context());
    expect(missing).toEqual([]);
    expect(answers).toEqual({
      first_name: { kind: "text", value: "Asha Rani" },
      last_name: { kind: "text", value: "Verma" },
      email: { kind: "text", value: "asha@example.com" },
      phone: { kind: "text", value: "+91 98765 43210" },
      resume: { kind: "file", file: "resume" },
      question_1: { kind: "text", value: "https://linkedin.com/in/asha" },
      question_2: { kind: "option", value: "a", label: "Available to join immediate" },
      question_3: { kind: "option", value: "0", label: "No" },
      question_4: { kind: "option", value: "0", label: "No" },
      question_5: { kind: "option", value: "1", label: "Yes" },
    });
  });

  it("answers Okta's questions on authorisation, sponsorship, outside work and its privacy notice", () => {
    const okta: FormField[] = [
      field("q1", "Are you legally authorized to work in the country you reside?", "single", true, yesNo),
      field("q2", "Will you now or in the future require Visa Sponsorship?", "single", true, yesNo),
      field("q3", "If yes, please identify name of person / vendor and describe relationship / association:", "text", false),
      field("q4", "Do you have any outside business activity(ies) (advisory, consulting, or board roles)?", "single", true, yesNo),
      field("q5", "Have you been employed by Okta, Inc. or any of its subsidiaries in the past?", "single", true, yesNo),
      field("q6[]", "I acknowledge and agree to the processing of my personal data in accordance with Okta's Privacy Notice", "multi", true, [{ label: "I acknowledge", value: "ack" }]),
    ];
    const { answers, missing } = answerForm(okta, context({ company: "Okta" }));
    expect(missing).toEqual([]);
    expect(answers).toEqual({
      q1: { kind: "option", value: "1", label: "Yes" },
      q2: { kind: "option", value: "0", label: "No" },
      q4: { kind: "option", value: "0", label: "No" },
      q5: { kind: "option", value: "0", label: "No" },
      q6: undefined,
      "q6[]": { kind: "options", values: ["ack"], labels: ["I acknowledge"] },
    });
  });

  it("says yes to having worked there only when the profile shows it", () => {
    const asked = (company: string) => field("q", `Have you ever worked for ${company} before?`, "single", true, yesNo);
    // The profile says "Infosys"; the form says "Infosys Limited".
    expect(answerForm([asked("Infosys")], context({ company: "Infosys Limited" })).answers.q).toMatchObject({ label: "Yes" });
    expect(answerForm([asked("Wipro")], context({ company: "Wipro Ltd." })).answers.q).toMatchObject({ label: "No" });
    // A question about another company isn't answered.
    expect(answerForm([asked("Infosys")], context({ company: "Wipro" })).missing).toEqual(["Have you ever worked for Infosys before?"]);
  });

  it("never guesses: what the profile and saved answers don't cover waits for the student", () => {
    const form = [
      field("q1", "Are you authorized to work in India?", "single", true, yesNo),
      field("q2", "Why do you want to join us?", "textarea"),
      field("q3", "Have you worked with React before?", "single", true, yesNo),
      field("q4", "Anything else you'd like to share?", "textarea", false),
    ];
    const { answers, missing } = answerForm(form, context({ saved: EMPTY_ANSWERS }));
    expect(answers).toEqual({});
    expect(missing).toEqual(["Are you authorized to work in India?", "Why do you want to join us?", "Have you worked with React before?"]);
  });

  it("leaves a required consent the student refused unanswered, so the application waits", () => {
    const consent = field("c[]", "I consent to the processing of my personal data", "multi", true, [{ label: "I consent", value: "yes" }]);
    expect(answerForm([consent], context({ saved: { ...answered, acceptPrivacyNotices: false } })).missing).toEqual(["I consent to the processing of my personal data"]);
  });

  it("declines demographic questions, and leaves optional ones it can't decline", () => {
    const form = [
      field("g", "Gender", "single", true, [
        { label: "Female", value: "f" },
        { label: "Male", value: "m" },
        { label: "I don't wish to answer", value: "x" },
      ]),
      field("v", "Veteran status", "single", false, [{ label: "I am not a veteran", value: "n" }]),
    ];
    const { answers, missing } = answerForm(form, context());
    expect(answers).toEqual({ g: { kind: "option", value: "x", label: "I don't wish to answer" } });
    expect(missing).toEqual([]);
  });

  it("picks the notice period option closest to the student's, and writes it in text fields", () => {
    const options = [
      { label: "Immediate", value: "0" },
      { label: "15 days", value: "15" },
      { label: "1 month", value: "30" },
      { label: "2 months", value: "60" },
      { label: "3 months", value: "90" },
    ];
    const notice = (period: SavedAnswers["noticePeriod"], type: FormField["type"] = "single") =>
      answerForm([field("n", "When can you join?", type, true, type === "single" ? options : [])], context({ saved: { ...answered, noticePeriod: period } })).answers.n;
    expect(notice("30")).toMatchObject({ value: "30" });
    expect(notice("60")).toMatchObject({ value: "60" });
    expect(notice("immediate", "text")).toEqual({ kind: "text", value: "Immediately" });
  });

  it("answers salary, graduation year, location and how they heard of the job", () => {
    const form = [
      field("s", "Expected CTC", "text"),
      field("y", "Year of graduation", "text"),
      field("l", "Current location", "text"),
      field("h", "How did you hear about us?", "single", true, [
        { label: "Referral", value: "r" },
        { label: "Company website", value: "w" },
      ]),
    ];
    expect(answerForm(form, context()).answers).toEqual({
      s: { kind: "text", value: "6 LPA" },
      y: { kind: "text", value: "2026" },
      l: { kind: "text", value: "Pune, India" },
      h: { kind: "option", value: "w", label: "Company website" },
    });
  });

  it("splits a name into first and last", () => {
    expect(splitName("Asha")).toEqual(["Asha", ""]);
    expect(splitName(" Asha  Rani Verma ")).toEqual(["Asha Rani", "Verma"]);
  });
});
