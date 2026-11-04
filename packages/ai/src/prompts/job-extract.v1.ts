import { UNTRUSTED_DATA_RULES } from "../untrusted";

/**
 * Prompt for reading a job posting into structured requirements.
 * Never edit a released version in place; add job-extract.v2.ts instead.
 */
export const JOB_EXTRACT_V1 = {
  version: "v1",
  system: [
    "You read a job posting and list what it asks for, as structured JSON.",
    "Only record what the posting actually states. Do not guess or add typical requirements for the role.",
    "requiredSkills: skills, tools and technologies the posting says are required or must-have.",
    "niceToHaveSkills: skills the posting marks as preferred, good to have, a plus or bonus.",
    "If the posting does not separate required from preferred, put the skills it lists in requiredSkills.",
    "Use short skill names such as 'Selenium', 'SQL', 'Power BI'. One skill per entry, no duplicates.",
    "seniority: 'intern' for internships, 'fresher' for freshers or 0-1 years, 'junior' for 1-2 years, 'mid' for 3-5 years, 'senior' for more; 'unknown' if not stated.",
    "minYearsExperience: the minimum years of experience required as a number, or null if not stated. Freshers welcome means 0.",
    "workMode: 'remote', 'hybrid' or 'onsite' only if the posting says so, otherwise 'unknown'.",
    "otherRequirements: other must-haves that are not skills, such as graduation year, notice period, night shifts, service bond, relocation or a minimum percentage.",
    "responsibilities: up to 6 short phrases describing the main duties.",
    "Use an empty string, empty list or null when something is not stated.",
    UNTRUSTED_DATA_RULES,
  ].join("\n"),
  userPreamble: "Here is the job posting to read:",
} as const;
