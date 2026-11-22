// Phase 5 (public pages): the ATS checker. A resume's text, and optionally a job description,
// checked against what applicant tracking systems and recruiters' searches look for: contact
// details, standard sections, length, measurable results, action verbs, dates, readability and
// the job's keywords. Plain rules, no AI, and it runs in the visitor's browser: the resume never
// leaves their device. The score is a guide to what to fix, not a promise of what an ATS does.

export type AtsStatus = "pass" | "improve" | "fix";

export type AtsCheck = {
  id: "contact" | "sections" | "length" | "impact" | "verbs" | "dates" | "readability" | "keywords";
  title: string;
  status: AtsStatus;
  /** Points earned and possible. */
  points: number;
  max: number;
  /** What was found, in plain words. */
  detail: string;
  /** What to do about it, when there's something to do. */
  tip: string | null;
};

export type AtsResult = {
  /** Out of 100. */
  score: number;
  label: "Strong" | "Good" | "Needs work" | "Weak";
  checks: AtsCheck[];
  words: number;
  /** The job's keywords the resume has and lacks, when a job description was given. */
  keywords: { found: string[]; missing: string[] } | null;
};

/** Below this, there isn't a resume to check. */
export const ATS_MIN_WORDS = 60;
/** The most text read: longer is cut. */
export const ATS_MAX_CHARACTERS = 30_000;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\s-]?){10,13}/;
const LINK = /(linkedin\.com\/in\/|github\.com\/|https?:\/\/|\bwww\.)/i;

const SECTIONS: { name: string; heading: RegExp }[] = [
  { name: "Experience", heading: /^(work |professional |relevant )?(experience|employment( history)?|work history|internships?)\b/i },
  { name: "Education", heading: /^(education|academic( background| qualifications)?|qualifications)\b/i },
  { name: "Skills", heading: /^((technical |key |core )?skills|technologies|tech stack|tools)\b/i },
];

const VERBS = new Set(
  (
    "achieved analysed analyzed architected automated boosted built championed collaborated conducted coordinated created cut decreased delivered " +
    "designed developed devised directed drove enabled engineered established evaluated expanded facilitated founded generated grew guided " +
    "handled headed identified implemented improved increased initiated integrated introduced launched led maintained managed mentored migrated " +
    "modelled modeled negotiated optimised optimized organised organized oversaw owned partnered pioneered planned presented prioritised prioritized " +
    "produced programmed published raised reduced redesigned refactored resolved restructured revamped saved scaled secured shipped simplified " +
    "spearheaded standardised standardized streamlined supported taught tested trained transformed tripled upgraded won wrote"
  ).split(" "),
);

const STOPWORDS = new Set(
  (
    "a about above across after again all also an and any are as at be because been being both but by can could did do does doing during each " +
    "either etc for from had has have having he her here his how i if in into is it its just like may me more most must my no nor not of off on " +
    "once one only or other our out over own per same she should so some such than that the their them then there these they this those through " +
    "to too under until up us use using very via was we were what when where which while who whom why will with within without would you your " +
    "able ability candidate candidates experience experienced role roles work working team teams job jobs year years strong good great excellent " +
    "required requirements preferred plus including include includes responsibilities responsible looking join company opportunity skills skill " +
    "knowledge understanding etc new well across ensure help make based level related least minimum degree bachelor bachelors master masters"
  ).split(" "),
);

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** A line that reads as a bullet: marked with one, or a short line starting with a word. */
const BULLET = /^([•·▪◦\-–—*>]|\d+[.)])\s*/;
const bulletLines = (all: string[]) => all.filter((line) => BULLET.test(line)).map((line) => line.replace(BULLET, ""));

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) ?? [];

/** The job description's most-used meaningful words, the way a recruiter's search would pick them. */
export function jobKeywords(job: string, limit = 20): string[] {
  const counts = new Map<string, number>();
  for (const word of wordsOf(job)) {
    if (word.length < 3 || STOPWORDS.has(word) || /^\d/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

const status = (points: number, max: number): AtsStatus => (points >= max * 0.8 ? "pass" : points >= max * 0.4 ? "improve" : "fix");
const check = (id: AtsCheck["id"], title: string, points: number, max: number, detail: string, tip: string | null): AtsCheck => {
  const rounded = Math.round(Math.max(0, Math.min(points, max)));
  const result = status(rounded, max);
  return { id, title, status: result, points: rounded, max, detail, tip: result === "pass" ? null : tip };
};

/** Checks a resume, and how well it fits a job when its description is given. */
export function checkResume(resume: string, job = ""): AtsResult {
  const text = resume.slice(0, ATS_MAX_CHARACTERS);
  const all = lines(text);
  const words = wordsOf(text).length;
  const bullets = bulletLines(all);
  const checks: AtsCheck[] = [];

  // Contact details: how a recruiter reaches you, and the first thing an ATS reads.
  const email = EMAIL.test(text);
  const phone = PHONE.test(text.replace(EMAIL, ""));
  const link = LINK.test(text);
  const missingContact = [email ? "" : "an email address", phone ? "" : "a phone number", link ? "" : "a LinkedIn or portfolio link"].filter(Boolean);
  checks.push(
    check(
      "contact",
      "Contact details",
      (email ? 6 : 0) + (phone ? 5 : 0) + (link ? 4 : 0),
      15,
      missingContact.length === 0 ? "Email, phone and a link are all there." : `Missing ${missingContact.join(", ")}.`,
      "Put your email, phone and LinkedIn at the top, as plain text rather than in a header or an image, so the ATS can read them.",
    ),
  );

  // Standard section headings: an ATS sorts a resume by them.
  const found = SECTIONS.filter((section) => all.some((line) => line.length <= 40 && section.heading.test(line.replace(/[:|]+$/, ""))));
  const lacking = SECTIONS.filter((section) => !found.includes(section)).map((section) => section.name);
  checks.push(
    check(
      "sections",
      "Standard sections",
      (found.length / SECTIONS.length) * 20,
      20,
      lacking.length === 0 ? "Experience, Education and Skills each have their own heading." : `No ${lacking.join(" or ")} heading found.`,
      `Use plain headings an ATS knows: ${lacking.join(", ") || "Experience, Education, Skills"}. Creative names ("My journey") get missed.`,
    ),
  );

  // Length: a fresher's resume fits on one page, an experienced one on two.
  const lengthPoints = words >= 300 && words <= 900 ? 10 : (words >= 180 && words < 300) || (words > 900 && words <= 1300) ? 5 : 0;
  checks.push(
    check(
      "length",
      "Length",
      lengthPoints,
      10,
      `About ${words} words.`,
      words < 300 ? "It's short: add what you did in each role or project, and the results." : "It's long: keep what fits the jobs you want, one or two pages at most.",
    ),
  );

  // Measurable results: numbers make achievements concrete.
  const measured = bullets.filter((line) => /\d|%|₹|\$|\blakh|\bcrore/i.test(line)).length;
  const share = bullets.length > 0 ? measured / bullets.length : 0;
  checks.push(
    check(
      "impact",
      "Measurable results",
      bullets.length === 0 ? 0 : Math.min(share / 0.4, 1) * 15,
      15,
      bullets.length === 0 ? "No bullet points found to check." : `${measured} of ${bullets.length} bullet points have a number in them.`,
      "Add numbers where they're true: how many, how much, how fast, by what percentage. \"Cut report time by 30%\" beats \"Worked on reports\".",
    ),
  );

  // Action verbs: bullets that start with what you did.
  const strong = bullets.filter((line) => VERBS.has(wordsOf(line)[0] ?? "")).length;
  const verbShare = bullets.length > 0 ? strong / bullets.length : 0;
  checks.push(
    check(
      "verbs",
      "Action verbs",
      bullets.length === 0 ? 0 : Math.min(verbShare / 0.6, 1) * 10,
      10,
      bullets.length === 0 ? "No bullet points found to check." : `${strong} of ${bullets.length} bullet points start with an action verb.`,
      "Start each bullet with what you did (Built, Led, Analysed, Reduced), not with \"Responsible for\" or \"Worked on\".",
    ),
  );

  // Dates: when each role and degree was, which an ATS reads to work out experience.
  const years = new Set(text.match(/\b(19[89]\d|20[0-4]\d)\b/g) ?? []);
  checks.push(
    check(
      "dates",
      "Dates",
      years.size >= 2 ? 5 : years.size === 1 ? 2 : 0,
      5,
      years.size === 0 ? "No years found." : `${years.size} different ${years.size === 1 ? "year" : "years"} mentioned.`,
      "Give each role, project and degree its dates, e.g. \"Jun 2024 – Present\".",
    ),
  );

  // Readability: bullets rather than walls of text, and no very long paragraphs.
  const longParagraphs = all.filter((line) => wordsOf(line).length > 60).length;
  const readable = (bullets.length >= 3 ? 6 : bullets.length > 0 ? 3 : 0) + (longParagraphs === 0 ? 4 : longParagraphs === 1 ? 2 : 0);
  checks.push(
    check(
      "readability",
      "Easy to scan",
      readable,
      10,
      `${bullets.length} bullet ${bullets.length === 1 ? "point" : "points"}${longParagraphs > 0 ? `, ${longParagraphs} long ${longParagraphs === 1 ? "paragraph" : "paragraphs"}` : ""}.`,
      "Break long paragraphs into short bullet points, one achievement each.",
    ),
  );

  // The job's keywords, when a description was given.
  let keywords: AtsResult["keywords"] = null;
  const wanted = job.trim() ? jobKeywords(job) : [];
  if (wanted.length > 0) {
    const have = new Set(wordsOf(text));
    const hit = wanted.filter((word) => have.has(word));
    keywords = { found: hit, missing: wanted.filter((word) => !have.has(word)) };
    checks.push(
      check(
        "keywords",
        "Job keywords",
        Math.min(hit.length / (wanted.length * 0.7), 1) * 15,
        15,
        `${hit.length} of the job's ${wanted.length} main keywords are in your resume.`,
        "Where it's true for you, use the job's own words for your skills and tools: an ATS and a recruiter's search look for them.",
      ),
    );
  }

  const earned = checks.reduce((sum, entry) => sum + entry.points, 0);
  const possible = checks.reduce((sum, entry) => sum + entry.max, 0);
  const score = Math.round((earned / possible) * 100);
  return { score, label: score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 45 ? "Needs work" : "Weak", checks, words, keywords };
}
