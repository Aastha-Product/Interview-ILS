import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import {
  enqueuePdf,
  enqueueTailor,
  getTasks,
  markTaskDone,
  markTaskFailed,
  markTaskWorking,
} from "../src/applications/tasks";
import { UserFacingError } from "../src/errors";
import { saveProfile } from "../src/profile/service";
import { getBoss, stopBoss } from "../src/queue/boss";
import { QUEUE } from "../src/queue/names";
import { fullProfile } from "./fixtures";
import { sampleResume } from "./resume-html.test";

const roomy = { dailyTailorLimit: 100, concurrentPerUser: 100 };
let aliceId: string;
let bobId: string;

async function listing(n: number) {
  const job = { company: `Company ${n}`, title: "QA Engineer", location: "Pune" };
  return getPrisma().jobListing.create({
    data: { source: "manual", sourceId: `t${n}`, ...job, description: "QA job", dedupeKey: dedupeKey(job) },
  });
}

async function application(userId: string, n: number) {
  const job = await listing(n);
  return scopedDb(userId).application.create({ data: { userId, jobListingId: job.id } });
}

async function resumeDoc(userId: string, applicationId: string, version: number) {
  return scopedDb(userId).generatedDocument.create({
    data: { userId, applicationId, kind: "RESUME", version, content: sampleResume() as never, profileVersion: 1 },
  });
}

beforeEach(async () => {
  await resetDatabase();
  const boss = await getBoss();
  await boss.deleteAllJobs();
  aliceId = (await createUser("alice-tasks@example.test")).id;
  bobId = (await createUser("bob-tasks@example.test")).id;
  await saveProfile(scopedDb(aliceId), fullProfile(), 0);
  await saveProfile(scopedDb(bobId), fullProfile(), 0);
});

afterAll(async () => {
  await stopBoss();
  await getPrisma().$disconnect();
});

describe("enqueueTailor", () => {
  it("is idempotent: a double click makes one task and one queue job", async () => {
    const db = scopedDb(aliceId);
    const app = await application(aliceId, 1);
    const [first, second] = await Promise.all([enqueueTailor(db, app.id, { limits: roomy }), enqueueTailor(db, app.id, { limits: roomy })]);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ kind: "tailor", state: "queued" });
    expect(await db.applicationTask.count()).toBe(1);
    const task = await db.applicationTask.findUniqueOrThrow({ where: { id: first.id } });
    expect(task.idempotencyKey).toBe(`${aliceId}|${app.jobListingId}|tailor|1`);
    const jobs = await (await getBoss()).findJobs(QUEUE.tailor, { key: task.idempotencyKey });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(task.bossJobId);
    expect(jobs[0]!.data).toEqual({ userId: aliceId, applicationId: app.id, taskId: first.id });
  });

  it("returns a finished task as-is for the same profile version, and makes a new one after the profile changes", async () => {
    const db = scopedDb(aliceId);
    const app = await application(aliceId, 1);
    const first = await enqueueTailor(db, app.id, { limits: roomy });
    await markTaskDone(db, first.id);
    expect((await enqueueTailor(db, app.id, { limits: roomy })).id).toBe(first.id);
    await saveProfile(db, { ...fullProfile(), headline: "Updated" }, 1);
    const redraft = await enqueueTailor(db, app.id, { limits: roomy });
    expect(redraft.id).not.toBe(first.id);
  });

  it("re-queues a failed task (Try again)", async () => {
    const db = scopedDb(aliceId);
    const app = await application(aliceId, 1);
    const first = await enqueueTailor(db, app.id, { limits: roomy });
    await markTaskFailed(db, first.id, "We couldn't prepare this draft. Please try again.");
    const again = await enqueueTailor(db, app.id, { limits: roomy });
    expect(again).toMatchObject({ id: first.id, state: "queued", reason: "" });
    const task = await db.applicationTask.findUniqueOrThrow({ where: { id: first.id } });
    const jobs = await (await getBoss()).findJobs(QUEUE.tailor, { id: task.bossJobId! });
    expect(jobs).toHaveLength(1);
  });

  it("refuses a third job while two are running (429 AI_BUSY)", async () => {
    const db = scopedDb(aliceId);
    const limits = { dailyTailorLimit: 100, concurrentPerUser: 2 };
    const apps = [await application(aliceId, 1), await application(aliceId, 2), await application(aliceId, 3)];
    await enqueueTailor(db, apps[0]!.id, { limits });
    const second = await enqueueTailor(db, apps[1]!.id, { limits });
    await markTaskWorking(db, second.id, 1);
    const error = await enqueueTailor(db, apps[2]!.id, { limits }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error).toMatchObject({ code: "AI_BUSY", status: 429, retryAfterSeconds: 30 });
    // Another student is unaffected.
    const bobApp = await application(bobId, 4);
    await expect(enqueueTailor(scopedDb(bobId), bobApp.id, { limits })).resolves.toMatchObject({ state: "queued" });
  });

  it("enforces the daily draft limit (429 DAILY_LIMIT) until midnight India time", async () => {
    const db = scopedDb(aliceId);
    const limits = { dailyTailorLimit: 1, concurrentPerUser: 10 };
    const now = new Date("2026-11-04T12:00:00Z"); // 17:30 IST
    const a1 = await application(aliceId, 1);
    const a2 = await application(aliceId, 2);
    const first = await enqueueTailor(db, a1.id, { limits, now });
    await markTaskDone(db, first.id);
    const error = await enqueueTailor(db, a2.id, { limits, now }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "DAILY_LIMIT", status: 429 });
    // 17:30 IST → midnight IST is 6.5 hours away.
    expect((error as UserFacingError).retryAfterSeconds).toBe(6.5 * 60 * 60);
  });

  it("won't enqueue another student's application (404)", async () => {
    const app = await application(aliceId, 1);
    await expect(enqueueTailor(scopedDb(bobId), app.id, { limits: roomy })).rejects.toMatchObject({
      code: "APPLICATION_NOT_FOUND",
      status: 404,
    });
    expect(await getPrisma().applicationTask.count()).toBe(0);
  });
});

describe("enqueuePdf", () => {
  it("keys the PDF task by document version and is idempotent", async () => {
    const db = scopedDb(aliceId);
    const app = await application(aliceId, 1);
    const v1 = await resumeDoc(aliceId, app.id, 1);
    const first = await enqueuePdf(db, v1.id);
    expect((await enqueuePdf(db, v1.id)).id).toBe(first.id);
    const task = await db.applicationTask.findUniqueOrThrow({ where: { id: first.id } });
    expect(task.idempotencyKey).toBe(`${aliceId}|${v1.id}|pdf|1`);
    expect(task.documentId).toBe(v1.id);
    const v2 = await resumeDoc(aliceId, app.id, 2);
    const second = await enqueuePdf(db, v2.id);
    expect(second.id).not.toBe(first.id);
    expect((await db.applicationTask.findUniqueOrThrow({ where: { id: second.id } })).idempotencyKey).toMatch(/\|pdf\|2$/);
  });

  it("the worker's own PDF request skips the student's concurrency cap", async () => {
    const db = scopedDb(aliceId);
    const limits = { dailyTailorLimit: 100, concurrentPerUser: 1 };
    const app = await application(aliceId, 1);
    await enqueueTailor(db, app.id, { limits });
    const doc = await resumeDoc(aliceId, app.id, 1);
    await expect(enqueuePdf(db, doc.id, { limits })).rejects.toMatchObject({ code: "AI_BUSY" });
    await expect(enqueuePdf(db, doc.id, { fromWorker: true, limits })).resolves.toMatchObject({ kind: "pdf", state: "queued" });
  });

  it("won't render another student's document (404)", async () => {
    const app = await application(aliceId, 1);
    const doc = await resumeDoc(aliceId, app.id, 1);
    await expect(enqueuePdf(scopedDb(bobId), doc.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND", status: 404 });
  });
});

describe("task state helpers", () => {
  it("moves through working → needs input, newest first in getTasks", async () => {
    const db = scopedDb(aliceId);
    const app = await application(aliceId, 1);
    const tailor = await enqueueTailor(db, app.id, { limits: roomy });
    await markTaskWorking(db, tailor.id, 1);
    const doc = await resumeDoc(aliceId, app.id, 1);
    await markTaskDone(db, tailor.id, { needsInput: true, reason: "A few answers need your input.", documentId: doc.id });
    const pdf = await enqueuePdf(db, doc.id, { fromWorker: true });
    const tasks = await getTasks(db, app.id);
    expect(tasks.map((t) => t.id)).toEqual([pdf.id, tailor.id]);
    expect(tasks[1]).toMatchObject({ kind: "tailor", state: "needs_input", reason: "A few answers need your input.", documentId: doc.id });
    expect(tasks[1]!.finishedAt).not.toBeNull();
    // Another student sees none of them, and can't change them.
    expect(await getTasks(scopedDb(bobId), app.id)).toEqual([]);
    await markTaskFailed(scopedDb(bobId), tailor.id, "nope");
    expect((await getTasks(db, app.id))[1]!.state).toBe("needs_input");
  });
});
