import { scopedDb, type ScopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { getDashboard } from "../src/applications/dashboard";
import {
  createApplication,
  getApplication,
  getLatestResumePdf,
  listApplications,
  saveDraftEdits,
  updateApplication,
} from "../src/applications/service";
import type { AnswersContent, ResumeContent } from "../src/applications/types";
import { UserFacingError } from "../src/errors";
import { saveProfile } from "../src/profile/service";
import { fullProfile } from "./fixtures";

let alice: ScopedDb;
let bob: ScopedDb;

async function job(title: string, company: string, location = "Pune") {
  return getPrisma().jobListing.create({
    data: {
      source: "manual",
      sourceId: `${title}|${company}|${location}`,
      title,
      company,
      location,
      description: "A job",
      dedupeKey: dedupeKey({ title, company, location }),
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  alice = scopedDb((await createUser("alice@example.test")).id);
  bob = scopedDb((await createUser("bob@example.test")).id);
  await saveProfile(alice, fullProfile(), 0);
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

const expectCode = async (promise: Promise<unknown>, code: string, status: number) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UserFacingError);
  expect(error).toMatchObject({ code, status });
  return error as UserFacingError;
};

describe("duplicate guard", () => {
  it("blocks a second application for the same job and points to the first", async () => {
    const j = await job("QA Engineer", "Example Softech");
    const { applicationId } = await createApplication(alice, j.id);
    const error = await expectCode(createApplication(alice, j.id), "ALREADY_STARTED", 409);
    expect(error.details).toEqual({ applicationId });
    expect(await getPrisma().application.count()).toBe(1);
  });

  it("says when the student already applied", async () => {
    const j = await job("QA Engineer", "Example Softech");
    const { applicationId } = await createApplication(alice, j.id);
    await updateApplication(alice, applicationId, { status: "APPLIED" }, new Date("2026-11-03T06:00:00Z"));
    const error = await expectCode(createApplication(alice, j.id), "ALREADY_STARTED", 409);
    expect(error.message).toBe("You already applied for this job on 3 Nov 2026.");
  });

  it("asks to confirm the same title at the same company within 30 days, then allows it", async () => {
    const pune = await job("QA Engineer (Fresher)", "Example Softech Pvt Ltd", "Pune");
    const bengaluru = await job("QA Engineer", "Example Softech", "Bengaluru");
    const first = await createApplication(alice, pune.id);
    await updateApplication(alice, first.applicationId, { status: "APPLIED" });
    const error = await expectCode(createApplication(alice, bengaluru.id), "SIMILAR_APPLICATION", 409);
    expect(error.message).toMatch(/^You applied for QA Engineer \(Fresher\) at Example Softech Pvt Ltd on /);
    await expect(createApplication(alice, bengaluru.id, { confirmSimilar: true })).resolves.toHaveProperty("applicationId");
  });

  it("doesn't warn about an application from more than 30 days ago, or one never sent", async () => {
    const a = await job("Data Analyst", "Nimbus");
    const b = await job("Data Analyst", "Nimbus", "Indore");
    const c = await job("Data Analyst", "Nimbus", "Remote");
    const first = await createApplication(alice, a.id);
    await updateApplication(alice, first.applicationId, { status: "APPLIED" }, new Date(Date.now() - 31 * 24 * 3600 * 1000));
    await expect(createApplication(alice, b.id)).resolves.toBeTruthy(); // not applied yet → no warning for c either
    await expect(createApplication(alice, c.id)).resolves.toBeTruthy();
  });

  it("is per student: Bob can apply for the job Alice applied for", async () => {
    const j = await job("QA Engineer", "Example Softech");
    await createApplication(alice, j.id);
    await expect(createApplication(bob, j.id)).resolves.toHaveProperty("applicationId");
  });
});

describe("status changes", () => {
  it("sets appliedAt and responseAt once, records events, and clears them when moved back", async () => {
    const j = await job("QA Engineer", "Example Softech");
    const { applicationId } = await createApplication(alice, j.id);
    const t1 = new Date("2026-11-01T06:00:00Z");
    const t2 = new Date("2026-11-03T06:00:00Z");
    await updateApplication(alice, applicationId, { status: "APPLIED" }, t1);
    await updateApplication(alice, applicationId, { status: "INTERVIEW" }, t2);
    await updateApplication(alice, applicationId, { status: "OFFER" }, new Date("2026-11-05T06:00:00Z"));
    let view = await getApplication(alice, applicationId);
    expect(view.appliedAt).toBe(t1.toISOString());
    expect(view.responseAt).toBe(t2.toISOString());
    expect(view.events.map((e) => e.note).filter(Boolean)).toEqual(["INTERVIEW → OFFER", "APPLIED → INTERVIEW", "DRAFT → APPLIED"]);

    await updateApplication(alice, applicationId, { status: "APPLIED" });
    view = await getApplication(alice, applicationId);
    expect(view.responseAt).toBeNull();
    await updateApplication(alice, applicationId, { status: "DRAFT" });
    expect((await getApplication(alice, applicationId)).appliedAt).toBeNull();
  });

  it("rejects unknown statuses and other students' applications", async () => {
    const j = await job("QA Engineer", "Example Softech");
    const { applicationId } = await createApplication(alice, j.id);
    await expect(updateApplication(alice, applicationId, { status: "HIRED" })).rejects.toThrow();
    await expectCode(updateApplication(bob, applicationId, { status: "APPLIED" }), "APPLICATION_NOT_FOUND", 404);
    await expectCode(getApplication(bob, applicationId), "APPLICATION_NOT_FOUND", 404);
    expect(await listApplications(bob)).toEqual([]);
  });
});

describe("student edits", () => {
  const resume: ResumeContent = {
    header: { name: "Asha", email: "a@example.test", phone: "", location: "Pune", links: [] },
    headline: "QA fresher",
    summary: { text: "Summary", factIds: ["summary"] },
    skills: ["Selenium"],
    experiences: [],
    projects: [
      {
        sourceId: "proj:0",
        name: "Library",
        role: "",
        technologies: [],
        url: "",
        dates: "",
        bullets: [
          { id: "b1", text: "Built a library app", factIds: ["proj:0:h0"] },
          { id: "b2", text: "Wrote 40 JUnit tests", factIds: ["proj:0:h1"] },
        ],
      },
    ],
    education: [],
  };
  const answers: AnswersContent = {
    answers: [{ id: "q1", question: "When can you join?", answer: "", factIds: [], needsInput: true, note: "Add when you can join" }],
  };

  it("saves a new version, marks what the student changed, and needs a rendered PDF before download", async () => {
    const j = await job("QA Engineer", "Example Softech");
    const { applicationId } = await createApplication(alice, j.id);
    for (const [kind, content] of [["RESUME", resume], ["ANSWERS", answers]] as const) {
      await alice.generatedDocument.create({
        data: { userId: alice.userId, applicationId, kind, version: 1, content: content as never, profileVersion: 1, factCheck: { gaps: ["Jenkins"], removed: [], passed: 2, regenerated: false, checkedAt: "x" } },
      });
    }
    await expectCode(getLatestResumePdf(alice, applicationId), "PDF_NOT_READY", 409);

    const edited = structuredClone(resume);
    edited.projects[0]!.bullets[1]!.text = "Wrote 40 JUnit test cases";
    const editedAnswers = structuredClone(answers);
    editedAnswers.answers[0]!.answer = "July 2026";
    const saved = await saveDraftEdits(alice, applicationId, { resume: edited, answers: editedAnswers });
    expect(saved.resumeDocumentId).toBeTruthy();

    const view = await getApplication(alice, applicationId);
    expect(view.resume?.version).toBe(2);
    expect(view.resume?.editedByStudent).toBe(true);
    expect(view.resume?.factCheck?.gaps).toEqual(["Jenkins"]);
    expect(view.resume?.content.projects[0]!.bullets.map((b) => Boolean(b.editedByStudent))).toEqual([false, true]);
    expect(view.answers?.content.answers[0]).toMatchObject({ answer: "July 2026", needsInput: false, editedByStudent: true });

    // Saving the same content again creates nothing new.
    const again = await saveDraftEdits(alice, applicationId, { resume: view.resume!.content });
    expect(again.resumeDocumentId).toBeNull();

    await getPrisma().generatedDocument.update({ where: { id: saved.resumeDocumentId! }, data: { pdfStorageKey: "users/x/resume.pdf" } });
    await expect(getLatestResumePdf(alice, applicationId)).resolves.toMatchObject({ version: 2, filename: "alice_Example_Softech_Resume.pdf" });
    await expectCode(saveDraftEdits(bob, applicationId, { resume: edited }), "APPLICATION_NOT_FOUND", 404);
  });
});

describe("dashboard on seeded data", () => {
  it("computes sent, responses and response rate from the database", async () => {
    const statuses = ["APPLIED", "APPLIED", "REJECTED", "INTERVIEW", "APPLIED"] as const;
    for (const [i, status] of statuses.entries()) {
      const j = await job(`Role ${i}`, `Company ${i}`);
      const { applicationId } = await createApplication(alice, j.id);
      await updateApplication(alice, applicationId, { status: "APPLIED" });
      if (status !== "APPLIED") await updateApplication(alice, applicationId, { status });
    }
    const draftJob = await job("Draft role", "Draft Co");
    await createApplication(alice, draftJob.id);

    const d = await getDashboard(alice);
    expect(d.totals).toMatchObject({ sent: 5, responses: 2, responseRate: 0.4, interviews: 1, drafts: 1 });
    expect(d.weeks.at(-1)).toMatchObject({ sent: 5, cohortResponses: 2, responseRate: 0.4 });
    // Bob's dashboard is empty.
    expect((await getDashboard(bob)).totals.sent).toBe(0);
  });
});
