import { describe, expect, it } from "vitest";

import { adultBy, answerForm, askableHere, customKey, EMPTY_ANSWERS, missingAnswers, missingAnswersMessage, missingFields, splitName, type AnswerContext, type FieldOption, type FormField, type SavedAnswers } from "./answers";

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
      // Greenhouse's own demographic question, as Zscaler's form showed it.
      field("4014225007", "Sex", "single", true, [
        { label: "Male", value: "Male" },
        { label: "Female", value: "Female" },
        { label: "Decline To Self Identify", value: "Decline To Self Identify" },
      ]),
    ];
    const { answers, missing } = answerForm(form, context());
    expect(answers).toEqual({
      g: { kind: "option", value: "x", label: "I don't wish to answer" },
      "4014225007": { kind: "option", value: "Decline To Self Identify", label: "Decline To Self Identify" },
    });
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

  it("answers Greenhouse's own Country question, but not citizenship (found in the Chrome tests)", () => {
    const countries = [
      { label: "Indonesia", value: "ID" },
      { label: "India", value: "IN" },
    ];
    const form = [field("country", "Country", "single", true, countries), field("c2", "Country/Region", "text"), field("n", "Country of citizenship", "single", true, countries)];
    const { answers, missing } = answerForm(form, context());
    expect(answers).toEqual({ country: { kind: "option", value: "IN", label: "India" }, c2: { kind: "text", value: "India" } });
    expect(missing).toEqual(["Country of citizenship"]);
  });

  it("answers name, email, phone and resume by Ashby's field names or their plain wording (found in the Chrome tests)", () => {
    const form = [
      field("_systemfield_name", "Name", "text"),
      field("_systemfield_email", "Email", "text"),
      field("8c1f", "Phone Number", "text"),
      field("_systemfield_resume", "Resume", "file"),
      field("a1", "Email address", "text"),
      field("a2", "Mobile No", "text"),
      field("a3", "Name as per Aadhaar card", "text"),
    ];
    const { answers, missing } = answerForm(form, context());
    expect(answers).toEqual({
      _systemfield_name: { kind: "text", value: "Asha Rani Verma" },
      _systemfield_email: { kind: "text", value: "asha@example.com" },
      "8c1f": { kind: "text", value: "+91 98765 43210" },
      _systemfield_resume: { kind: "file", file: "resume" },
      a1: { kind: "text", value: "asha@example.com" },
      a2: { kind: "text", value: "+91 98765 43210" },
    });
    expect(missing).toEqual(["Name as per Aadhaar card"]);
  });

  it("reads Meesho's wording of how they heard of the job, and leaves it when no option is honest", () => {
    const meesho = (options: string[]) => [field("s", "How did you get to know about this role?", "single", true, options.map((label) => ({ label, value: label })))];
    expect(answerForm(meesho(["Linkedin", "Meesho Job Site", "Naukri"]), context()).answers).toEqual({ s: { kind: "option", value: "Meesho Job Site", label: "Meesho Job Site" } });
    expect(answerForm(meesho(["Linkedin", "Naukri"]), context()).missing).toEqual(["How did you get to know about this role?"]);
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

  it("reads yes and no in the words real options use", () => {
    const form = [
      // Rubrik's form on 10 November 2026.
      field("rubrik", "Are you currently or have you ever been employed by Rubrik or contracted to provide services to Rubrik?", "single", true, [
        { label: "I have never been employed by Rubrik or contracted to provide services to Rubrik", value: "never" },
        { label: "I am currently a full/part-time employee for Rubrik", value: "current" },
      ]),
      // Airbnb's: one option to choose.
      field("airbnb", "Consent to Privacy Notice (Airbnb Global Capability Center Private Limited)", "single", true, [{ label: "I have read and consent to the Privacy Notice.", value: "ok" }]),
      field("guide[]", "By checking this box, I confirm I have read, reviewed and understood the guidelines outlined above.", "multi", true, [{ label: "Yes", value: "y" }]),
      field("both", "Do you agree to our privacy notice?", "single", true, [
        { label: "I have read and do not consent", value: "no" },
        { label: "I have read and consent", value: "yes" },
      ]),
    ];
    expect(answerForm(form, context({ company: "Rubrik" })).answers).toMatchObject({
      rubrik: { value: "never" },
      airbnb: { value: "ok" },
      "guide[]": { values: ["y"] },
      both: { value: "yes" },
    });
  });

  it("answers how soon they can join, where they are, and their total experience", () => {
    const ranges = ["0-2 years", "3-4 years", "5-7 years", "16 or more years"].map((label) => ({ label, value: label }));
    const form = [
      field("join", "How soon can you join us?", "text"),
      field("loc", "What is your current location", "text"),
      field("from", "From where do you intend to work?", "text"),
      field("exp", "Total experience?", "text"),
      field("excl", "What is your total years of experience? (excluding internships)", "single", true, ranges),
      field("follow", "If you selected a response to the prior question other than “None of the above,” please describe", "text"),
      field("specific", "How many years of relevant experience do you have in disaster response operations?", "single", true, ranges),
    ];
    const { answers, missing } = answerForm(form, context({ experienceMonths: 30, experienceMonthsWithoutInternships: 0 }));
    expect(answers).toMatchObject({
      join: { value: "Immediately" },
      loc: { value: "Pune, India" },
      from: { value: "Pune, India" },
      exp: { value: "2" },
      excl: { value: "0-2 years" },
      follow: { value: "N/A" },
    });
    // Experience in one field isn't the total: the student answers it.
    expect(missing).toEqual(["How many years of relevant experience do you have in disaster response operations?"]);
  });

  it("answers the wording live forms used on 11 November 2026, from what the student gave", () => {
    const form = [
      // InMobi, FamPay, HackerRank, Atlan.
      field("present", "What is your present CTC", "text"),
      field("fixed", "What is your current fixed CTC?", "text"),
      field("fixedExpected", "What is your expected fixed CTC?", "text"),
      field("range", "Please provide the range of salary you seeking in LPA.", "text"),
      field("expectations", "What are your compensation expectations for this role?", "textarea"),
      // InMobi, HackerRank, FamPay.
      field("where", "What is your present location ?", "text"),
      field("earliest", "When is the earliest you can join the 3-6-month Internship program?", "text"),
      field("years", "Please indicate your experience in number of years", "text"),
      // Tekion (Ashby's Yes/No buttons), Meesho.
      field("employee", 'Are you currently a Tekion employee? (If "yes" - please apply via Ashby\'s Internal Job Board)', "single", true, yesNo),
      field("based", "Are you based out of Bangalore ?", "single", true, yesNo),
    ];
    const saved = { ...answered, currentSalary: "3 LPA", expectedSalary: "6 LPA" };
    const { answers, missing } = answerForm(form, context({ company: "Tekion", saved, experienceMonths: 26, currentCompany: "Infosys" }));
    expect(answers).toMatchObject({
      present: { value: "3 LPA" },
      fixed: { value: "3 LPA" },
      fixedExpected: { value: "6 LPA" },
      range: { value: "6 LPA" },
      expectations: { value: "6 LPA" },
      where: { value: "Pune, India" },
      earliest: { value: "Immediately" },
      years: { value: "2" },
      employee: { label: "No" },
      based: { label: "No" },
    });
    expect(missing).toEqual([]);
  });

  it("says whether they're based in a city by the profile's, knowing its other names, and leaves the rest", () => {
    const ask = (label: string, city: string) => answerForm([field("q", label, "single", true, yesNo)], context({ basics: { ...context().basics, city } }));
    expect(ask("Are you based out of Bangalore ?", "Bengaluru").answers.q).toMatchObject({ label: "Yes" });
    expect(ask("Are you currently based in Mumbai/Bengaluru?", "Bangalore").answers.q).toMatchObject({ label: "Yes" });
    expect(ask("Are you based in Delhi NCR?", "Gurgaon").answers.q).toMatchObject({ label: "Yes" });
    expect(ask("Are you based in Delhi NCR?", "Pune").answers.q).toMatchObject({ label: "No" });
    expect(ask("Are you based out of Hyderabad?", "Pune").answers.q).toMatchObject({ label: "No" });
    // A state, or a city the profile doesn't give: the student answers.
    expect(ask("Are you based in Karnataka?", "Bengaluru").missing).toEqual(["Are you based in Karnataka?"]);
    expect(ask("Are you based out of Bangalore?", "").missing).toEqual(["Are you based out of Bangalore?"]);
  });

  it("still leaves commitments and the student's own work to them", () => {
    const form = [
      field("office", "Are you comfortable working 5 days from Bangalore office?", "single", true, yesNo),
      field("onsite", "Are you ok to work Onsite in Mumbai/Bengaluru?", "single", true, yesNo),
      field("hours", "This role requires working NAMER hours, 7:00pm to 4:00am IST. Are you able to commit to these hours on an ongoing basis?", "single", true, yesNo),
      field("saas", "How many years of experience do you have working with a SaaS firm?", "text"),
      field("pqe", "Total Post-Qualification Experience", "text"),
      field("which", "Which location are you applying for?", "text"),
      field("working", "Are you currently working?", "single", true, yesNo),
    ];
    const { answers, missing } = answerForm(form, context({ company: "Meesho", experienceMonths: 26, currentCompany: "Infosys" }));
    expect(answers).toEqual({});
    expect(missing).toHaveLength(form.length);
  });

  it("says yes to being a current employee only when the profile's current employer is the company", () => {
    const form = [field("q", "Are you currently a Tekion employee?", "single", true, yesNo)];
    expect(answerForm(form, context({ company: "Tekion", currentCompany: "Tekion Corp" })).answers.q).toMatchObject({ label: "Yes" });
    expect(answerForm(form, context({ company: "Tekion", currentCompany: undefined })).answers.q).toMatchObject({ label: "No" });
  });

  it("picks the place they're applying for from their cities, in their order (Paytm, found in the pilot)", () => {
    const places: FieldOption[] = [
      { label: "Noida, Uttar Pradesh", value: "noida" },
      { label: "Bangalore, Karnataka", value: "blr" },
    ];
    const ask = (cities: string[], type: FormField["type"] = "single", jobLocation = "Noida, Uttar Pradesh") =>
      answerForm([field("loc", "Which location are you applying for?", type, true, type === "text" ? [] : places)], context({ cities, jobLocation }));
    expect(ask(["Delhi", "Gurugram", "Noida", "Bengaluru"]).answers.loc).toEqual({ kind: "option", value: "noida", label: "Noida, Uttar Pradesh" });
    // Their order decides, and Bengaluru is Bangalore.
    expect(ask(["Bengaluru", "Noida"]).answers.loc).toMatchObject({ label: "Bangalore, Karnataka" });
    expect(ask(["Bengaluru"], "multi").answers.loc).toEqual({ kind: "options", values: ["blr"], labels: ["Bangalore, Karnataka"] });
    // None of theirs is offered, or they gave none: the student chooses.
    expect(ask(["Pune"]).missing).toEqual(["Which location are you applying for?"]);
    expect(ask([]).missing).toEqual(["Which location are you applying for?"]);
    // Written: the city of theirs the job is in.
    expect(ask(["Delhi", "Noida"], "text").answers.loc).toEqual({ kind: "text", value: "Noida" });
    expect(ask(["Pune"], "text").missing).toHaveLength(1);
  });

  it("answers working from the office from the student's own answer, only for a city they chose", () => {
    const saved = (onsiteOk: boolean | null) => ({ ...answered, onsiteOk });
    const form = [
      field("five", "Are you comfortable working 5 days from Bangalore office?", "single", true, yesNo),
      field("onsite", "Are you ok to work Onsite in Mumbai/Bengaluru?", "single", true, yesNo),
      field("role", "This is a full-time, in-office role in Bangalore, five days a week. No hybrid, no remote option. Are you able to commit to this?", "single", true, yesNo),
      field("anchor", "Are you able to commit to working from one of our offices on Anchor Days each week?", "single", true, yesNo),
    ];
    const yes = answerForm(form, context({ cities: ["Pune", "Bengaluru"], saved: saved(true) }));
    expect(yes.missing).toEqual([]);
    expect(Object.values(yes.answers).map((answer) => (answer as { label: string }).label)).toEqual(["Yes", "Yes", "Yes", "Yes"]);
    // A city they didn't choose is theirs to answer; a question naming none is answered.
    const elsewhere = answerForm(form, context({ cities: ["Pune"], saved: saved(true) }));
    expect(elsewhere.missing).toHaveLength(3);
    expect(elsewhere.answers.anchor).toMatchObject({ label: "Yes" });
    // A no is a no everywhere; no answer given leaves them all.
    expect(Object.values(answerForm(form, context({ cities: ["Bengaluru"], saved: saved(false) })).answers).map((answer) => (answer as { label: string }).label)).toEqual(["No", "No", "No", "No"]);
    expect(answerForm(form, context({ cities: ["Bengaluru"], saved: saved(null) })).missing).toHaveLength(4);
    // Not about the office: hours, or an interview in person.
    const others = [
      field("hours", "This role requires working NAMER hours, 7:00pm to 4:00am IST. Are you able to commit to these hours on an ongoing basis?", "single", true, yesNo),
      field("interview", "Are you available to attend an in-person interview if requested as part of the hiring process?", "single", true, yesNo),
      field("software", "Do you have experience working in Microsoft Office?", "single", true, yesNo),
    ];
    expect(answerForm(others, context({ cities: ["Bengaluru"], saved: saved(true) })).missing).toHaveLength(3);
  });

  it("gives the reason for change in the student's words, and 0 for the current salary of someone who has none", () => {
    const form = [
      field("why", "Please mention your reason for change.", "textarea"),
      field("why2", "Why are you looking for a change?", "text"),
      field("ctc", "What is your current CTC?", "text"),
    ];
    const { answers, missing } = answerForm(form, context({ saved: { ...answered, reasonForChange: "A larger product scope.", noCurrentSalary: true, currentSalary: "" } }));
    expect(answers).toMatchObject({ why: { value: "A larger product scope." }, why2: { value: "A larger product scope." }, ctc: { value: "0" } });
    expect(missing).toEqual([]);
    // Nothing given: nothing made up.
    expect(answerForm(form, context()).missing).toHaveLength(3);
  });

  it("lists the required answers still missing, in the page's order", () => {
    const search = { cities: ["Pune"], level: "entry" };
    expect(missingAnswers(EMPTY_ANSWERS, { cities: [], level: "entry" })).toEqual([
      "cities",
      "workAuthorized",
      "needsSponsorship",
      "relativesAtCompany",
      "backgroundCheckConsent",
      "acceptPrivacyNotices",
      "outsideActivities",
      "willingToRelocate",
      "onsiteOk",
      "adult",
      "employmentRestrictions",
      "governmentOfficial",
      "relativeOfGovernmentOfficial",
      "referredByEmployee",
      "noticePeriod",
      "currentSalary",
      "expectedSalary",
      "graduationYear",
    ]);
    const complete = { ...EMPTY_ANSWERS, workAuthorized: true, needsSponsorship: false, relativesAtCompany: false, backgroundCheckConsent: true, acceptPrivacyNotices: true, outsideActivities: false, willingToRelocate: true, onsiteOk: true, adult: true, employmentRestrictions: false, governmentOfficial: false, relativeOfGovernmentOfficial: false, referredByEmployee: false, noticePeriod: "30" as const, currentSalary: "4 LPA", expectedSalary: "6 LPA", graduationYear: "2024" };
    expect(missingAnswers(complete, search)).toEqual([]);
    // No salary now stands in for the current one; a year must be a year; experienced people give a reason for change.
    expect(missingAnswers({ ...complete, currentSalary: "", noCurrentSalary: true }, search)).toEqual([]);
    expect(missingAnswers({ ...complete, currentSalary: " " }, search)).toEqual(["currentSalary"]);
    expect(missingAnswers({ ...complete, graduationYear: "24" }, search)).toEqual(["graduationYear"]);
    expect(missingAnswers(complete, { cities: ["Pune"], level: "experienced" })).toEqual(["reasonForChange"]);
    expect(missingAnswers({ ...complete, reasonForChange: "Growth." }, { cities: ["Pune"], level: "experienced" })).toEqual([]);
    expect(missingAnswersMessage(["cities", "currentSalary", "noCurrentSalary"])).toBe("Answer these in Set up job search first: Cities, Current salary.");
    expect(missingAnswersMessage(["expectedSalary"])).toBe("Answer this in Set up job search first: Expected salary.");
    expect(missingAnswersMessage(missingAnswers(EMPTY_ANSWERS, { cities: [], level: "entry" }))).toBe("Answer these in Set up job search first: Cities, Allowed to work, Visa sponsorship, Relatives at the company and 14 more.");
  });

  it("answers a file question only with a file, and a written one never with a file", () => {
    const form = [field("portfolio", "Attach your portfolio", "file"), field("site", "Portfolio link", "text"), field("resume", "Resume/CV", "file")];
    const { answers, missing } = answerForm(form, context({ basics: { ...context().basics, website: "https://asha.dev" } }));
    expect(answers).toEqual({ site: { kind: "text", value: "https://asha.dev" }, resume: { kind: "file", file: "resume" } });
    expect(missing).toEqual(["Attach your portfolio"]);
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

describe("questions the student answers themself (apply task questions)", () => {
  const pytorch = field("q_ml", "Have you used PyTorch?", "single", true, yesNo);

  it("asks about what nothing covers, and names it among the required fields to answer", () => {
    const { missing } = answerForm([pytorch], context());
    expect(missing).toEqual(["Have you used PyTorch?"]);
    expect(missingFields([pytorch], missing)).toEqual([pytorch]);
  });

  it("fills it from the answer the student gave that wording before", () => {
    const saved: SavedAnswers = { ...answered, custom: { [customKey("Have you used PyTorch?")]: { label: "Have you used PyTorch?", options: ["Yes"] } } };
    const { answers, missing } = answerForm([pytorch], context({ saved }));
    expect(missing).toEqual([]);
    expect(answers.q_ml).toEqual({ kind: "option", value: "1", label: "Yes" });
  });

  it("keeps answers by wording (ignoring case and punctuation), and won't take on what's the student's own to do", () => {
    expect(customKey("Have you used PyTorch?")).toBe(customKey("have you used pytorch"));
    expect(askableHere({ label: "Why do you want to work here?", type: "textarea" })).toBe(true);
    expect(askableHere({ label: "Type your full name to sign", type: "text" })).toBe(false);
    expect(askableHere({ label: "What is your gender?", type: "single" })).toBe(false);
    expect(askableHere({ label: "Resume", type: "file" })).toBe(false);
  });
});
