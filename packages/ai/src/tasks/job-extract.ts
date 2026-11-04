import { z } from "zod";
import { JOB_EXTRACT_V1 } from "../prompts/job-extract.v1";
import { findSkillsInText } from "../skills";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";

export const WORK_MODES = ["onsite", "hybrid", "remote", "unknown"] as const;
export const SENIORITIES = ["intern", "fresher", "junior", "mid", "senior", "unknown"] as const;

/** What the model returns for a posting. No length limits: Gemini's schema support lacks them. */
export const jobRequirementsSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workMode: z.enum(WORK_MODES),
  seniority: z.enum(SENIORITIES),
  minYearsExperience: z.number().nullable(),
  requiredSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  education: z.string(),
  responsibilities: z.array(z.string()),
  otherRequirements: z.array(z.string()),
  employmentType: z.string(),
  salaryText: z.string(),
});

export type JobRequirements = z.infer<typeof jobRequirementsSchema>;

export interface JobExtractInput {
  title: string;
  company: string;
  location: string;
  description: string;
}

const NICE_MARKER = /(nice to have|good to have|preferred|a plus|bonus|added advantage|desirable)/i;

/** Rule-based reading of a posting, used by the mock provider so matching works without a key. */
export function heuristicJobExtract(input: JobExtractInput): JobRequirements {
  const text = input.description;
  const lower = text.toLowerCase();

  // Skills in sentences that say "preferred / nice to have" are nice-to-have; the rest are required.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const nice = new Set<string>();
  const all = new Set<string>();
  for (const sentence of sentences) {
    const skills = findSkillsInText(sentence);
    for (const s of skills) {
      all.add(s);
      if (NICE_MARKER.test(sentence)) nice.add(s);
    }
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  const required = [...all].filter((s) => !nice.has(s)).sort(byName);
  const niceList = [...nice].filter((s) => !required.includes(s)).sort(byName);

  let minYears: number | null = null;
  const range = lower.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+\s*)?(?:years?|yrs?)/);
  const plus = lower.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|work\s+|professional\s+|industry\s+)?experience/);
  if (range) minYears = Number(range[1]);
  else if (plus) minYears = Number(plus[1]);
  if (minYears === null && /\bfreshers?\b|\bno experience\b|\b0 years\b/.test(lower)) minYears = 0;

  let seniority: JobRequirements["seniority"] = "unknown";
  if (/\bintern(ship)?\b/.test(lower) || /\bintern(ship)?\b/i.test(input.title)) seniority = "intern";
  else if (/\bsenior\b|\blead\b|\bprincipal\b/i.test(input.title)) seniority = "senior";
  else if (minYears !== null) seniority = minYears <= 1 ? "fresher" : minYears <= 2 ? "junior" : minYears <= 5 ? "mid" : "senior";
  else if (/\bfreshers?\b|\bentry[- ]level\b|\bgraduate trainee\b/.test(lower)) seniority = "fresher";

  const workMode: JobRequirements["workMode"] = /\bhybrid\b/.test(lower)
    ? "hybrid"
    : /\bremote\b|work from home|\bwfh\b/.test(lower)
      ? "remote"
      : /\bon[- ]?site\b|work from office|\bwfo\b/.test(lower)
        ? "onsite"
        : "unknown";

  const education =
    text.match(/\b(B\.?\s?Tech|B\.?E\.?|BCA|MCA|M\.?\s?Tech|B\.?Sc|M\.?Sc|Bachelor'?s?|Master'?s?|any graduate)[^.\n]{0,80}/i)?.[0].trim() ?? "";

  const otherRequirements: string[] = [];
  const other = [
    /\b(20\d\d)\s+(?:batch|pass[- ]?outs?|graduates?)\b[^.\n]*/i,
    /\bnotice period[^.\n]*/i,
    /\bimmediate joiners?[^.\n]*/i,
    /\bnight shifts?[^.\n]*|\brotational shifts?[^.\n]*/i,
    /\bservice (?:bond|agreement)[^.\n]*|\bbond of[^.\n]*/i,
    /\bwilling(?:ness)? to relocate[^.\n]*/i,
    /\b\d{2}\s*%\s*(?:throughout|aggregate|in academics)[^.\n]*/i,
  ];
  for (const re of other) {
    const m = text.match(re);
    if (m) otherRequirements.push(m[0].trim());
  }

  const responsibilities = sentences
    .map((s) => s.replace(/^[\s•*\-–]+/, "").trim())
    .filter((s) => /^(write|design|develop|build|test|execute|create|maintain|analy[sz]e|prepare|work|collaborate|report|automate|perform|support|identify|document)\b/i.test(s))
    .slice(0, 6);

  const employmentType = /\binternship\b/.test(lower)
    ? "Internship"
    : /\bcontract\b/.test(lower)
      ? "Contract"
      : /\bpart[- ]time\b/.test(lower)
        ? "Part-time"
        : /\bfull[- ]time\b/.test(lower)
          ? "Full-time"
          : "";

  const salaryText =
    text.match(/(?:₹|rs\.?|inr)\s?[\d.,]+\s*(?:-|–|to)?\s*(?:₹|rs\.?|inr)?\s?[\d.,]*\s*(?:lpa|lakhs?|per annum|\/month|per month|k)?/i)?.[0].trim() ??
    text.match(/\b[\d.]+\s*(?:-|–|to)\s*[\d.]+\s*lpa\b/i)?.[0].trim() ??
    "";

  return {
    title: input.title,
    company: input.company,
    location: input.location,
    workMode,
    seniority,
    minYearsExperience: minYears,
    requiredSkills: required,
    niceToHaveSkills: niceList,
    education,
    responsibilities,
    otherRequirements,
    employmentType,
    salaryText,
  };
}

export const jobExtractTask: TaskDefinition<JobExtractInput, JobRequirements> = {
  name: "job.extract",
  promptVersion: JOB_EXTRACT_V1.version,
  outputSchema: jobRequirementsSchema,
  timeoutMs: 60_000,
  buildPrompt(input) {
    const posting = [
      `Title: ${input.title}`,
      `Company: ${input.company}`,
      `Location: ${input.location}`,
      "",
      input.description,
    ].join("\n");
    return {
      system: JOB_EXTRACT_V1.system,
      user: `${JOB_EXTRACT_V1.userPreamble}\n\n${wrapUntrusted("JOB_POSTING", posting)}`,
    };
  },
  mock(input) {
    return heuristicJobExtract(input);
  },
};
