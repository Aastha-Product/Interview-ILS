import type { ResumeDraft } from "./resume-parse";

/**
 * A rule-based resume reader used by the mock provider, so resume import works with no AI key.
 * It recognises common section headings in Indian fresher resumes. It is a development aid,
 * not a substitute for the model.
 */

type Section = "header" | "summary" | "experience" | "projects" | "education" | "skills" | "other";

const HEADINGS: Array<[Section, RegExp]> = [
  ["summary", /^(summary|objective|career objective|profile|about me)$/i],
  ["experience", /^(experience|work experience|professional experience|internships?|internship experience)$/i],
  ["projects", /^(projects|academic projects|personal projects|key projects)$/i],
  ["education", /^(education|academic details|academics|educational qualifications?)$/i],
  ["skills", /^(skills|technical skills|key skills|skills and tools)$/i],
  ["other", /^(certifications?|achievements|awards|extra[- ]curricular( activities)?|hobbies|languages known|declaration|positions of responsibility)$/i],
];

const BULLET = /^\s*([•●▪◦*\-–]|\d+[.)])\s+/;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|leetcode\.com|kaggle\.com)\/[^\s|,;]+)/gi;
const HAS_URL_RE = new RegExp(URL_RE.source, "i");
const PHONE_RE = /(\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4})\s*(?:-|–|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}|present|current|ongoing)/i;

function headingOf(line: string): Section | null {
  const clean = line.replace(/[:|]+$/, "").trim();
  if (clean.length > 40) return null;
  for (const [section, re] of HEADINGS) if (re.test(clean)) return section;
  return null;
}

function splitDates(line: string): { rest: string; startDate: string; endDate: string; current: boolean } {
  const match = line.match(DATE_RANGE_RE);
  if (!match) return { rest: line.trim(), startDate: "", endDate: "", current: false };
  const end = match[2] ?? "";
  const current = /present|current|ongoing/i.test(end);
  return {
    rest: line.replace(match[0], "").replace(/[\s|,()–-]+$/, "").replace(/^[\s|,()–-]+/, "").trim(),
    startDate: match[1] ?? "",
    endDate: current ? "" : end,
    current,
  };
}

function splitPair(text: string): [string, string] {
  for (const sep of [" at ", " | ", " - ", " – ", ", "]) {
    const i = text.indexOf(sep);
    if (i > 0) return [text.slice(0, i).trim(), text.slice(i + sep.length).trim()];
  }
  return [text.trim(), ""];
}

export function heuristicResumeParse(text: string): ResumeDraft {
  const draft: ResumeDraft = {
    headline: "",
    summary: "",
    location: "",
    phone: "",
    links: [],
    experiences: [],
    projects: [],
    education: [],
    skills: [],
  };

  const phone = text.match(PHONE_RE);
  if (phone) draft.phone = phone[0].trim();
  const seenLinks = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const url = m[1]!.startsWith("http") ? m[1]! : `https://${m[1]}`;
    if (seenLinks.has(url)) continue;
    seenLinks.add(url);
    const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0] ?? "Link";
    draft.links.push({ label: host.charAt(0).toUpperCase() + host.slice(1), url });
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(EMAIL_RE, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  let section: Section = "header";
  let headerLines = 0;
  const summaryParts: string[] = [];

  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      section = heading;
      continue;
    }
    const isBullet = BULLET.test(line);
    const body = line.replace(BULLET, "").trim();

    switch (section) {
      case "header": {
        headerLines++;
        // Line 1 is usually the name, which the profile does not store.
        if (headerLines === 1) break;
        if (PHONE_RE.test(line) || HAS_URL_RE.test(line)) {
          const loc = line.split(/[|•]/).map((s) => s.trim()).find((s) => /^[A-Za-z .]+,\s*[A-Za-z .]+$/.test(s));
          if (loc && !draft.location) draft.location = loc;
          break;
        }
        if (!draft.headline && body.length <= 100) draft.headline = body;
        break;
      }
      case "summary":
        summaryParts.push(body);
        break;
      case "skills": {
        const category = /^([A-Za-z /&]+):/.exec(body)?.[1]?.trim() ?? "";
        const list = body.replace(/^[A-Za-z /&]+:\s*/, "");
        for (const name of list.split(/[,|•;]/).map((s) => s.trim()).filter(Boolean)) {
          if (!draft.skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
            draft.skills.push({ name, category });
          }
        }
        break;
      }
      case "experience": {
        const last = draft.experiences.at(-1);
        if (isBullet && last) {
          last.highlights.push(body);
        } else {
          const { rest, startDate, endDate, current } = splitDates(body);
          const [title, company] = splitPair(rest);
          draft.experiences.push({ title, company, location: "", startDate, endDate, current, highlights: [] });
        }
        break;
      }
      case "projects": {
        const last = draft.projects.at(-1);
        if (isBullet && last) {
          last.highlights.push(body);
        } else {
          const { rest, startDate, endDate } = splitDates(body);
          const [name, tech] = splitPair(rest.replace(/[()]/g, " | "));
          const technologies = tech.split(/[,|/]/).map((s) => s.trim()).filter(Boolean);
          draft.projects.push({ name: name.replace(/[\s|]+$/, ""), role: "", url: "", startDate, endDate, technologies, highlights: [] });
        }
        break;
      }
      case "education": {
        const last = draft.education.at(-1);
        const { rest, startDate, endDate } = splitDates(body);
        const grade = /(cgpa|gpa|percentage|%)/i.test(rest) ? rest : "";
        const looksLikeDegree = /\b(b\.?\s?tech|b\.?e\.?|m\.?\s?tech|bca|mca|b\.?sc|m\.?sc|diploma|12th|10th|hsc|ssc|bachelor|master)\b/i.test(rest);
        if (last && grade) {
          last.grade = rest;
        } else if (last && looksLikeDegree && !last.degree) {
          const [degree, field] = splitPair(rest.replace(/\bin\b/i, ","));
          last.degree = degree;
          last.field = field;
          if (startDate) {
            last.startDate = startDate;
            last.endDate = endDate;
          }
        } else if (!isBullet) {
          draft.education.push({ institution: rest, degree: "", field: "", startDate, endDate, grade: "" });
        }
        break;
      }
      default:
        break;
    }
  }

  draft.summary = summaryParts.join(" ");
  return draft;
}
