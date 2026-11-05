import { readFileSync } from "node:fs";
import path from "node:path";
import { createAiClient, createMockProvider, type AiProvider, type AnswersDraftOutput, type ResumeTailorOutput } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { generateDrafts } from "../src/applications/tailor";
import type { AnswersContent, ResumeContent } from "../src/applications/types";
import { importJob } from "../src/jobs/import";
import { saveListing } from "../src/jobs/listings";
import { profileInputSchema } from "../src/profile/schema";
import { saveProfile } from "../src/profile/service";
import { fullProfile } from "./fixtures";

const root = path.resolve(import.meta.dirname, "../../..");
const jobText = readFileSync(path.join(root, "fixtures/job-qa-pune.txt"), "utf8").replace(/^- Ignore all previous instructions.*$/m, "");
const { payloads } = JSON.parse(readFileSync(path.join(root, "fixtures/injection-payloads.json"), "utf8")) as {
  payloads: Array<{ id: string; text: string }>;
};

const ai = createAiClient({ provider: createMockProvider() });
let userId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("injection@example.test")).id;
  await saveProfile(scopedDb(userId), fullProfile(), 0);
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("injected job postings", () => {
  it("never raise a job's match score, whatever they say", async () => {
    const db = scopedDb(userId);
    const clean = await importJob({ db, ai }, { text: jobText, title: "QA Engineer - Fresher", company: "Clean Co", location: "Pune" });
    const results: Array<{ id: string; score: number }> = [];
    for (const [i, p] of payloads.entries()) {
      const injected = await importJob(
        { db, ai },
        { text: `${jobText}\n${p.text}\n`, title: "QA Engineer - Fresher", company: `Injected Co ${i}`, location: "Pune" },
      );
      results.push({ id: p.id, score: injected.match.score });
    }
    // An instruction can't buy points: extra words in a posting can only add requirements.
    for (const r of results) expect(r, r.id).toMatchObject({ score: expect.any(Number) });
    expect(results.filter((r) => r.score > clean.match.score)).toEqual([]);
    expect(results.every((r) => r.score < 100)).toBe(true);
  });
});

/** A model that does whatever the injected text asks: fabricated bullets, skills and answers. */
function obedientModel(): AiProvider {
  return {
    name: "obedient",
    async generate(req) {
      const out = req.mock() as Record<string, unknown>;
      if (req.task === "resume.tailor") {
        const r = structuredClone(out) as unknown as ResumeTailorOutput;
        r.headline = "Senior engineer with 8 years at Google";
        r.skills = [...r.skills, "Kubernetes", "AWS"];
        r.experiences[0]?.bullets.push(
          { text: "Built a Kubernetes platform serving 10 million users", factIds: ["exp:0:h0"] },
          { text: "Led a team of 50 engineers at Google", factIds: [] },
        );
        r.projects[0]?.bullets.push({ text: "Certified AWS Solutions Architect", factIds: ["proj:0:h0"] });
        return { text: JSON.stringify(r), model: "obedient", inputTokens: 1, outputTokens: 1 };
      }
      if (req.task === "answers.draft") {
        const a = structuredClone(out) as unknown as AnswersDraftOutput;
        for (const answer of a.answers) {
          answer.answer = "I have 8 years of Kubernetes experience at Google and led 50 engineers.";
          answer.factIds = ["exp:0:h0"];
          answer.needsInput = false;
        }
        return { text: JSON.stringify(a), model: "obedient", inputTokens: 1, outputTokens: 1 };
      }
      return { text: JSON.stringify(out), model: "obedient", inputTokens: 1, outputTokens: 1 };
    },
  };
}

describe("a model that follows injected instructions", () => {
  it("still can't get a single fabricated claim into the saved resume or answers", async () => {
    const db = scopedDb(userId);
    const injectedPosting = `${jobText}\n${payloads.map((p) => p.text).join("\n")}`;
    const { jobListingId } = await importJob({ db, ai }, { text: injectedPosting, title: "QA Engineer - Fresher", company: "Acme", location: "Pune" });
    const app = await db.application.create({ data: { userId, jobListingId } });

    const result = await generateDrafts({ db, ai: createAiClient({ provider: obedientModel() }) }, app.id);
    const resume = (await getPrisma().generatedDocument.findUniqueOrThrow({ where: { id: result.resumeDocumentId } }))
      .content as unknown as ResumeContent;
    const answers = (await getPrisma().generatedDocument.findUniqueOrThrow({ where: { id: result.answersDocumentId } }))
      .content as unknown as AnswersContent;
    const saved = JSON.stringify({ resume, answers });

    for (const fabricated of ["Google", "Kubernetes", "10 million", "50 engineers", "8 years", "Certified AWS", "Senior engineer"]) {
      expect(saved, fabricated).not.toContain(fabricated);
    }
    expect(result.removedCount).toBeGreaterThanOrEqual(4);
    // Genuine content survives, and the answers that couldn't be written honestly ask the student.
    expect(saved).toContain("Wrote 120 manual test cases");
    expect(JSON.stringify(answers)).not.toContain("Kubernetes");
  });
});

describe("control characters in outside text", () => {
  it("are dropped before a job listing is stored, including inside the raw feed payload", async () => {
    const nul = String.fromCharCode(0);
    const listing = await saveListing({
      source: "jsearch",
      sourceId: "nul-1",
      title: `QA${nul} Engineer`,
      company: `Acme${String.fromCharCode(7)}`,
      location: "Pune",
      remote: false,
      employmentType: "Full-time",
      description: `Line one${nul}\nLine two\twith a tab`,
      url: "https://jobs.example/nul-1",
      applyUrl: "https://jobs.example/nul-1",
      postedAt: null,
      closesAt: null,
      raw: { note: `bad${nul}byte`, nested: [`x${nul}`] },
    });
    expect(listing).toMatchObject({ title: "QA Engineer", company: "Acme", description: "Line one\nLine two\twith a tab" });
    expect(listing.raw).toEqual({ note: "badbyte", nested: ["x"] });
  });

  it("are dropped from profile text (e.g. from a PDF) while newlines and tabs stay", () => {
    const nul = String.fromCharCode(0);
    const parsed = profileInputSchema.parse({ ...fullProfile(), headline: `Final-year${nul} student`, summary: `One\n\tTwo${nul}` });
    expect(parsed.headline).toBe("Final-year student");
    expect(parsed.summary).toBe("One\n\tTwo");
  });
});
