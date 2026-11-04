import { z } from "zod";
import { RESUME_TAILOR_V1 } from "../prompts/resume-tailor.v1";
import { canonicalSkill, findSkillsInText } from "../skills";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";
import { tidyBullet, type PromptFact } from "./drafting-text";

export interface DraftingJob {
  title: string;
  company: string;
}

export interface DraftingRequirements {
  requiredSkills: string[];
  niceToHaveSkills: string[];
  responsibilities: string[];
  otherRequirements: string[];
}

export interface ResumeTailorInput {
  job: DraftingJob;
  requirements: DraftingRequirements;
  facts: PromptFact[];
  /** On the one regeneration: the rejected bullets and why. */
  feedback?: string[];
}

const bulletSchema = z.object({ text: z.string(), factIds: z.array(z.string()) });
const itemSchema = z.object({ sourceId: z.string(), bullets: z.array(bulletSchema) });

/** What the model returns. No length limits (Gemini's schema support lacks them); code checks follow. */
export const resumeTailorSchema = z.object({
  headline: z.string(),
  summary: z.object({ text: z.string(), factIds: z.array(z.string()) }),
  skills: z.array(z.string()),
  experiences: z.array(itemSchema),
  projects: z.array(itemSchema),
});

export type ResumeTailorOutput = z.infer<typeof resumeTailorSchema>;

export const MAX_BULLETS_PER_ITEM = 4;

/** Lower-cased job terms a fact can overlap with. */
function jobTerms(requirements: DraftingRequirements, job: DraftingJob): Set<string> {
  const skills = [...requirements.requiredSkills, ...requirements.niceToHaveSkills].map((s) => canonicalSkill(s).toLowerCase());
  const fromText = findSkillsInText([job.title, ...requirements.responsibilities].join("\n")).map((s) => s.toLowerCase());
  return new Set([...skills, ...fromText]);
}

function relevance(text: string, terms: Set<string>): number {
  return findSkillsInText(text).filter((s) => terms.has(s.toLowerCase())).length;
}

/** Deterministic tailoring for the keyless mock: the most job-relevant highlights, tidied, each citing itself. */
export function heuristicTailor(input: ResumeTailorInput): ResumeTailorOutput {
  const terms = jobTerms(input.requirements, input.job);
  const byId = new Map(input.facts.map((f) => [f.id, f]));
  const itemsOf = (kind: "experience" | "project") =>
    input.facts
      .filter((f) => f.kind === kind)
      .map((item) => {
        const highlights = input.facts
          .filter((f) => f.parentId === item.id)
          .map((f, index) => ({ f, index, score: relevance(f.text, terms) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, MAX_BULLETS_PER_ITEM);
        return {
          sourceId: item.id,
          bullets: highlights.map(({ f }) => ({ text: tidyBullet(f.text), factIds: [f.id] })),
          score: highlights.reduce((sum, h) => sum + h.score, 0) + relevance(item.text, terms),
        };
      });

  const projects = itemsOf("project")
    .map((p, index) => ({ ...p, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ sourceId, bullets }) => ({ sourceId, bullets }));
  const experiences = itemsOf("experience").map(({ sourceId, bullets }) => ({ sourceId, bullets }));

  const skills = input.facts
    .filter((f) => f.kind === "skill")
    .map((f, index) => ({ name: f.text, index, hit: terms.has(canonicalSkill(f.text).toLowerCase()) ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit || a.index - b.index)
    .map((s) => s.name);

  const summaryFact = byId.get("summary") ?? byId.get("headline");
  return {
    headline: byId.get("headline")?.text ?? "",
    summary: summaryFact ? { text: summaryFact.text, factIds: [summaryFact.id] } : { text: "", factIds: [] },
    skills,
    experiences,
    projects,
  };
}

export const resumeTailorTask: TaskDefinition<ResumeTailorInput, ResumeTailorOutput> = {
  name: "resume.tailor",
  promptVersion: RESUME_TAILOR_V1.version,
  outputSchema: resumeTailorSchema,
  timeoutMs: 90_000,
  buildPrompt({ job, requirements, facts, feedback }) {
    const parts = [
      `Job title: ${job.title.replace(/\s+/g, " ").slice(0, 200)}`,
      `Company: ${job.company.replace(/\s+/g, " ").slice(0, 200)}`,
      "What the job asks for:",
      wrapUntrusted("JOB_REQUIREMENTS", JSON.stringify(requirements, null, 1)),
      "The student's profile facts (cite these ids):",
      wrapUntrusted("PROFILE_FACTS", JSON.stringify(facts.map(({ id, kind, text, parentId }) => ({ id, kind, text, parentId })), null, 1)),
    ];
    if (feedback?.length) {
      parts.push(
        "These bullets from your previous draft were rejected because the facts don't support them. Do not repeat them:",
        wrapUntrusted("REJECTED_BULLETS", feedback.join("\n")),
      );
    }
    return { system: RESUME_TAILOR_V1.system, user: parts.join("\n\n") };
  },
  mock: heuristicTailor,
};
