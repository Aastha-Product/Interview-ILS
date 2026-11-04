import { describe, expect, it } from "vitest";
import { createAiClient } from "../src/client";
import { createMockProvider } from "../src/providers/mock";
import { contentWords, stem, supportRatio, tidyBullet, type PromptFact } from "../src/tasks/drafting-text";
import { answersDraftTask, DEFAULT_QUESTIONS, heuristicAnswers, roleQuestions } from "../src/tasks/answers-draft";
import { factVerifyTask, heuristicVerify } from "../src/tasks/fact-verify";
import { heuristicTailor, resumeTailorTask } from "../src/tasks/resume-tailor";

const facts: PromptFact[] = [
  { id: "headline", kind: "headline", text: "Final-year B.Tech student looking for QA roles" },
  { id: "summary", kind: "summary", text: "Computer science student interested in software testing." },
  { id: "skill:0", kind: "skill", text: "Python" },
  { id: "skill:1", kind: "skill", text: "Selenium" },
  { id: "skill:2", kind: "skill", text: "SQL" },
  { id: "exp:0", kind: "experience", text: "QA Intern at Example Softech (Jun 2025 – Aug 2025)" },
  { id: "exp:0:h0", kind: "experience_highlight", text: "Wrote 120 manual test cases for a billing module", parentId: "exp:0" },
  { id: "exp:0:h1", kind: "experience_highlight", text: "Automated 15 regression tests with Selenium.", parentId: "exp:0" },
  { id: "proj:0", kind: "project", text: "Library Management System — Java, MySQL" },
  { id: "proj:0:h0", kind: "project_highlight", text: "built a desktop app for a college library", parentId: "proj:0" },
  { id: "proj:1", kind: "project", text: "Sales Dashboard — Python, Power BI" },
  { id: "proj:1:h0", kind: "project_highlight", text: "Cleaned 12 months of sales data with SQL", parentId: "proj:1" },
];
const job = { title: "QA Engineer", company: "Acme" };
const requirements = { requiredSkills: ["Selenium", "SQL"], niceToHaveSkills: [], responsibilities: ["Write test cases"], otherRequirements: ["Immediate joiner"] };

describe("text helpers", () => {
  it("stems and filters", () => {
    expect(stem("tests")).toBe("test");
    expect(stem("testing")).toBe("test");
    expect(stem("automated")).toBe("automat");
    expect(contentWords("I have used the tools for testing")).toEqual(["tool", "test"]);
    expect(tidyBullet(" built a thing.  ")).toBe("Built a thing");
  });

  it("measures support by shared content words", () => {
    expect(supportRatio("Wrote manual test cases", ["Wrote 120 manual test cases"])).toBe(1);
    expect(supportRatio("Led a team of engineers at Google", ["Wrote 120 manual test cases"])).toBeLessThan(0.6);
  });
});

describe("resume.tailor", () => {
  it("puts job text in an untrusted block and facts in a data block", () => {
    const { system, user } = resumeTailorTask.buildPrompt({ job, requirements, facts, feedback: ['"x": no'] });
    expect(user).toContain("<<<BEGIN_UNTRUSTED_JOB_REQUIREMENTS>>>");
    expect(user).toContain("<<<BEGIN_UNTRUSTED_PROFILE_FACTS>>>");
    expect(user).toContain("<<<BEGIN_UNTRUSTED_REJECTED_BULLETS>>>");
    expect(system).toMatch(/never add anything the cited facts don't say/i);
  });

  it("mock cites one fact per bullet and orders by job relevance", () => {
    const out = heuristicTailor({ job, requirements: { ...requirements, responsibilities: [] }, facts });
    expect(out.experiences[0]!.bullets).toEqual([
      { text: "Automated 15 regression tests with Selenium", factIds: ["exp:0:h1"] },
      { text: "Wrote 120 manual test cases for a billing module", factIds: ["exp:0:h0"] },
    ]);
    expect(out.projects.map((p) => p.sourceId)).toEqual(["proj:1", "proj:0"]);
    expect(out.projects[1]!.bullets[0]!.text).toBe("Built a desktop app for a college library");
    expect(out.skills).toEqual(["Selenium", "SQL", "Python"]);
    expect(out.summary).toEqual({ text: facts[1]!.text, factIds: ["summary"] });
  });

  it("is deterministic and schema-valid through the mock provider", async () => {
    const client = createAiClient({ provider: createMockProvider() });
    const a = await client.run(resumeTailorTask, { job, requirements, facts });
    const b = await client.run(resumeTailorTask, { job, requirements, facts });
    expect(a).toEqual(b);
  });
});

describe("answers.draft", () => {
  it("has the default questions and adds role questions", () => {
    expect(DEFAULT_QUESTIONS).toHaveLength(3);
    expect(roleQuestions(requirements, job)).toEqual(["Which testing tools have you used?", "Which data analysis tools have you used?"]);
    expect(roleQuestions({ ...requirements, requiredSkills: [], responsibilities: [] }, { title: "Software Developer", company: "x" })).toEqual([
      "Which programming languages are you most comfortable with?",
    ]);
  });

  it("mock never guesses availability and cites facts for the rest", () => {
    const questions = [...DEFAULT_QUESTIONS, "Which testing tools have you used?"];
    const { answers } = heuristicAnswers({ job, requirements, facts, questions });
    expect(answers.map((a) => a.question)).toEqual(questions);
    const join = answers[2]!;
    expect(join).toMatchObject({ needsInput: true, answer: "", factIds: [] });
    expect(join.note).toMatch(/notice period/);
    expect(answers[0]!.factIds).toContain("summary");
    expect(answers[1]!.answer).toMatch(/^In my project (Sales Dashboard|Library Management System), I /);
    expect(answers[3]!.answer).toBe("I have used Selenium.");
  });

  it("schema-valid through the mock provider", async () => {
    const client = createAiClient({ provider: createMockProvider() });
    const out = await client.run(answersDraftTask, { job, requirements, facts, questions: [...DEFAULT_QUESTIONS] });
    expect(out.answers).toHaveLength(3);
  });
});

describe("fact.verify mock", () => {
  it("supports faithful items and rejects invented ones", () => {
    const { results } = heuristicVerify({
      items: [
        { id: "a", text: "Wrote manual test cases for billing", facts: [{ id: "exp:0:h0", text: facts[6]!.text }] },
        { id: "b", text: "Led a team of 10 engineers at Google", facts: [{ id: "exp:0:h0", text: facts[6]!.text }] },
      ],
    });
    expect(results.map((r) => [r.id, r.supported])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(results[1]!.reason).not.toBe("");
  });

  it("wraps items in an untrusted block", () => {
    expect(factVerifyTask.buildPrompt({ items: [] }).user).toContain("<<<BEGIN_UNTRUSTED_ITEMS_TO_CHECK>>>");
  });
});
