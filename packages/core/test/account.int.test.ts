import { scopedDb, USER_OWNED_MODELS } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { confirmsEmail, deleteAccount, EXPORT_FORMAT, exportAccount } from "../src/account/service";
import { recordAudit } from "../src/audit";
import { savePreferences, saveProfile } from "../src/profile/service";
import { createMemoryStorage, type FileStorage } from "../src/storage";
import { fullProfile } from "./fixtures";
import { sampleResume } from "./resume-html.test";

let aliceId: string;
let bobId: string;

/** Gives one user a row in every user-owned table, plus files in storage. */
async function seedEverything(userId: string, storage: FileStorage, n: number) {
  const db = scopedDb(userId);
  await saveProfile(db, fullProfile(), 0);
  await savePreferences(db, { roles: ["QA Engineer"], locations: ["Pune"], remoteOk: true, experienceLevel: "FRESHER", minSalary: null });
  const resumeKey = `users/${userId}/resumes/r${n}.pdf`;
  await storage.put(resumeKey, new Uint8Array([1, 2, 3]), "application/pdf");
  await db.resumeFile.create({ data: { userId, storageKey: resumeKey, mime: "application/pdf", size: 3 } });

  const job = { company: `Company ${n}`, title: "QA Engineer", location: "Pune" };
  const listing = await getPrisma().jobListing.create({
    data: { source: "manual", sourceId: `acct${n}`, ...job, description: "QA job", dedupeKey: dedupeKey(job) },
  });
  await db.jobMatch.create({
    data: { userId, jobListingId: listing.id, score: 70, reasons: ["Selenium"], gaps: ["Java"], profileVersion: 1 },
  });
  const app = await db.application.create({ data: { userId, jobListingId: listing.id, notes: `notes ${n}` } });
  await db.applicationEvent.create({ data: { userId, applicationId: app.id, type: "CREATED" } });
  const pdfKey = `users/${userId}/applications/${app.id}/resume-v1.pdf`;
  await storage.put(pdfKey, new Uint8Array([4, 5]), "application/pdf");
  await db.generatedDocument.create({
    data: { userId, applicationId: app.id, kind: "RESUME", version: 1, content: sampleResume() as never, profileVersion: 1, pdfStorageKey: pdfKey },
  });
  await db.applicationTask.create({ data: { userId, applicationId: app.id, kind: "TAILOR", idempotencyKey: `acct-${n}`, state: "DONE" } });
  await db.aiRun.create({
    data: { userId, task: "resume.tailor@v1", model: "mock", inputTokens: 1, outputTokens: 1, latencyMs: 1, outcome: "ok", inputHash: "h" },
  });
  await db.usageRecord.create({ data: { userId, day: new Date("2026-11-05"), aiCalls: 1 } });
  await db.feedSearch.create({ data: { userId, query: "qa", location: "Pune" } });
  await recordAudit(db, "SIGN_IN");
  await getPrisma().session.create({ data: { userId, sessionToken: `token-${n}`, expires: new Date(Date.now() + 86_400_000) } });
}

/** Rows per user-owned model (plus Auth.js sessions) for one user. */
async function rowCounts(userId: string): Promise<Record<string, number>> {
  const prisma = getPrisma() as unknown as Record<string, { count(args: unknown): Promise<number> }>;
  const counts: Record<string, number> = {};
  for (const model of [...USER_OWNED_MODELS, "Session"]) {
    const delegate = prisma[model[0]!.toLowerCase() + model.slice(1)]!;
    counts[model] = await delegate.count({ where: { userId } });
  }
  return counts;
}

beforeEach(async () => {
  await resetDatabase();
  aliceId = (await createUser("alice-account@example.test")).id;
  bobId = (await createUser("bob-account@example.test")).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("exportAccount", () => {
  it("returns the student's own data only, and audits the export", async () => {
    const storage = createMemoryStorage();
    await seedEverything(aliceId, storage, 1);
    await seedEverything(bobId, storage, 2);

    const data = await exportAccount(scopedDb(aliceId), { ipHash: "iphash" });
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.account.email).toBe("alice-account@example.test");
    expect(data.profile?.headline).toBe(fullProfile().headline);
    expect(data.jobPreferences?.roles).toEqual(["QA Engineer"]);
    expect(data.resumeUploads).toHaveLength(1);
    expect(data.applications).toHaveLength(1);
    expect(data.applications[0]).toMatchObject({ notes: "notes 1", jobListing: { company: "Company 1" } });
    expect(data.applications[0]!.documents).toHaveLength(1);
    expect(data.applications[0]!.events.map((e) => e.type)).toEqual(["CREATED"]);
    expect(data.jobMatches).toHaveLength(1);
    expect(data.usage).toHaveLength(1);
    expect(data.aiCalls).toHaveLength(1);
    expect(data.auditLog.map((a) => a.action)).toEqual(["PROFILE_UPDATE", "SIGN_IN", "EXPORT"]);

    const text = JSON.stringify(data);
    expect(text).not.toContain("bob-account");
    expect(text).not.toContain("Company 2");
    expect(text).not.toContain("notes 2");
    // No storage keys, login tokens or ids of other rows leak out.
    expect(text).not.toContain("users/");
    expect(text).not.toContain("token-1");
  });

  it("works for a brand-new account with nothing in it", async () => {
    const data = await exportAccount(scopedDb(aliceId));
    expect(data).toMatchObject({ profile: null, jobPreferences: null, applications: [], resumeUploads: [] });
  });
});

describe("deleteAccount", () => {
  it("removes every row and file the student owns, and leaves other students alone", async () => {
    const storage = createMemoryStorage();
    await seedEverything(aliceId, storage, 1);
    await seedEverything(bobId, storage, 2);
    const bobBefore = await rowCounts(bobId);
    const bobFiles = [...storage.files.keys()].filter((k) => k.startsWith(`users/${bobId}/`));

    // Every user-owned table really has a row for Alice, so "0 afterwards" means something.
    expect(Object.values(await rowCounts(aliceId)).every((c) => c > 0)).toBe(true);

    await deleteAccount(aliceId, { storage, hashSecret: "test-secret" });

    expect(await getPrisma().user.count({ where: { id: aliceId } })).toBe(0);
    expect(Object.values(await rowCounts(aliceId)).every((c) => c === 0)).toBe(true);
    expect([...storage.files.keys()].some((k) => k.startsWith(`users/${aliceId}/`))).toBe(false);

    expect(await rowCounts(bobId)).toEqual(bobBefore);
    expect([...storage.files.keys()].filter((k) => k.startsWith(`users/${bobId}/`))).toEqual(bobFiles);
    // Shared job listings stay.
    expect(await getPrisma().jobListing.count()).toBe(2);
  });

  it("deletes nothing if the files can't be deleted, so the student can try again", async () => {
    const storage = createMemoryStorage();
    await seedEverything(aliceId, storage, 1);
    const failing: FileStorage = {
      ...storage,
      deleteUserFiles: async () => {
        throw new Error("storage down");
      },
    };
    await expect(deleteAccount(aliceId, { storage: failing, hashSecret: "s" })).rejects.toMatchObject({
      code: "DELETE_FAILED",
      status: 503,
    });
    expect(await getPrisma().user.count({ where: { id: aliceId } })).toBe(1);
    expect((await rowCounts(aliceId)).Application).toBe(1);
  });
});

describe("confirmsEmail", () => {
  it("matches the email ignoring case and spaces, and never matches a missing email", () => {
    expect(confirmsEmail("  Alice@Example.test ", "alice@example.test")).toBe(true);
    expect(confirmsEmail("alice@example.tes", "alice@example.test")).toBe(false);
    expect(confirmsEmail("", null)).toBe(false);
  });
});
