import { createAiClient, createMockProvider, type AiProvider } from "@pathfinder/ai";
import { describe, expect, it } from "vitest";
import { codeCheckBullet, factCheckAnswers, factCheckResume } from "../src/applications/fact-check";
import { buildProfileFacts } from "../src/applications/facts";
import { fullProfile } from "./fixtures";

const facts = buildProfileFacts(fullProfile());
const ai = createAiClient({ provider: createMockProvider() });

describe("buildProfileFacts", () => {
  it("uses the documented id scheme", () => {
    const ids = facts.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["headline", "summary", "skill:0", "skill:7", "exp:0", "exp:0:h0", "proj:0", "proj:0:h1", "proj:1:h1", "edu:0", "link:0"]),
    );
    expect(facts.find((f) => f.id === "exp:0")?.text).toBe("QA Intern at Example Softech (Jun 2025 – Aug 2025)");
    expect(facts.find((f) => f.id === "proj:0")?.text).toBe("Library Management System — Java, MySQL");
    expect(facts.find((f) => f.id === "proj:1:h1")).toMatchObject({ kind: "project_highlight", parentId: "proj:1" });
    expect(facts.find((f) => f.id === "edu:0")?.text).toBe("B.Tech in CSE, Shri Example Institute of Technology (2022 – 2026), 7.8");
  });

  it("keeps profile positions when a highlight is empty", () => {
    const p = fullProfile();
    p.projects[0]!.highlights = ["", "Wrote 40 JUnit tests"];
    expect(buildProfileFacts(p).filter((f) => f.parentId === "proj:0").map((f) => f.id)).toEqual(["proj:0:h1"]);
  });
});

describe("codeCheckBullet", () => {
  const exp = { allowedParents: ["exp:0"] };

  it("passes a faithful rephrasing", () => {
    expect(codeCheckBullet("Wrote and ran 120 manual test cases", ["exp:0:h0"], facts, exp)).toEqual({ ok: true, reason: "" });
    expect(codeCheckBullet("Tested features using Selenium", ["exp:0:h0", "skill:3"], facts, exp).ok).toBe(true);
  });

  it("rejects a bullet that cites nothing", () => {
    expect(codeCheckBullet("Wrote test cases", [], facts, exp)).toMatchObject({ ok: false, reason: expect.stringMatching(/cite/) });
  });

  it("rejects unknown fact ids", () => {
    expect(codeCheckBullet("Wrote test cases", ["exp:9:h0"], facts, exp)).toMatchObject({ ok: false });
  });

  it("rejects facts borrowed from a different item", () => {
    const r = codeCheckBullet("Wrote 40 JUnit tests", ["proj:0:h1"], facts, exp);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/different experience or project/) });
    // Skills, summary and headline can be cited from anywhere.
    expect(codeCheckBullet("Used Java", ["skill:1"], facts, exp).ok).toBe(true);
  });

  it("rejects numbers the cited facts don't contain", () => {
    expect(codeCheckBullet("Automated 500 tests", ["exp:0:h0"], facts, exp)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('"500"'),
    });
    expect(codeCheckBullet("Improved coverage by 40%", ["exp:0:h0"], facts, exp).ok).toBe(false);
    // Formatting differences are fine.
    const withComma = buildProfileFacts({ ...fullProfile(), summary: "Handled 2000 records" });
    expect(codeCheckBullet("Handled 2,000 records", ["summary"], withComma, { allowedParents: "any" }).ok).toBe(true);
  });

  it("rejects a skill that isn't in the profile", () => {
    expect(codeCheckBullet("Deployed test suites on Kubernetes", ["exp:0:h0"], facts, exp)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Kubernetes"),
    });
    // A skill from the profile is fine even if this highlight doesn't name it.
    expect(codeCheckBullet("Wrote 120 manual test cases in Java", ["exp:0:h0"], facts, exp).ok).toBe(true);
  });
});

/** Returns a fixed answer for one task and the mock for the rest. */
function scripted(task: string, output: unknown): AiProvider {
  const mock = createMockProvider();
  return {
    name: "scripted",
    async generate(req) {
      if (req.task === task) return { text: JSON.stringify(output), model: "scripted", inputTokens: 1, outputTokens: 1 };
      return mock.generate(req);
    },
  };
}

describe("factCheckResume", () => {
  const draft = {
    headline: "Final-year B.Tech student looking for QA roles",
    summary: { text: "Final-year computer science student looking for a software testing role.", factIds: ["summary"] },
    skills: ["Selenium", "SQL", "Kubernetes"],
    experiences: [
      {
        sourceId: "exp:0",
        bullets: [
          { text: "Wrote 120 manual test cases", factIds: ["exp:0:h0"] },
          { text: "Led a team of 10 engineers at Google", factIds: ["exp:0:h0"] },
          { text: "Wrote documentation", factIds: [] },
          { text: "Reviewed pull requests", factIds: ["exp:7:h2"] },
        ],
      },
      { sourceId: "exp:5", bullets: [{ text: "Made things", factIds: ["exp:0:h0"] }] },
    ],
    projects: [{ sourceId: "proj:0", bullets: [{ text: "Built a desktop app", factIds: ["proj:0:h0"] }] }],
  };

  it("keeps supported content and removes everything else with a reason", async () => {
    const r = await factCheckResume({ ai }, draft, facts);
    expect(r.experiences[0]!.bullets.map((b) => b.text)).toEqual(["Wrote 120 manual test cases"]);
    expect(r.projects[0]!.bullets.map((b) => b.text)).toEqual(["Built a desktop app"]);
    expect(r.experiences.map((e) => e.sourceId)).toEqual(["exp:0"]);
    expect(r.skills).toEqual(["Selenium", "SQL"]);
    const removedTexts = r.removed.map((x) => x.text);
    expect(removedTexts).toEqual(
      expect.arrayContaining(["Led a team of 10 engineers at Google", "Wrote documentation", "Reviewed pull requests", "Made things", "Kubernetes"]),
    );
    expect(r.removedContent).toBe(4);
    expect(r.headline).toBe(draft.headline);
    expect(r.summary?.text).toBe(draft.summary.text);
  });

  it("drops what the model check says is unsupported, even when the code checks pass", async () => {
    const verifier = createAiClient({
      provider: scripted("fact.verify", {
        results: [
          { id: "headline", supported: true, reason: "" },
          { id: "summary", supported: true, reason: "" },
          { id: "experiences|exp:0|0", supported: false, reason: "Says 'manual' but the fact doesn't." },
          { id: "projects|proj:0|0", supported: true, reason: "" },
        ],
      }),
    });
    const r = await factCheckResume({ ai: verifier }, draft, facts);
    expect(r.experiences[0]!.bullets).toEqual([]);
    expect(r.removed).toContainEqual({ text: "Wrote 120 manual test cases", reason: "Says 'manual' but the fact doesn't." });
  });

  it("fails closed when the model check leaves an item out", async () => {
    const verifier = createAiClient({ provider: scripted("fact.verify", { results: [] }) });
    const r = await factCheckResume({ ai: verifier }, draft, facts);
    expect(r.projects[0]!.bullets).toEqual([]);
    expect(r.headline).toBeNull();
  });
});

describe("factCheckAnswers", () => {
  it("turns unsupported answers into needs-your-input, keeps one answer per question", async () => {
    const questions = ["Why are you interested in this role?", "Which testing tools have you used?", "When can you join?"];
    const draft = {
      answers: [
        { question: questions[0]!, answer: "I have 3 years of experience at Infosys.", factIds: ["summary"], needsInput: false, note: "" },
        { question: questions[1]!, answer: "I have used Selenium and Postman.", factIds: ["skill:3", "skill:4"], needsInput: false, note: "" },
      ],
    };
    const r = await factCheckAnswers({ ai }, draft, facts, questions, { title: "QA Engineer", company: "Acme" });
    expect(r.answers.map((a) => a.needsInput)).toEqual([true, false, true]);
    expect(r.answers[0]!.answer).toBe("");
    expect(r.answers[0]!.note).toMatch(/write this answer yourself/i);
    expect(r.answers[1]!.answer).toBe("I have used Selenium and Postman.");
    expect(r.removed.map((x) => x.text)).toEqual(["I have 3 years of experience at Infosys."]);
  });
});
