import { z } from "zod";
import { ANSWERS_DRAFT_V1 } from "../prompts/answers-draft.v1";
import { canonicalSkill, findSkillsInText } from "../skills";
import type { TaskDefinition } from "../types";
import { wrapUntrusted } from "../untrusted";
import { tidyBullet, type PromptFact } from "./drafting-text";
import type { DraftingJob, DraftingRequirements } from "./resume-tailor";

export const DEFAULT_QUESTIONS = [
  "Why are you interested in this role?",
  "Describe a project that is relevant to this job.",
  "When can you join? (notice period or availability)",
] as const;

const TESTING = ["Selenium", "Manual Testing", "Automation Testing", "API Testing", "Postman", "JIRA", "JUnit", "TestNG", "Cypress", "Appium", "SDLC", "STLC"];
const DATA = ["SQL", "Excel", "Power BI", "Tableau", "Pandas", "NumPy", "Python", "Statistics"];

/** Up to two extra questions that fit the role. */
export function roleQuestions(requirements: DraftingRequirements, job: DraftingJob): string[] {
  const text = [job.title, ...requirements.requiredSkills, ...requirements.niceToHaveSkills, ...requirements.responsibilities]
    .join(" ")
    .toLowerCase();
  const questions: string[] = [];
  if (/\b(test|testing|qa|quality)\b/.test(text)) questions.push("Which testing tools have you used?");
  if (/\b(data|analyst|analytics|sql|excel|power bi|tableau|dashboard)\b/.test(text)) questions.push("Which data analysis tools have you used?");
  if (/\b(develop|developer|engineer|software|programming|coding)\b/.test(text) && questions.length < 2) {
    questions.push("Which programming languages are you most comfortable with?");
  }
  return questions.slice(0, 2);
}

/** Questions that only the student can answer; the draft must ask them instead of guessing. */
export const NEEDS_STUDENT = /\b(join|joining|notice|availab|start date|salary|ctc|compensation|stipend|relocat|shift|bond)\b/i;

export interface AnswersDraftInput {
  job: DraftingJob;
  requirements: DraftingRequirements;
  facts: PromptFact[];
  questions: string[];
}

export const answersDraftSchema = z.object({
  answers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      factIds: z.array(z.string()),
      needsInput: z.boolean(),
      note: z.string(),
    }),
  ),
});

export type AnswersDraftOutput = z.infer<typeof answersDraftSchema>;
type Answer = AnswersDraftOutput["answers"][number];

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function needsInput(question: string, note: string): Answer {
  return { question, answer: "", factIds: [], needsInput: true, note };
}

/** Deterministic answers for the keyless mock, built from the facts only. */
export function heuristicAnswers(input: AnswersDraftInput): AnswersDraftOutput {
  const { facts, job, requirements } = input;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const jobSkills = new Set(
    [...requirements.requiredSkills, ...requirements.niceToHaveSkills, ...findSkillsInText(job.title)].map((s) =>
      canonicalSkill(s).toLowerCase(),
    ),
  );
  const skillFacts = facts.filter((f) => f.kind === "skill");
  const relevantSkills = skillFacts.filter((f) => jobSkills.has(canonicalSkill(f.text).toLowerCase()));

  const answers = input.questions.map((question): Answer => {
    const q = question.toLowerCase();
    if (NEEDS_STUDENT.test(q)) {
      return needsInput(question, "Your profile doesn't say this. Add it yourself, for example your graduation month or notice period.");
    }
    if (q.includes("why") && q.includes("interested")) {
      const intro = byId.get("summary") ?? byId.get("headline");
      if (!intro) return needsInput(question, "Add a summary to your profile, or write this answer yourself.");
      const ids = [intro.id, ...relevantSkills.slice(0, 3).map((f) => f.id)];
      const skills = relevantSkills.slice(0, 3).map((f) => f.text);
      const answer = [tidyBullet(intro.text) + ".", skills.length ? `I have used ${listOf(skills)}.` : ""].filter(Boolean).join(" ");
      return { question, answer, factIds: ids, needsInput: false, note: "" };
    }
    if (q.includes("project")) {
      const projects = facts
        .filter((f) => f.kind === "project")
        .map((p, index) => {
          const highlights = facts.filter((f) => f.parentId === p.id);
          const hits = findSkillsInText([p.text, ...highlights.map((h) => h.text)].join("\n")).filter((s) => jobSkills.has(s.toLowerCase()));
          return { p, highlights, index, hits: hits.length };
        })
        .sort((a, b) => b.hits - a.hits || a.index - b.index);
      const best = projects[0];
      if (!best) return needsInput(question, "Add a project to your profile, or write this answer yourself.");
      const name = best.p.text.split(/ — | \(/)[0]!.trim();
      const parts = [`In my project ${name}, I ${lowerFirst(tidyBullet(best.highlights[0]?.text ?? "worked on it"))}.`];
      if (best.highlights[1]) parts.push(`I also ${lowerFirst(tidyBullet(best.highlights[1].text))}.`);
      return {
        question,
        answer: parts.join(" "),
        factIds: [best.p.id, ...best.highlights.slice(0, 2).map((h) => h.id)],
        needsInput: false,
        note: "",
      };
    }
    if (q.includes("tools") || q.includes("languages")) {
      const pool = q.includes("testing") ? TESTING : q.includes("data") ? DATA : null;
      const chosen = skillFacts.filter((f) =>
        pool ? pool.some((t) => t.toLowerCase() === canonicalSkill(f.text).toLowerCase()) : jobSkills.has(canonicalSkill(f.text).toLowerCase()),
      );
      const fallback = chosen.length ? chosen : q.includes("languages") ? skillFacts.slice(0, 4) : [];
      if (!fallback.length) return needsInput(question, "Your profile doesn't list tools for this. Add them to your skills if you have used them.");
      return {
        question,
        answer: `I have used ${listOf(fallback.slice(0, 5).map((f) => f.text))}.`,
        factIds: fallback.slice(0, 5).map((f) => f.id),
        needsInput: false,
        note: "",
      };
    }
    return needsInput(question, "Write this answer yourself; we couldn't draft it from your profile.");
  });
  return { answers };
}

export const answersDraftTask: TaskDefinition<AnswersDraftInput, AnswersDraftOutput> = {
  name: "answers.draft",
  promptVersion: ANSWERS_DRAFT_V1.version,
  outputSchema: answersDraftSchema,
  timeoutMs: 60_000,
  buildPrompt({ job, requirements, facts, questions }) {
    return {
      system: ANSWERS_DRAFT_V1.system,
      user: [
        `Job title: ${job.title.replace(/\s+/g, " ").slice(0, 200)}`,
        `Company: ${job.company.replace(/\s+/g, " ").slice(0, 200)}`,
        "What the job asks for:",
        wrapUntrusted("JOB_REQUIREMENTS", JSON.stringify(requirements, null, 1)),
        "The student's profile facts (cite these ids):",
        wrapUntrusted("PROFILE_FACTS", JSON.stringify(facts.map(({ id, kind, text, parentId }) => ({ id, kind, text, parentId })), null, 1)),
        "Questions to answer, in order:",
        questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
      ].join("\n\n"),
    };
  },
  mock: heuristicAnswers,
};
