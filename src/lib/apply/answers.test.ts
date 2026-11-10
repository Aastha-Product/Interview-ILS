import { describe, expect, it } from "vitest";

import { adultBy, answerForm, EMPTY_ANSWERS, splitName, type AnswerContext, type FieldOption, type FormField, type SavedAnswers } from "./answers";

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

  it("answers the questions real forms asked that the pipeline check found unanswered", () => {
    const countries = [
      { label: "India", value: "IN" },
      { label: "United States", value: "US" },
    ];
    const full: SavedAnswers = { ...answered, employmentRestrictions: false, governmentOfficial: false, relativeOfGovernmentOfficial: false, referredByEmployee: false };
    const form = [
      field("pfn", "Preferred First Name", "text"),
      field("cc", "Current Company", "text"),
      field("ct", "Current Title", "text"),
      field("emp", "Who is your current or previous employer?", "text"),
      field("job", "What is your current or previous job title?", "text"),
      field("addr", "Home Address", "text"),
      field("res", "What is your current country of residence?", "single", true, countries),
      field("work[]", "Please select the country or countries you anticipate working in for the role in which you are applying.", "multi", true, countries),
      field("city", "In what city and state is your primary residence? (e.g. San Jose, CA)", "text"),
      field("adult", "Are you at least 18 years of age?", "single", true, yesNo),
      field("restr", "Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?", "single", true, yesNo),
      field("gov", "Are you a current government official or were you a government official in the last five years?", "single", true, yesNo),
      field("govrel", "Are you a close relative of a government official (i.e., child/step-child, spouse/partner, parent)?", "single", true, yesNo),
      field("ref", "To your knowledge, were you referred to this position by a senior leader or decision-maker?", "single", true, yesNo),
      field("wa", "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?", "single", true, yesNo),
      field("comm", "How should we communicate with you?", "single", true, [
        { label: "Phone", value: "p" },
        { label: "Email", value: "e" },
      ]),
      field("ai[]", "I understand that Coinbase may use AI tools to assist in the application and interview process.", "multi", true, [{ label: "I understand", value: "ok" }]),
      field("uni", "University", "text"),
    ];
    const { answers, missing } = answerForm(form, {
      ...context({ saved: full }),
      basics: { ...context().basics, address: "12 MG Road, Pune", dob: "2004-05-17" },
      currentCompany: "Infosys",
      currentTitle: "Systems Engineer Trainee",
      university: "Savitribai Phule Pune University",
    });
    expect(missing).toEqual([]);
    expect(answers).toMatchObject({
      pfn: { value: "Asha Rani" },
      cc: { value: "Infosys" },
      ct: { value: "Systems Engineer Trainee" },
      emp: { value: "Infosys" },
      job: { value: "Systems Engineer Trainee" },
      addr: { value: "12 MG Road, Pune" },
      res: { kind: "option", label: "India" },
      "work[]": { kind: "options", labels: ["India"] },
      city: { value: "Pune, India" },
      adult: { label: "Yes" },
      restr: { label: "No" },
      gov: { label: "No" },
      govrel: { label: "No" },
      ref: { label: "No" },
      wa: { label: "No" },
      comm: { label: "Email" },
      "ai[]": { labels: ["I understand"] },
      uni: { value: "Savitribai Phule Pune University" },
    });
  });

  it("never signs, waives or agrees to a legal document for the student", () => {
    const form = [
      field("nda", "Please Review the NDA and indicate your agreement by typing your full name below", "text"),
      field("arb[]", "Please confirm receipt of the above linked Global Data Privacy Notice and US Arbitration Agreement", "multi", true, [{ label: "Yes", value: "y" }]),
      field("sig", "Signature", "text", false),
    ];
    const { answers, missing } = answerForm(form, context());
    expect(answers).toEqual({});
    expect(missing).toEqual([form[0].label, form[1].label]);
  });

  it("works out 18 or older from a date of birth", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(adultBy("2008-11-10", now)).toBe(true);
    expect(adultBy("2008-11-11", now)).toBe(false);
    expect(adultBy("17/05/2004", now)).toBe(true);
    expect(adultBy("", now)).toBeNull();
    expect(adultBy("sometime", now)).toBeNull();
  });

  it("splits a name into first and last", () => {
    expect(splitName("Asha")).toEqual(["Asha", ""]);
    expect(splitName(" Asha  Rani Verma ")).toEqual(["Asha Rani", "Verma"]);
  });
});
