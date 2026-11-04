import { createAiClient, createMockProvider, type AiProvider } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { UserFacingError } from "../src/errors";
import { importResume } from "../src/resume/import";
import { createMemoryStorage } from "../src/storage";
import { istDay } from "../src/usage";
import { fixture } from "./fixtures";

let userId: string;

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUser("asha@example.test")).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

function deps(provider: AiProvider = createMockProvider()) {
  const storage = createMemoryStorage();
  return {
    storage,
    deps: {
      db: scopedDb(userId),
      storage,
      ai: createAiClient({ provider, sleep: async () => {} }),
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<UserFacingError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UserFacingError);
  return error as UserFacingError;
}

describe("importResume", () => {
  it.each(["resume-asha.pdf", "resume-asha.docx"])("turns %s into a draft profile for review", async (name) => {
    const { storage, deps: d } = deps();
    const bytes = fixture(name);
    const result = await importResume(d, bytes);

    // The draft has the resume's facts, and nothing is saved to the profile yet.
    const { draft } = result;
    expect(draft.headline).toBe("Final-year B.Tech Computer Science student");
    expect(draft.location).toBe("Indore, Madhya Pradesh");
    expect(draft.links.map((l) => l.url)).toEqual([
      "https://linkedin.com/in/asha-verma-example",
      "https://github.com/asha-verma-example",
    ]);
    expect(draft.skills.map((s) => s.name)).toEqual(["Python", "Java", "SQL", "Selenium", "Postman", "Git", "Excel"]);
    expect(draft.projects.map((p) => p.name)).toEqual(["Library Management System", "Sales Dashboard"]);
    expect(draft.experiences[0]).toMatchObject({ title: "QA Intern", company: "Example Softech Pvt Ltd" });
    expect(draft.education[0]).toMatchObject({ degree: "B.Tech", grade: "CGPA: 7.8/10" });
    expect(JSON.stringify(draft)).not.toContain("asha.verma@example.test");
    expect(await d.db.profile.count()).toBe(0);

    // The original file is stored privately under the student's own prefix.
    const files = await d.db.resumeFile.findMany();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe(result.resumeFileId);
    expect(files[0]!.parsedAt).not.toBeNull();
    expect(files[0]!.size).toBe(bytes.byteLength);
    expect(files[0]!.storageKey).toMatch(new RegExp(`^users/${userId}/resumes/[0-9a-f-]{36}\\.${name.split(".")[1]}$`));
    expect(storage.files.get(files[0]!.storageKey)).toEqual(bytes);

    // One model call recorded, with sizes and a hash only.
    const runs = await d.db.aiRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ task: "resume.parse@v1", model: "mock", outcome: "ok" });
    expect(runs[0]!.inputTokens).toBeGreaterThan(0);
    expect(runs[0]!.inputHash).toMatch(/^[0-9a-f]{64}$/);
    const runText = JSON.stringify(runs);
    for (const piece of ["Library Management", "Asha", "Selenium", "Indore"]) expect(runText).not.toContain(piece);

    const usage = await d.db.usageRecord.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ aiCalls: 1, aiInputTokens: runs[0]!.inputTokens, aiOutputTokens: runs[0]!.outputTokens });
    expect(usage[0]!.day.toISOString()).toBe(istDay().toISOString());

    expect(await d.db.auditLog.count({ where: { action: "RESUME_IMPORT" } })).toBe(1);
  });

  it("adds to today's usage instead of creating a second row", async () => {
    const { deps: d } = deps();
    await importResume(d, fixture("resume-asha.pdf"));
    await importResume(d, fixture("resume-asha.docx"));
    const usage = await d.db.usageRecord.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.aiCalls).toBe(2);
    expect(await d.db.aiRun.count()).toBe(2);
  });

  it("rejects a PNG with 415 and stores nothing", async () => {
    const { storage, deps: d } = deps();
    const error = await rejection(importResume(d, fixture("not-a-resume.png")));
    expect(error.status).toBe(415);
    expect(error.code).toBe("FILE_TYPE");
    expect(storage.files.size).toBe(0);
    expect(await d.db.resumeFile.count()).toBe(0);
  });

  it("rejects files over 5 MB with 413", async () => {
    const { storage, deps: d } = deps();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-1.4\n"));
    const error = await rejection(importResume(d, big));
    expect(error.status).toBe(413);
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(storage.files.size).toBe(0);
  });

  it("rejects an empty file", async () => {
    const { deps: d } = deps();
    const error = await rejection(importResume(d, new Uint8Array()));
    expect(error.code).toBe("FILE_EMPTY");
    expect(error.status).toBe(400);
  });

  it("rejects a PDF with almost no text (scanned) with 422 and makes no AI call", async () => {
    const { deps: d } = deps();
    const error = await rejection(importResume(d, fixture("scanned-like.pdf")));
    expect(error.status).toBe(422);
    expect(error.code).toBe("FILE_NO_TEXT");
    expect(error.message).toMatch(/scanned/i);
    expect(await d.db.aiRun.count()).toBe(0);
  });

  it("rejects a damaged PDF with 422", async () => {
    const { deps: d } = deps();
    const error = await rejection(importResume(d, fixture("resume-asha.pdf").slice(0, 60)));
    expect(error.status).toBe(422);
    expect(error.code).toBe("FILE_UNREADABLE");
  });

  it("returns a friendly 503 when the AI service keeps failing, and records each attempt", async () => {
    const failing: AiProvider = {
      name: "failing",
      generate: async () => Promise.reject(Object.assign(new Error("down"), { status: 503 })),
    };
    const { deps: d } = deps(failing);
    const error = await rejection(importResume(d, fixture("resume-asha.pdf")));
    expect(error.status).toBe(503);
    expect(error.code).toBe("AI_UNAVAILABLE");
    const runs = await d.db.aiRun.findMany();
    expect(runs.map((r) => r.outcome)).toEqual(["server_error", "server_error", "server_error"]);
    expect((await d.db.resumeFile.findFirst())?.parsedAt).toBeNull();
  });

  it("keeps each student's files and usage separate", async () => {
    const { deps: d } = deps();
    await importResume(d, fixture("resume-asha.pdf"));
    const otherId = (await createUser("other@example.test")).id;
    const other = scopedDb(otherId);
    expect(await other.resumeFile.count()).toBe(0);
    expect(await other.aiRun.count()).toBe(0);
    expect(await other.usageRecord.count()).toBe(0);
  });
});
