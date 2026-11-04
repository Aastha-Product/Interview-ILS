import "./storage-env";
import "../src/env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAiClient, createMockProvider } from "@pathfinder/ai";
import { enqueueTailor, getTasks, saveProfile, stopBoss, UserFacingError } from "@pathfinder/core";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../../packages/db/test/helpers";
import { fullProfile } from "../../../packages/core/test/fixtures";
import { sampleResume } from "../../../packages/core/test/resume-html.test";
import { handlePdf, pdfStorageKey } from "../src/handlers/pdf";
import { handleTailor, type GenerateDrafts } from "../src/handlers/tailor";

const ai = createAiClient({ provider: createMockProvider() });
const roomy = { dailyTailorLimit: 100, concurrentPerUser: 100 };
let userId: string;
let applicationId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("worker@example.test")).id;
  const db = scopedDb(userId);
  await saveProfile(db, fullProfile(), 0);
  const job = { company: "Example Softech", title: "QA Engineer", location: "Pune" };
  const listing = await getPrisma().jobListing.create({
    data: { source: "manual", sourceId: "w1", ...job, description: "QA job", dedupeKey: dedupeKey(job) },
  });
  applicationId = (await db.application.create({ data: { userId, jobListingId: listing.id } })).id;
});

afterAll(async () => {
  await stopBoss();
  await getPrisma().$disconnect();
});

async function resumeDoc(version = 1) {
  return scopedDb(userId).generatedDocument.create({
    data: { userId, applicationId, kind: "RESUME", version, content: sampleResume() as never, profileVersion: 1 },
  });
}

const jobFor = (taskId: string, retryCount = 0, retryLimit = 3) => ({
  id: "job-1",
  data: { userId, applicationId, taskId },
  retryCount,
  retryLimit,
});

describe("handleTailor", () => {
  it("runs drafting, queues the PDF and marks the task as needing input when answers do", async () => {
    const db = scopedDb(userId);
    const task = await enqueueTailor(db, applicationId, { limits: roomy });
    const doc = await resumeDoc();
    const generateDrafts: GenerateDrafts = async () => ({ resumeDocumentId: doc.id, answersDocumentId: "a", needsInput: true, removedCount: 1 });
    await handleTailor(jobFor(task.id), { ai, generateDrafts });
    const tasks = await getTasks(db, applicationId);
    expect(tasks.find((t) => t.id === task.id)).toMatchObject({ state: "needs_input", reason: "A few answers need your input.", documentId: doc.id });
    expect(tasks.find((t) => t.kind === "pdf")).toMatchObject({ state: "queued", documentId: doc.id });
  });

  it("fails with the plain-English message, without retrying, on a UserFacingError", async () => {
    const db = scopedDb(userId);
    const task = await enqueueTailor(db, applicationId, { limits: roomy });
    const generateDrafts: GenerateDrafts = async () => {
      throw new UserFacingError("NO_PROFILE", "Set up your profile first so we can draft from it.", 409);
    };
    await expect(handleTailor(jobFor(task.id), { ai, generateDrafts })).resolves.toBeUndefined();
    expect((await getTasks(db, applicationId))[0]).toMatchObject({ state: "failed", reason: "Set up your profile first so we can draft from it." });
  });

  it("rethrows other errors for a retry, and marks the task failed only on the last attempt", async () => {
    const db = scopedDb(userId);
    const task = await enqueueTailor(db, applicationId, { limits: roomy });
    const generateDrafts: GenerateDrafts = async () => {
      throw new Error("connection reset with secret details");
    };
    await expect(handleTailor(jobFor(task.id, 0, 3), { ai, generateDrafts })).rejects.toThrow();
    expect((await getTasks(db, applicationId))[0]).toMatchObject({ state: "working", reason: "" });
    await expect(handleTailor(jobFor(task.id, 3, 3), { ai, generateDrafts })).rejects.toThrow();
    const failed = (await getTasks(db, applicationId))[0]!;
    expect(failed).toMatchObject({ state: "failed", reason: "We couldn't prepare this draft. Please try again." });
    expect(failed.reason).not.toContain("secret");
  });
});

describe("handlePdf", () => {
  it("stores the PDF under the student's folder with the version in its name", async () => {
    const db = scopedDb(userId);
    const doc = await resumeDoc(3);
    const task = await db.applicationTask.create({
      data: { userId, applicationId, kind: "PDF", documentId: doc.id, idempotencyKey: `${userId}|${doc.id}|pdf|3` },
    });
    const fakePdf = new Uint8Array(Buffer.from("%PDF-1.7 fake"));
    await handlePdf({ id: "j", data: { userId, applicationId, documentId: doc.id, taskId: task.id }, retryCount: 0, retryLimit: 2 }, { render: async () => fakePdf });

    const key = pdfStorageKey(userId, applicationId, 3);
    expect(key).toBe(`users/${userId}/applications/${applicationId}/resume-v3.pdf`);
    const updated = await db.generatedDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(updated.pdfStorageKey).toBe(key);
    expect(updated.pdfRenderedAt).not.toBeNull();
    expect(await readFile(path.join(process.env.STORAGE_LOCAL_DIR!, key))).toEqual(Buffer.from(fakePdf));
    expect((await db.applicationTask.findUniqueOrThrow({ where: { id: task.id } })).state).toBe("DONE");
    expect((await db.usageRecord.findFirstOrThrow()).pdfs).toBe(1);
  });

  it("fails without retrying when the document is missing or belongs to someone else", async () => {
    const db = scopedDb(userId);
    const task = await db.applicationTask.create({
      data: { userId, applicationId, kind: "PDF", idempotencyKey: `${userId}|missing|pdf|1` },
    });
    await handlePdf({ id: "j", data: { userId, applicationId, documentId: "missing", taskId: task.id }, retryCount: 0, retryLimit: 2 });
    expect((await db.applicationTask.findUniqueOrThrow({ where: { id: task.id } })).state).toBe("FAILED");
  });
});
