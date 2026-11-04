import { z } from "zod";
import { MATCH_EXPLAIN_V1 } from "../prompts/match-explain.v1";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";

export const matchExplanationSchema = z.object({
  explanation: z.string(),
  gaps: z.array(z.object({ requirement: z.string(), advice: z.string() })),
});

export type MatchExplanation = z.infer<typeof matchExplanationSchema>;

export interface MatchExplainInput {
  jobTitle: string;
  company: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  /** The only job text the model sees: requirement strings the gaps may refer to. */
  requirements: string[];
  profileSummary: {
    headline: string;
    skills: string[];
    projectNames: string[];
    experienceTitles: string[];
    educationLine: string;
  };
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Keeps only gaps that name one of the given requirements, so the model can't invent new ones. */
export function validateGaps(
  gaps: MatchExplanation["gaps"],
  requirements: string[],
): MatchExplanation["gaps"] {
  const allowed = new Map(requirements.map((r) => [norm(r), r.trim()]));
  const seen = new Set<string>();
  const out: MatchExplanation["gaps"] = [];
  for (const gap of gaps) {
    const key = norm(gap.requirement);
    const original = allowed.get(key);
    if (!original || seen.has(key) || !gap.advice.trim()) continue;
    seen.add(key);
    out.push({ requirement: original, advice: gap.advice.trim() });
  }
  return out.slice(0, 5);
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Template explanation used by the mock provider. Built only from the given facts. */
export function templateExplanation(input: MatchExplainInput): MatchExplanation {
  const fit = input.score >= 70 ? "a strong fit" : input.score >= 45 ? "a partial fit" : "a weak fit";
  const sentences = [`This ${input.jobTitle} role at ${input.company} looks like ${fit} for you (${input.score}/100).`];
  if (input.matchedSkills.length) sentences.push(`You already list ${list(input.matchedSkills.slice(0, 4))}, which the job asks for.`);
  if (input.missingSkills.length) sentences.push(`The main thing missing is ${list(input.missingSkills.slice(0, 3))}.`);
  const gaps = input.missingSkills.slice(0, 5).flatMap((skill) => {
    const requirement = input.requirements.find((r) => norm(r) === norm(skill));
    return requirement
      ? [{ requirement, advice: `If you have used ${skill}, add it to your profile; if not, a small practice project would help.` }]
      : [];
  });
  return { explanation: sentences.join(" "), gaps };
}

export const matchExplainTask: TaskDefinition<MatchExplainInput, MatchExplanation> = {
  name: "match.explain",
  promptVersion: MATCH_EXPLAIN_V1.version,
  outputSchema: matchExplanationSchema,
  timeoutMs: 45_000,
  buildPrompt(input) {
    const facts = {
      job: { title: input.jobTitle, company: input.company },
      score: input.score,
      matchedSkills: input.matchedSkills,
      missingSkills: input.missingSkills,
      profile: input.profileSummary,
    };
    return {
      system: MATCH_EXPLAIN_V1.system,
      user: [
        "Facts calculated by the program (trusted):",
        JSON.stringify(facts, null, 2),
        "",
        "Requirements from the job posting that gaps may refer to:",
        wrapUntrusted("JOB_REQUIREMENTS", input.requirements.map((r) => `- ${r}`).join("\n")),
      ].join("\n"),
    };
  },
  mock(input) {
    return templateExplanation(input);
  },
};
