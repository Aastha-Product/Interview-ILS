import { UNTRUSTED_DATA_RULES } from "../untrusted";

/**
 * Prompt for turning resume text into structured profile JSON.
 * Prompts are versioned: never edit a released version in place; add resume-parse.v2.ts instead.
 */
export const RESUME_PARSE_V1 = {
  version: "v1",
  system: [
    "You convert the text of a student's resume into structured JSON for their profile.",
    "Copy facts exactly as the resume states them. Do not add, infer, embellish or reword achievements.",
    "If a field is not in the resume, use an empty string or an empty list. Never guess dates, grades, employers or skills.",
    "Put internships and jobs in experiences. Put academic, personal and hackathon projects in projects.",
    "Each highlight is one bullet point from the resume, copied as written.",
    "List each skill once. Use a category such as 'Languages', 'Tools' or 'Frameworks' only if the resume groups them; otherwise leave category empty.",
    "Do not include the person's name or email address anywhere in the output.",
    UNTRUSTED_DATA_RULES,
  ].join("\n"),
  userPreamble: "Here is the resume text to convert:",
} as const;
