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
  /** No salary now (a fresher, or between jobs): forms asking the current one get "0". */
  noCurrentSalary: z.boolean().default(false),
  /** Willing to work from the office every working day, in a city they chose. */
  onsiteOk: yesNo,
  /** Why they're looking for a change, in their own words; asked of people who have worked. */
  reasonForChange: z.string().trim().max(1000).default(""),
  /**
   * Answers the student gave on the Auto-apply page to questions a form asked that nothing above
   * covers ("Have you used PyTorch?"), by the question's wording (customKey). A later form asking
   * the same thing in the same words gets the same answer.
   */
  custom: z
    .record(
      z.string().max(300),
      z.object({
        /** The question as the form worded it. */
        label: z.string().max(500),
        /** A written answer. */
        text: z.string().max(2000).optional(),
        /** The options chosen, by their words. */
        options: z.array(z.string().max(500)).max(50).optional(),
      }),
    )
    .default({}),
});
export type SavedAnswers = z.output<typeof savedAnswersSchema>;

export const EMPTY_ANSWERS: SavedAnswers = savedAnswersSchema.parse({});

// What Set up job search requires before auto-apply starts (the owner's decision, 11 November
// 2026, after the pilot: applications kept stopping at questions nearly every form asks). Each is
// starred on the page, and auto-apply stays off until all are given.

/** A required answer: a saved answer, or the cities in what the student is looking for. */
export type RequiredAnswer = Exclude<keyof SavedAnswers, "custom"> | "cities";

/** What each is called in "Answer these first: …". */
export const ANSWER_NAMES: Record<RequiredAnswer, string> = {
  cities: "Cities",
  workAuthorized: "Allowed to work",
  needsSponsorship: "Visa sponsorship",
  relativesAtCompany: "Relatives at the company",
  backgroundCheckConsent: "Background verification",
  acceptPrivacyNotices: "Employers' privacy notices",
  outsideActivities: "Outside roles",
  willingToRelocate: "Willing to relocate",
  onsiteOk: "Working from the office",
  adult: "18 or older",
  employmentRestrictions: "Non-compete",
  governmentOfficial: "Government official",
  relativeOfGovernmentOfficial: "Relative of a government official",
  referredByEmployee: "Referred by an employee",
  noticePeriod: "Notice period",
  currentSalary: "Current salary",
  noCurrentSalary: "Current salary",
  expectedSalary: "Expected salary",
  graduationYear: "Graduation year",
  reasonForChange: "Reason for change",
};

const REQUIRED_YES_NO = [
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
] as const satisfies readonly (keyof SavedAnswers)[];

/**
 * The required answers still missing, in the page's order. The current salary isn't needed from
 * someone who has none, nor a reason for change from someone looking for their first job
 * (intern or entry level).
 */
export function missingAnswers(saved: SavedAnswers, search: { cities: readonly string[]; level: string }): RequiredAnswer[] {
  const missing: RequiredAnswer[] = [];
  if (search.cities.every((city) => !city.trim())) missing.push("cities");
  for (const key of REQUIRED_YES_NO) if (saved[key] === null) missing.push(key);
  if (saved.noticePeriod === null) missing.push("noticePeriod");
  if (!saved.noCurrentSalary && !saved.currentSalary.trim()) missing.push("currentSalary");
  if (!saved.expectedSalary.trim()) missing.push("expectedSalary");
  if (!/^(19|20)\d{2}$/.test(saved.graduationYear)) missing.push("graduationYear");
  if (search.level === "experienced" && !saved.reasonForChange.trim()) missing.push("reasonForChange");
  return missing;
}

/** "Answer these in Set up job search first: Cities, Expected salary and 2 more." */
export function missingAnswersMessage(missing: readonly RequiredAnswer[]): string {
  const names = [...new Set(missing.map((key) => ANSWER_NAMES[key]))];
  const shown = names.slice(0, 4).join(", ");
  return `Answer ${names.length === 1 ? "this" : "these"} in Set up job search first: ${shown}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.`;
}

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
  /** Months of work experience, overlaps counted once; and the same without internships. */
  experienceMonths?: number;
  experienceMonthsWithoutInternships?: number;
  /** The latest year an education entry ends, as text; "" without one. */
  graduationYear: string;
  /** The company the form is for. */
  company: string;
  /** Where the job is, as its posting says: "Noida, Uttar Pradesh". */
  jobLocation?: string;
  /** The cities the student is looking in, most preferred first (Set up job search). */
  cities?: readonly string[];
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

// How options say yes or no, as real forms word them: "Yes", "I have read and consent to the
// Privacy Notice.", "No", "I have never been employed by Rubrik…".
const AFFIRM = /^(yes|y|i agree|agree|i acknowledge|acknowledged?|i consent|consent|i accept|accept|i have read|i understand|i confirm|confirm|true|i do|ok|okay)\b/;
const DENY = /^(no|n|false|none|never|not|i do not|i don t|i have not|i haven t|i have never|i am not|i m not|i was not|i never)\b/;
const DECLINE = /(decline|prefer not|don t wish|do not wish|not to (say|disclose|answer)|rather not)/;

/** The option that says yes (or no). */
function pick(options: FieldOption[], yes: boolean): FieldOption | undefined {
  return options.find((option) => {
    const label = normal(option.label);
    // "I have read and do not consent" says no, whatever it starts with.
    return yes ? AFFIRM.test(label) && !/\b(not|never|don t|do not)\b/.test(label) : DENY.test(label);
  });
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

/** Whether the student works at the company now: their current employer is it. */
const worksThere = (context: AnswerContext) => {
  const company = companyCore(context.company);
  const current = companyCore(context.currentCompany ?? "");
  return company !== "" && current !== "" && (current === company || current.startsWith(`${company} `) || company.startsWith(`${current} `));
};

// Cities as forms name them, each with its other names (found on live forms on 11 November 2026:
// Meesho's "Are you based out of Bangalore?"). Delhi NCR takes in the cities around Delhi.
const CITIES: readonly (readonly string[])[] = [
  ["bengaluru", "bangalore"],
  ["mumbai", "bombay", "navi mumbai", "thane"],
  ["gurugram", "gurgaon"],
  ["delhi", "new delhi"],
  ["noida", "greater noida"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["hyderabad", "secunderabad"],
  ["pune"],
  ["ahmedabad"],
  ["jaipur"],
  ["kochi", "cochin"],
  ["chandigarh"],
  ["indore"],
  ["coimbatore"],
  ["thiruvananthapuram", "trivandrum"],
  ["mysuru", "mysore"],
  ["visakhapatnam", "vizag"],
  ["lucknow"],
  ["bhubaneswar"],
  ["nagpur"],
];
const NCR = new Set(["delhi", "new delhi", "gurugram", "gurgaon", "noida", "greater noida", "faridabad", "ghaziabad"]);
const cityGroups = (text: string) => CITIES.filter((names) => names.some((name) => new RegExp(`\\b${name}\\b`).test(text)));

/**
 * "Are you based out of Bangalore?": yes or no from the profile's city, only when the question
 * names a city this knows and the profile has one. A state, a region or a city it doesn't know is
 * left to the student, as is any question about being willing to be somewhere.
 */
function basedIn(field: FormField, context: AnswerContext): Answer | null {
  const label = normal(field.label);
  const city = normal(context.basics.city);
  const own = cityGroups(city);
  if (!city || own.length === 0) return null;
  if (/\bncr\b/.test(label)) return yesNoAnswer(field, NCR.has(city));
  const asked = cityGroups(label);
  if (asked.length === 0) return null;
  return yesNoAnswer(field, asked.some((names) => own.includes(names)));
}

/** Whether `text` (normalised) names `city`, by any of the names this knows for it. */
function namesCity(text: string, city: string): boolean {
  const wanted = normal(city);
  if (!wanted) return false;
  const groups = cityGroups(wanted);
  if (groups.length > 0) return groups.some((names) => names.some((name) => new RegExp(`\\b${name}\\b`).test(text)));
  return new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

/**
 * "Which location are you applying for?" (Paytm, found in the pilot): of the places the form
 * offers, the first that's among the student's cities, in their order. Written, the city of
 * theirs the job is in. Nothing when none of theirs fits: the student chooses.
 */
function applyingLocation(field: FormField, context: AnswerContext): Answer | null {
  const cities = (context.cities ?? []).filter((city) => city.trim());
  if (field.type === "single" || field.type === "multi") {
    for (const city of cities) {
      const option = field.options.find((entry) => namesCity(normal(entry.label), city));
      if (option) return field.type === "single" ? { kind: "option", value: option.value, label: option.label } : { kind: "options", values: [option.value], labels: [option.label] };
    }
    return null;
  }
  const here = cities.find((city) => namesCity(normal(context.jobLocation ?? ""), city));
  return here ? text(here) : null;
}

/**
 * "Are you comfortable working 5 days from our Bangalore office?": the student's answer to
 * working from the office. A yes only where the question names no city, or one of theirs; a city
 * they didn't choose is left to them.
 */
function onsite(field: FormField, context: AnswerContext): Answer | null {
  const willing = context.saved.onsiteOk;
  // "Experience working in Microsoft Office?" is about the software.
  if (/\b(ms|microsoft|google|open|libre) ?office\b|\boffice (suite|365|tools|software|applications)\b/.test(normal(field.label))) return null;
  if (willing === null) return null;
  if (!willing) return yesNoAnswer(field, false);
  const label = normal(field.label);
  const mine = [...(context.cities ?? []), context.basics.city].filter((city) => city.trim());
  const asksNcr = /\bncr\b/.test(label);
  if (cityGroups(label).length === 0 && !asksNcr) return yesNoAnswer(field, true);
  const fits = mine.some((city) => namesCity(label, city) || (asksNcr && NCR.has(normal(city))));
  return fits ? yesNoAnswer(field, true) : null;
}

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

/** The years an option stands for: "0-2 years" [0, 2], "16 or more years" [16, ∞], "Less than 1 year" [0, 0]. */
function optionYears(label: string): [number, number] | null {
  // The raw text: "+" and "-" carry the meaning here.
  const text = label.toLowerCase();
  let match = text.match(/(\d+)\s*(?:\+|or more|and above|plus)/);
  if (match) return [Number(match[1]), Infinity];
  match = text.match(/(?:less than|under|below|<)\s*(\d+)/);
  if (match) return [0, Math.max(0, Number(match[1]) - 1)];
  match = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
  if (match) return [Number(match[1]), Number(match[2])];
  if (/fresher|no experience|^\s*none/.test(text)) return [0, 0];
  match = text.match(/^\s*(\d+)\s*(?:years?|yrs?)?\s*$/);
  return match ? [Number(match[1]), Number(match[1])] : null;
}

/** Years of experience as the field wants it: the option whose range holds them, or the number. */
function yearsAnswer(field: FormField, months: number | undefined): Answer | null {
  if (months === undefined) return null;
  const years = Math.floor(months / 12);
  if (field.type === "single") {
    const option = field.options.find((entry) => {
      const range = optionYears(entry.label);
      return range !== null && years >= range[0] && years <= range[1];
    });
    return option ? { kind: "option", value: option.value, label: option.label } : null;
  }
  if (field.type === "multi") return null;
  return { kind: "text", value: String(years) };
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
// Questions about who the student is (gender, caste, disability): declined where the form lets
// them, never asked on the Auto-apply page and never kept, so nothing that sensitive is stored.
const DEMOGRAPHIC = /\b(gender|sex\b|race|ethnic|veteran|disabilit|sexual orientation|pronoun|transgender|caste)/;

const NEVER = /\b(arbitration|nda|non disclosure agreement|waive|waiver|e ?signature|signature|sign (here|below|this)|(type|typing|enter) your (full |legal )?name)\b/;

// Order matters: the first rule whose wording matches answers the question.
const RULES: Rule[] = [
  { test: NEVER, answer: () => null },
  // Follow-ups ("If yes, please describe") only matter after a yes, which auto-apply never gives to those questions.
  { test: /^if (yes|so|you (selected|answered|chose|ticked|checked))\b/, answer: (field) => (field.required ? text("N/A") : "skip") },
  { test: /preferred (first )?name|what should we call you|nick ?name/, answer: (_field, c) => text(splitName(c.basics.name)[0]) },
  // Before the questions about relatives and past employers, whose wording these share.
  {
    test: /(government|public) (official|employee)|politically exposed/,
    answer: (field, c) => yesNoAnswer(field, /relative|family|spouse|partner|child|parent|sibling/.test(normal(field.label)) ? c.saved.relativeOfGovernmentOfficial : c.saved.governmentOfficial),
  },
  { test: /employment agreement|post employment|restrictive covenant|non compete|non solicit|restrictions? (with|from) (your|a) (current|previous|past|former)/, answer: (field, c) => yesNoAnswer(field, c.saved.employmentRestrictions) },
  { test: DEMOGRAPHIC, answer: (field) => choose(field, DECLINE, "") ?? (field.required ? null : "skip") },
  { test: /(authori[sz]ed|eligible|legally|right) to work|work (permit|authori[sz]ation)/, answer: (field, c) => yesNoAnswer(field, c.saved.workAuthorized) },
  { test: /sponsor/, answer: (field, c) => yesNoAnswer(field, c.saved.needsSponsorship) },
  {
    test: /notice period|(when|how soon) can you (join|start)|available to (join|start)|earliest (start|joining|date)|earliest\b.{0,20}\byou can (join|start)|joining (time|date)|date of joining/,
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
  // "Are you currently a Tekion employee?": from the current employer (found on live forms).
  {
    test: /(currently|presently|now) (an? )?(\w+ )?(employee|employed|working)|(existing|current) employee/,
    answer: (field, c) => (aboutThisCompany(field.label, c.company) ? yesNoAnswer(field, worksThere(c)) : null),
  },
  { test: /(relative|family member|related to|personal relationship|friend)s?\b.*\b(work|employ|company|relationship)/, answer: (field, c) => yesNoAnswer(field, c.saved.relativesAtCompany) },
  {
    test: /(previously|ever|in the past|before|former).*(employ|work)|(employ|work)\w*.*(before|previously|in the past)|former employee|ex employee/,
    // Only about this company: "Have you worked with React before?" isn't.
    answer: (field, c) => (aboutThisCompany(field.label, c.company) ? yesNoAnswer(field, workedThere(c)) : null),
  },
  { test: /background (verification|check|screening)/, answer: (field, c) => yesNoAnswer(field, c.saved.backgroundCheckConsent) },
  { test: /privacy|personal data|data protection|gdpr|process(ing)? (of )?my (personal )?data|consent .*data|candidate data/, answer: (field, c) => yesNoAnswer(field, c.saved.acceptPrivacyNotices) },
  // "By checking this box, I confirm I have read, reviewed and understood the guidelines": a notice, like a privacy one.
  { test: /(have )?read,? (reviewed,? )?and understood|i (confirm|acknowledge) (that )?i have read/, answer: (field, c) => yesNoAnswer(field, c.saved.acceptPrivacyNotices) },
  // "Do you understand that we may use AI tools to review applications?" is a notice like a privacy one.
  { test: /\bai\b.{0,40}(assist|evaluat|review|process|screen)|ai disclaimer/, answer: (field, c) => yesNoAnswer(field, c.saved.acceptPrivacyNotices) },
  { test: /outside (business|activit|employment)|advisory|consulting|board (role|member|seat)/, answer: (field, c) => yesNoAnswer(field, c.saved.outsideActivities) },
  { test: /(18|eighteen) years|at least 18|over 18|legal (working )?age/, answer: (field, c) => yesNoAnswer(field, c.saved.adult ?? adultBy(c.basics.dob)) },
  { test: /whatsapp|\bsms\b|text messages?|marketing|newsletter|opt ?in|job alerts|talent (community|network)/, answer: (field) => optOut(field) },
  { test: /how (should|would you like|do you prefer|can) (we|to be|you be) (communicat|contact)|preferred (method|mode|way) of (communication|contact)/, answer: (field) => choose(field, /e ?mail/, "Email") },
  { test: /relocat/, answer: (field, c) => yesNoAnswer(field, c.saved.willingToRelocate) },
  // "present CTC", "current fixed CTC", "range of salary you seeking", "compensation expectations"
  // (found on live forms on 11 November 2026).
  { test: /(current|present) (fixed |annual |total |gross )?(ctc|salary|compensation|pay|package)/, answer: (_field, c) => text(c.saved.noCurrentSalary ? "0" : c.saved.currentSalary) },
  {
    test: /expected (fixed |annual |total |gross )?(ctc|salary|compensation|pay|package)|(salary|compensation|ctc) expectations?|range of (salary|compensation|ctc)|(salary|compensation|ctc) (range )?you (are )?(seeking|looking for)/,
    answer: (_field, c) => text(c.saved.expectedSalary),
  },
  { test: /graduat(e|ion) (year|date)|year of (passing|graduation)|passing year/, answer: (_field, c) => text(c.saved.graduationYear || c.graduationYear) },
  // "How did you get to know about this role?" is Meesho's wording (found in the Chrome tests).
  { test: /how did you (hear|find|learn|get to know|come to know|come across)|where did you (hear|find)|referral source|source of application/, answer: (field) => choose(field, /job board|job site|website|career|online|internet|other/, "Job board") },
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
  // Also the question worded just "Country" (Greenhouse's own field): where the student is. Not
  // citizenship or nationality, which are asked in those words and left to the student.
  { test: /countr(y|ies) .*(resid|live|based)|(resid|live|based) .*countr(y|ies)|country of residence|^(current |your )?country( region| or region)?$/, answer: (field, c) => countryAnswer(field, c.basics.country) },
  // "Please mention your reason for change." (Paytm), in the student's own words.
  {
    test: /reason (for|of) (the |a |your |job )?(change|leaving|switch|looking|moving)|why (are|do) you (looking|want|wish|planning|seeking) (for |to )?(a |an )?(job )?(change|switch|leave|move|new)|why .*leav(e|ing) your (current|present|last)/,
    answer: (_field, c) => text(c.saved.reasonForChange),
  },
  // Before where they are: the place they're applying for, working from the office, a yes or no about one city.
  {
    test: /which (location|city|office)\b.*\b(apply|applying|applied|prefer|interested|like)|(preferred|desired) (job |work |office )?location|location preference|location (you are|are you) applying/,
    answer: (field, c) => applyingLocation(field, c),
  },
  {
    // "working 5 days from Bangalore office", "work Onsite in Mumbai", "in-office role", "from one of our offices".
    test: /\bwork(ing)?\b[^?]{0,50}?\b(from|out of|in|at)\b[^?]{0,50}?\boffices?\b|\bon ?site\b|\bin office\b|\bwfo\b/,
    answer: (field, c) => onsite(field, c),
  },
  { test: /^(are|do) you (currently |presently )?(based|located|living|residing|reside|live|stay|staying) (out of|in|at|near)\b/, answer: (field, c) => basedIn(field, c) },
  {
    test: /^(current |present )?(location|city)\b|where are you (currently )?(based|located)|(current|present) (city|location)|currently (located|based)|(city|state) .*(resid|live)|primary residence|(from )?where do you (intend|plan) to work|preferred (work )?location/,
    answer: (_field, c) => text([c.basics.city, c.basics.country].filter(Boolean).join(", ")),
  },
  {
    // Only the whole of it: "years of experience in disaster response" is about one thing.
    // "Please indicate your experience in number of years" too (found on live forms).
    test: /\btotal (years of )?(work |professional )?experience|overall (work |professional )?experience|total years|your (total |overall )?(work |professional )?experience in (number of )?years/,
    answer: (field, c) => yearsAnswer(field, /excluding intern|without intern|not including intern/.test(normal(field.label)) ? c.experienceMonthsWithoutInternships : c.experienceMonths),
  },
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
      return byWording(field, context);
  }
}

// The same fields on forms that name them otherwise (Ashby's _systemfield_email, a uuid for the
// phone): by their exact wording, so "Name as per Aadhaar card" is still the student's to answer.
const ASHBY_FIELDS: Record<string, string> = { _systemfield_name: "name", _systemfield_email: "email", _systemfield_phone: "phone", _systemfield_resume: "resume" };
const WORDINGS: [RegExp, string][] = [
  [/^(full |your |legal )?name$/, "name"],
  [/^(your )?first name$/, "first_name"],
  [/^(your )?(last|sur|family) ?name$/, "last_name"],
  [/^(your )?e ?mail( address| id)?$/, "email"],
  [/^(your )?(phone|mobile|contact|telephone|cell)( phone)?( number| no)?$/, "phone"],
  [/^(resume|cv|resume cv|cv resume)$/, "resume"],
];

function byWording(field: FormField, context: AnswerContext): Answer | undefined {
  if (field.type !== "text" && field.type !== "file") return undefined;
  const label = normal(field.label);
  const key = ASHBY_FIELDS[field.key] ?? WORDINGS.find(([wording]) => wording.test(label))?.[1];
  if (!key || (key === "resume") !== (field.type === "file")) return undefined;
  return standard({ ...field, key }, context) ?? undefined;
}

/** The key a question's answer is kept under: its wording, without case, accents or punctuation. */
export const customKey = (label: string) => normal(label).slice(0, 300);

/**
 * Whether a question can be answered on the Auto-apply page: one to write or choose. Not a file,
 * a signature or legal agreement, or a question about who the student is: those are theirs to
 * do on the job site itself.
 */
export function askableHere(field: Pick<FormField, "label" | "type">): boolean {
  if (field.type !== "text" && field.type !== "textarea" && field.type !== "single" && field.type !== "multi") return false;
  const label = normal(field.label);
  return label !== "" && !NEVER.test(label) && !DEMOGRAPHIC.test(label);
}

/** The student's own answer to this question, given on the Auto-apply page; null without one that fits the form. */
function custom(field: FormField, context: AnswerContext): Answer | null {
  if (!askableHere(field)) return null;
  const given = context.saved.custom?.[customKey(field.label)];
  if (!given) return null;
  const chosen = (given.options ?? (given.text ? [given.text] : [])).map(normal);
  if (field.type === "single") {
    const option = field.options.find((entry) => chosen[0] !== undefined && normal(entry.label) === chosen[0]);
    return option ? { kind: "option", value: option.value, label: option.label } : null;
  }
  if (field.type === "multi") {
    const options = field.options.filter((entry) => chosen.includes(normal(entry.label)));
    return options.length > 0 ? { kind: "options", values: options.map((entry) => entry.value), labels: options.map((entry) => entry.label) } : null;
  }
  return text(given.text ?? (given.options ?? []).join(", "));
}

/** The required fields `missing` names: what the student is asked on the Auto-apply page. */
export function missingFields(fields: readonly FormField[], missing: readonly string[]): FormField[] {
  return fields.filter((field) => field.required && field.type !== "hidden" && missing.includes(field.label.trim() || field.key));
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
    // What the profile and the saved answers don't cover, the student may have answered themself.
    answer ??= custom(field, context);
    // A file is only ever answered with a file: "Attach your portfolio" isn't the website's address.
    if (answer && (field.type === "file") !== (answer.kind === "file")) answer = null;
    if (answer) answers[field.key] = answer;
    else if (field.required) missing.push(field.label.trim() || field.key);
  }
  return { answers, missing };
}
