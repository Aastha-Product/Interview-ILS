import { z } from "zod";

// Pathfinder (auto-apply step 4): answering an application form. Most forms ask the same few
// things beyond name, email and resume: notice period, work authorisation, sponsorship, relatives
// at the company, consent to a background check or to the employer's privacy notice. The student
// answers those once (SavedAnswers); this matches each form's questions to them by their wording
// and picks the matching option. Nothing is ever guessed: a required question it can't answer from
// the profile or the saved answers is returned as missing, and the application waits for the
// student. Shared by the server (Greenhouse publishes its forms) and, in step 5, the extension.

export const NOTICE_PERIODS = ["immediate", "15", "30", "60", "90"] as const;
export type NoticePeriod = (typeof NOTICE_PERIODS)[number];

const yesNo = z.boolean().nullable().default(null);

/** The student's own answers to the questions most forms ask; null means "not answered yet". */
export const savedAnswersSchema = z.object({
  /** Legally allowed to work where the job is. */
  workAuthorized: yesNo,
  needsSponsorship: yesNo,
  noticePeriod: z.enum(NOTICE_PERIODS).nullable().default(null),
  /** As the student writes it, e.g. "4.5 LPA"; empty when not given. */
  currentSalary: z.string().trim().max(100).default(""),
  expectedSalary: z.string().trim().max(100).default(""),
  /** A relative or close friend works at the company they apply to. */
  relativesAtCompany: yesNo,
  /** Agrees to employers' background verification. */
  backgroundCheckConsent: yesNo,
  /** Agrees to employers' privacy notices and data processing, which many forms require. */
  acceptPrivacyNotices: yesNo,
  /** Advisory, consulting or board roles besides their job. */
  outsideActivities: yesNo,
  willingToRelocate: yesNo,
  /** e.g. "2026"; empty to use the latest education's end year. */
  graduationYear: z.string().trim().max(4).default(""),
  /** 18 or older; null to work it out from the profile's date of birth. */
  adult: yesNo,
  /** Bound by a non-compete or similar restriction from a current or past employer. */
  employmentRestrictions: yesNo,
  /** A government or public official now, or in the last few years. */
  governmentOfficial: yesNo,
  /** A close relative of one. */
  relativeOfGovernmentOfficial: yesNo,
  /** Referred to the job by someone who works there; auto-apply's applications usually aren't. */
  referredByEmployee: yesNo,
});
export type SavedAnswers = z.output<typeof savedAnswersSchema>;

export const EMPTY_ANSWERS: SavedAnswers = savedAnswersSchema.parse({});

export type FieldType = "text" | "textarea" | "file" | "single" | "multi" | "hidden";
export type FieldOption = { label: string; value: string };

/** One question on a form, as the form names it. */
export type FormField = { key: string; label: string; required: boolean; type: FieldType; options: FieldOption[] };

export type Answer =
  | { kind: "text"; value: string }
  | { kind: "option"; value: string; label: string }
  | { kind: "options"; values: string[]; labels: string[] }
  | { kind: "file"; file: "resume" | "cover_letter" };

/** What the answers can draw on. */
export type AnswerContext = {
  basics: {
    name: string;
    email: string;
    phone: string;
    city: string;
    country: string;
    linkedin: string;
    website: string;
    /** As the profile has them; "" when not given. */
    address?: string;
    dob?: string;
  };
  /** Companies in the student's experience, to answer "have you worked for us before?". */
  pastEmployers: string[];
  /** The current role, else the latest; "" without experience. */
  currentCompany?: string;
  currentTitle?: string;
  /** The latest education's school; "" without one. */
  university?: string;
  /** The latest year an education entry ends, as text; "" without one. */
  graduationYear: string;
  /** The company the form is for. */
  company: string;
  saved: SavedAnswers;
};

export type FormAnswers = { answers: Record<string, Answer>; missing: string[] };

const normal = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** "Ada Lovelace King" → ["Ada Lovelace", "King"]; one word is the first name. */
export function splitName(name: string): [string, string] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [words[0] ?? "", ""];
  return [words.slice(0, -1).join(" "), words.at(-1)!];
}

const AFFIRM = /^(yes|y|i agree|i acknowledge|i consent|i accept|agree|acknowledged?|true|i do|i confirm)\b/;
const DENY = /^(no|n|false|i do not|i don t|none)\b/;
const DECLINE = /(decline|prefer not|don t wish|do not wish|not to (say|disclose|answer)|rather not)/;

/** The option that says yes (or no). */
function pick(options: FieldOption[], yes: boolean): FieldOption | undefined {
  return options.find((option) => (yes ? AFFIRM : DENY).test(normal(option.label)));
}

/** Days a notice-period option stands for: "Immediate" 0, "30 days" 30, "2 months" 60, "Less than 30 days" 29. */
function optionDays(label: string): number | null {
  const text = normal(label);
  if (/immediate|now|0 days/.test(text)) return 0;
  const days = text.match(/(\d+)\s*days?/);
  const months = text.match(/(\d+)\s*months?/);
  const base = days ? Number(days[1]) : months ? Number(months[1]) * 30 : null;
  if (base === null) return null;
  return /less than|under|within|below/.test(text) ? base - 1 : base;
}

const NOTICE_DAYS: Record<NoticePeriod, number> = { immediate: 0, "15": 15, "30": 30, "60": 60, "90": 90 };
const NOTICE_TEXT: Record<NoticePeriod, string> = { immediate: "Immediately", "15": "15 days", "30": "30 days", "60": "60 days", "90": "90 days" };

/** The notice-period option closest to the student's, preferring one not shorter than it. */
function pickNotice(options: FieldOption[], notice: NoticePeriod): FieldOption | undefined {
  const want = NOTICE_DAYS[notice];
  return options
    .map((option) => ({ option, days: optionDays(option.label) }))
    .filter((entry): entry is { option: FieldOption; days: number } => entry.days !== null)
    .sort((a, b) => Math.abs(a.days - want) - Math.abs(b.days - want) || Number(a.days < want) - Number(b.days < want))[0]?.option;
}

type Rule = { test: RegExp; answer: (field: FormField, context: AnswerContext) => Answer | null | "skip" };

/** A yes/no question answered by `value`; null when the student hasn't answered it. */
function yesNoAnswer(field: FormField, value: boolean | null): Answer | null {
  if (value === null) return null;
  if (field.type === "single") {
    const option = pick(field.options, value);
    return option ? { kind: "option", value: option.value, label: option.label } : null;
  }
  if (field.type === "multi") {
    // A checkbox to tick ("I acknowledge"). For a no there's nothing to tick: unanswered, so a
    // required one makes the application wait for the student rather than go in incomplete.
    if (!value) return null;
    const option = pick(field.options, true) ?? (field.options.length === 1 ? field.options[0] : undefined);
    return option ? { kind: "options", values: [option.value], labels: [option.label] } : null;
  }
  return { kind: "text", value: value ? "Yes" : "No" };
}

const text = (value: string): Answer | null => (value.trim() ? { kind: "text", value: value.trim() } : null);

function choose(field: FormField, preferred: RegExp, fallback: string): Answer | null {
  if (field.type === "single" || field.type === "multi") {
    const option = field.options.find((entry) => preferred.test(normal(entry.label)));
    if (!option) return null;
    return field.type === "single" ? { kind: "option", value: option.value, label: option.label } : { kind: "options", values: [option.value], labels: [option.label] };
  }
  return text(fallback);
}

/** A company's name without legal words: "Infosys Limited" and "Infosys Ltd." are both "infosys". */
export function companyCore(name: string): string {
  return normal(name)
    .replace(/\b(private|pvt|limited|ltd|inc|incorporated|llc|llp|corp|corporation|co|company|plc|gmbh|sa|bv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const workedThere = (context: AnswerContext) => {
  const company = companyCore(context.company);
  return company !== "" && context.pastEmployers.some((employer) => {
    const past = companyCore(employer);
    return past !== "" && (past === company || past.startsWith(`${company} `) || company.startsWith(`${past} `));
  });
};

/** Whether a question is about the company itself: it names it, or says "us", "our" or "subsidiaries". */
function aboutThisCompany(label: string, company: string): boolean {
  const text = normal(label);
  const name = companyCore(company);
  return (name !== "" && text.includes(name)) || /\b(us|our|this company|subsidiar(y|ies)|affiliates?|group companies)\b/.test(text);
}

/** 18 or older by a date of birth ("2004-05-17", "17/05/2004"); null when it can't tell. */
export function adultBy(dob: string | undefined, now = new Date()): boolean | null {
  const text = (dob ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : [NaN, NaN, NaN];
  if (!year || !month || !day) return null;
  const eighteenth = Date.UTC(year + 18, month - 1, day);
  return now.getTime() >= eighteenth;
}

/** An option whose label names `country` ("India"), or the country as text. */
function countryAnswer(field: FormField, country: string): Answer | null {
  if (!country.trim()) return null;
  const name = normal(country).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return choose(field, new RegExp(`\\b${name}\\b`), country);
}

/** Opting out of marketing messages: the "no" option, or nothing ticked on a checkbox. */
function optOut(field: FormField): Answer | null | "skip" {
  if (field.type === "single") {
    const option = pick(field.options, false);
    return option ? { kind: "option", value: option.value, label: option.label } : null;
  }
  if (field.type === "multi") return field.required ? null : "skip";
  return { kind: "text", value: "No" };
}

// Things a person must do themselves: sign or agree to a legal document, or waive a right. Never
// answered, even when optional, so a form that asks waits for the student.
const NEVER = /\b(arbitration|nda|non disclosure agreement|waive|waiver|e ?signature|signature|sign (here|below|this)|(type|typing|enter) your (full |legal )?name)\b/;

// Order matters: the first rule whose wording matches answers the question.
const RULES: Rule[] = [
  { test: NEVER, answer: () => null },
  // Follow-ups ("If yes, please describe") only matter after a yes, which auto-apply never gives to those questions.
  { test: /^if (yes|so)\b/, answer: (field) => (field.required ? text("N/A") : "skip") },
  { test: /preferred (first )?name|what should we call you|nick ?name/, answer: (_field, c) => text(splitName(c.basics.name)[0]) },
  // Before the questions about relatives and past employers, whose wording these share.
  {
    test: /(government|public) (official|employee)|politically exposed/,
    answer: (field, c) => yesNoAnswer(field, /relative|family|spouse|partner|child|parent|sibling/.test(normal(field.label)) ? c.saved.relativeOfGovernmentOfficial : c.saved.governmentOfficial),
  },
  { test: /employment agreement|post employment|restrictive covenant|non compete|non solicit|restrictions? (with|from) (your|a) (current|previous|past|former)/, answer: (field, c) => yesNoAnswer(field, c.saved.employmentRestrictions) },
  { test: /\b(gender|race|ethnic|veteran|disabilit|sexual orientation|pronoun|transgender|caste)/, answer: (field) => choose(field, DECLINE, "") ?? (field.required ? null : "skip") },
  { test: /(authori[sz]ed|eligible|legally|right) to work|work (permit|authori[sz]ation)/, answer: (field, c) => yesNoAnswer(field, c.saved.workAuthorized) },
  { test: /sponsor/, answer: (field, c) => yesNoAnswer(field, c.saved.needsSponsorship) },
  {
    test: /notice period|when can you (join|start)|earliest (start|joining|date)|joining time/,
    answer: (field, c) => {
      const notice = c.saved.noticePeriod;
      if (!notice) return null;
      if (field.type === "single") {
        const option = pickNotice(field.options, notice);
        return option ? { kind: "option", value: option.value, label: option.label } : null;
      }
      return text(NOTICE_TEXT[notice]);
    },
  },
  { test: /(relative|family member|related to|personal relationship|friend)s?\b.*\b(work|employ|company|relationship)/, answer: (field, c) => yesNoAnswer(field, c.saved.relativesAtCompany) },
  {
    test: /(previously|ever|in the past|before|former).*(employ|work)|(employ|work)\w*.*(before|previously|in the past)|former employee|ex employee/,
    // Only about this company: "Have you worked with React before?" isn't.
    answer: (field, c) => (aboutThisCompany(field.label, c.company) ? yesNoAnswer(field, workedThere(c)) : null),
  },
  { test: /background (verification|check|screening)/, answer: (field, c) => yesNoAnswer(field, c.saved.backgroundCheckConsent) },
  { test: /privacy|personal data|data protection|gdpr|process(ing)? (of )?my (personal )?data|consent .*data|candidate data/, answer: (field, c) => yesNoAnswer(field, c.saved.acceptPrivacyNotices) },
  // "Do you understand that we may use AI tools to review applications?" is a notice like a privacy one.
  { test: /\bai\b.{0,40}(assist|evaluat|review|process|screen)|ai disclaimer/, answer: (field, c) => yesNoAnswer(field, c.saved.acceptPrivacyNotices) },
  { test: /outside (business|activit|employment)|advisory|consulting|board (role|member|seat)/, answer: (field, c) => yesNoAnswer(field, c.saved.outsideActivities) },
  { test: /(18|eighteen) years|at least 18|over 18|legal (working )?age/, answer: (field, c) => yesNoAnswer(field, c.saved.adult ?? adultBy(c.basics.dob)) },
  { test: /whatsapp|\bsms\b|text messages?|marketing|newsletter|opt ?in|job alerts|talent (community|network)/, answer: (field) => optOut(field) },
  { test: /how (should|would you like|do you prefer|can) (we|to be|you be) (communicat|contact)|preferred (method|mode|way) of (communication|contact)/, answer: (field) => choose(field, /e ?mail/, "Email") },
  { test: /relocat/, answer: (field, c) => yesNoAnswer(field, c.saved.willingToRelocate) },
  { test: /current (ctc|salary|compensation|pay|package)/, answer: (_field, c) => text(c.saved.currentSalary) },
  { test: /expected (ctc|salary|compensation|pay|package)|salary expectation/, answer: (_field, c) => text(c.saved.expectedSalary) },
  { test: /graduat(e|ion) (year|date)|year of (passing|graduation)|passing year/, answer: (_field, c) => text(c.saved.graduationYear || c.graduationYear) },
  { test: /how did you (hear|find|learn)|where did you (hear|find)|referral source|source of application/, answer: (field) => choose(field, /job board|job site|website|career|online|internet|other/, "Job board") },
  { test: /\breferred\b|\breferral\b/, answer: (field, c) => yesNoAnswer(field, c.saved.referredByEmployee) },
  { test: /linkedin/, answer: (_field, c) => text(c.basics.linkedin) },
  { test: /website|portfolio|personal (site|page)/, answer: (_field, c) => text(c.basics.website) },
  {
    test: /(current|previous|recent|present|most recent|last) (company|employer|organi[sz]ation)|name of your (current )?(employer|company)|who is your (current )?(or previous )?employer/,
    answer: (_field, c) => text(c.currentCompany ?? ""),
  },
  { test: /(current|previous|recent|present|most recent|last) (job )?(title|designation|role|position)/, answer: (_field, c) => text(c.currentTitle ?? "") },
  { test: /(home|residential|permanent|current|postal|mailing) address|^address\b/, answer: (_field, c) => text(c.basics.address ?? "") },
  { test: /countr(y|ies) .*(anticipate|expect|plan|intend|like) .*work|which countr(y|ies)/, answer: (field, c) => countryAnswer(field, c.basics.country) },
  { test: /countr(y|ies) .*(resid|live|based)|(resid|live|based) .*countr(y|ies)|country of residence/, answer: (field, c) => countryAnswer(field, c.basics.country) },
  { test: /^(current )?(location|city)\b|where are you (based|located)|current city|(city|state) .*(resid|live)|primary residence/, answer: (_field, c) => text([c.basics.city, c.basics.country].filter(Boolean).join(", ")) },
  { test: /^(name of (your )?)?(university|college|institution)( name)?$|which (university|college)|university attended|college name/, answer: (_field, c) => text(c.university ?? "") },
];

/** The answer for a standard field, by the name every system uses for it. */
function standard(field: FormField, context: AnswerContext): Answer | null | undefined {
  const [first, last] = splitName(context.basics.name);
  switch (field.key) {
    case "first_name":
      return text(first);
    case "last_name":
      return text(last);
    case "name":
    case "full_name":
      return text(context.basics.name);
    case "email":
      return text(context.basics.email);
    case "phone":
      return text(context.basics.phone);
    case "resume":
      return { kind: "file", file: "resume" };
    case "cover_letter":
      return { kind: "file", file: "cover_letter" };
    default:
      return undefined;
  }
}

/** Answers a form's questions; `missing` lists the required ones it couldn't. */
export function answerForm(fields: readonly FormField[], context: AnswerContext): FormAnswers {
  const answers: Record<string, Answer> = {};
  const missing: string[] = [];
  for (const field of fields) {
    // The form fills these itself (a location's coordinates).
    if (field.type === "hidden") continue;
    let answer = standard(field, context);
    if (answer === undefined) {
      const label = normal(field.label);
      const rule = RULES.find((entry) => entry.test.test(label));
      const result = rule ? rule.answer(field, context) : null;
      if (result === "skip") continue;
      answer = result;
    }
    if (answer) answers[field.key] = answer;
    else if (field.required) missing.push(field.label.trim() || field.key);
  }
  return { answers, missing };
}
