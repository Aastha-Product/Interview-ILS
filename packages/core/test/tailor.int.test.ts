import { createAiClient, createMockProvider, type AiProvider, type ResumeTailorOutput } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { generateDrafts } from "../src/applications/tailor";
import type { AnswersContent, FactCheckReport, ResumeContent } from "../src/applications/types";
import { UserFacingError } from "../src/errors";
import { saveProfile } from "../src/profile/service";
import { fullProfile } from "./fixtures";

const POSTING = {
  title: "QA Engineer - Fresher",
  company: "Acme Testing Pvt Ltd",
  location: "Pune",
  description: [
    "We are hiring freshers (0-1 years) for QA.",
    "Requirements: manual testing, Selenium, SQL and Jenkins.",
    "Immediate joiners preferred.",
  ].join("\n"),
};

let aliceId: string;
let bobId: string;
let applicationId: string;

/** Mock answers, except where a task is scripted. Records task names in call order. */
function scripted(overrides: Record<string, (mock: unknown) => unknown> = {}): AiProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "scripted",
    calls,
    async generate(req) {
      calls.push(req.task);
      const out = overrides[req.task] ? overrides[req.task]!(req.mock()) : req.mock();
      return { text: JSON.stringify(out), model: "scripted", inputTokens: 10, outputTokens: 5 };
    },
  };
}

const FAKE = "Led a team of 10 engineers at Google";

/** The mock tailoring plus three bad bullets: an invented claim, no citation, an unknown id. */
function withInjectedBullets(mock: unknown): ResumeTailorOutput {
  const out = structuredClone(mock) as ResumeTailorOutput;
  out.experiences[0]!.bullets.push(
    { text: FAKE, factIds: ["exp:0:h0"] },
    { text: "Mentored junior testers", factIds: [] },
    { text: "Wrote release notes", factIds: ["exp:4:h9"] },
  );
  return out;
}

async function load(documentId: string) {
  return getPrisma().generatedDocument.findUniqueOrThrow({ where: { id: documentId } });
}

beforeEach(async () => {
  await resetDatabase();
  aliceId = (await createUser("alice@example.test")).id;
  bobId = (await createUser("bob@example.test")).id;
  await saveProfile(scopedDb(aliceId), fullProfile(), 0);
  await saveProfile(scopedDb(bobId), fullProfile(), 0);
  const job = await getPrisma().jobListing.create({
    data: { source: "manual", sourceId: "tailor-1", ...POSTING, dedupeKey: dedupeKey(POSTING) },
  });
  applicationId = (await scopedDb(aliceId).application.create({ data: { userId: aliceId, jobListingId: job.id } })).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("generateDrafts", () => {
  it("saves a tailored resume and answers built from the profile", async () => {
    const ai = createAiClient({ provider: createMockProvider() });
    const result = await generateDrafts({ db: scopedDb(aliceId), ai }, applicationId);

    const resumeDoc = await load(result.resumeDocumentId);
    const answersDoc = await load(result.answersDocumentId);
    expect(resumeDoc).toMatchObject({ kind: "RESUME", version: 1, userId: aliceId, profileVersion: 1 });
    expect(answersDoc).toMatchObject({ kind: "ANSWERS", version: 1, userId: aliceId });

    const resume = resumeDoc.content as unknown as ResumeContent;
    // Header from the account and profile, never from the model.
    expect(resume.header).toMatchObject({ name: "alice", email: "alice@example.test", phone: "+91 98765 43210", location: "Indore, Madhya Pradesh" });
    // Structure copied from the profile.
    expect(resume.experiences.map((e) => [e.title, e.company, e.dates])).toEqual([["QA Intern", "Example Softech", "Jun 2025 – Aug 2025"]]);
    expect(resume.education[0]).toMatchObject({ institution: "Shri Example Institute of Technology", degree: "B.Tech" });
    expect(resume.projects).toHaveLength(2);
    for (const item of [...resume.experiences, ...resume.projects]) {
      for (const b of item.bullets) expect(b.factIds.length).toBeGreaterThan(0);
    }
    expect(resume.skills).toEqual(expect.arrayContaining(["Selenium", "SQL"]));

    const report = resumeDoc.factCheck as unknown as FactCheckReport;
    expect(report.regenerated).toBe(false);
    // What the job asks for that the profile lacks is a gap, not draft content.
    expect(report.gaps).toEqual(expect.arrayContaining(["Jenkins"]));
    expect(JSON.stringify(resume)).not.toContain("Jenkins");

    const answers = (answersDoc.content as unknown as AnswersContent).answers;
    expect(answers.length).toBeGreaterThanOrEqual(3);
    const join = answers.find((a) => /when can you join/i.test(a.question))!;
    expect(join).toMatchObject({ needsInput: true, answer: "" });
    expect(result.needsInput).toBe(true);

    const events = await getPrisma().applicationEvent.findMany({ where: { applicationId } });
    expect(events.map((e) => e.type)).toEqual(["DRAFT_READY"]);
    // AI calls are recorded against the student.
    expect(await getPrisma().aiRun.count({ where: { userId: aliceId, task: { startsWith: "resume.tailor" } } })).toBe(1);
  });

  it("increments versions on a second run", async () => {
    const ai = createAiClient({ provider: createMockProvider() });
    await generateDrafts({ db: scopedDb(aliceId), ai }, applicationId);
    const second = await generateDrafts({ db: scopedDb(aliceId), ai }, applicationId);
    expect((await load(second.resumeDocumentId)).version).toBe(2);
    expect((await load(second.answersDocumentId)).version).toBe(2);
  });

  it("the fact check removes an injected fake bullet", async () => {
    const provider = scripted({ "resume.tailor": withInjectedBullets });
    const ai = createAiClient({ provider });
    const result = await generateDrafts({ db: scopedDb(aliceId), ai }, applicationId);

    // First draft failed the check, so it was regenerated once (and failed the same way).
    expect(provider.calls.filter((t) => t === "resume.tailor")).toHaveLength(2);
    const doc = await load(result.resumeDocumentId);
    const resume = doc.content as unknown as ResumeContent;
    const report = doc.factCheck as unknown as FactCheckReport;
    const allBullets = [...resume.experiences, ...resume.projects].flatMap((i) => i.bullets.map((b) => b.text));

    expect(allBullets).not.toContain(FAKE);
    expect(allBullets).not.toContain("Mentored junior testers");
    expect(allBullets).not.toContain("Wrote release notes");
    expect(JSON.stringify(resume)).not.toContain("Google");
    expect(report.regenerated).toBe(true);
    expect(report.removed.map((r) => r.text)).toEqual(
      expect.arrayContaining([FAKE, "Mentored junior testers", "Wrote release notes"]),
    );
    expect(report.removed.find((r) => r.text === FAKE)?.reason).toMatch(/"10"/);
    // The genuine bullet survives.
    expect(allBullets).toContain("Wrote 120 manual test cases");
    expect(result.removedCount).toBeGreaterThanOrEqual(3);
  });

  it("keeps a clean regeneration when the second draft is fixed", async () => {
    let tailorCalls = 0;
    const provider = scripted({
      "resume.tailor": (mock) => (++tailorCalls === 1 ? withInjectedBullets(mock) : mock),
    });
    const result = await generateDrafts({ db: scopedDb(aliceId), ai: createAiClient({ provider }) }, applicationId);
    const report = (await load(result.resumeDocumentId)).factCheck as unknown as FactCheckReport;
    expect(report.regenerated).toBe(true);
    expect(report.removed.map((r) => r.text)).not.toContain(FAKE);
  });

  it("does not let another student draft for this application", async () => {
    const ai = createAiClient({ provider: createMockProvider() });
    const error = await generateDrafts({ db: scopedDb(bobId), ai }, applicationId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error).toMatchObject({ status: 404 });
    expect(await getPrisma().generatedDocument.count()).toBe(0);
  });

  it("needs a profile", async () => {
    const carolId = (await createUser("carol@example.test")).id;
    const job = await getPrisma().jobListing.findFirstOrThrow();
    const app = await scopedDb(carolId).application.create({ data: { userId: carolId, jobListingId: job.id } });
    const ai = createAiClient({ provider: createMockProvider() });
    await expect(generateDrafts({ db: scopedDb(carolId), ai }, app.id)).rejects.toMatchObject({ status: 409, code: "NO_PROFILE" });
  });
});
