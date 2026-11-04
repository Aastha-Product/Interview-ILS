import { z } from "zod";
import { RESUME_PARSE_V1 } from "../prompts/resume-parse.v1";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";
import { heuristicResumeParse } from "./resume-heuristic";

/**
 * What the model returns. Deliberately lenient (no length limits, which Gemini's schema support
 * does not cover anyway); @pathfinder/core trims and cleans it into a ProfileInput.
 */
export const resumeDraftSchema = z.object({
  headline: z.string().describe("A short professional headline, e.g. 'Final-year B.Tech CSE student'"),
  summary: z.string().describe("The resume's summary or objective, as written. Empty if none."),
  location: z.string().describe("City and state if stated. Empty if not stated."),
  phone: z.string().describe("Phone number if stated. Empty if not stated."),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  experiences: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      current: z.boolean(),
      highlights: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      url: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      technologies: z.array(z.string()),
      highlights: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      field: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      grade: z.string(),
    }),
  ),
  skills: z.array(z.object({ name: z.string(), category: z.string() })),
});

export type ResumeDraft = z.infer<typeof resumeDraftSchema>;

export const resumeParseTask: TaskDefinition<{ resumeText: string }, ResumeDraft> = {
  name: "resume.parse",
  promptVersion: RESUME_PARSE_V1.version,
  outputSchema: resumeDraftSchema,
  timeoutMs: 60_000,
  buildPrompt({ resumeText }) {
    return {
      system: RESUME_PARSE_V1.system,
      user: `${RESUME_PARSE_V1.userPreamble}\n\n${wrapUntrusted("RESUME", resumeText)}`,
    };
  },
  mock({ resumeText }) {
    return heuristicResumeParse(resumeText);
  },
};
