import "./demo-env";
import { createAiClient, createMockProvider } from "@pathfinder/ai";
import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { dedupeKey } from "@pathfinder/feeds";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { getApplication, getLatestResumePdf } from "../src/applications/service";
import { startApplication } from "../src/applications/start";
import { setInlineDispatcher, type InlineJob } from "../src/applications/tasks";
import { getConfig } from "../src/config";
import { renderResumePdf } from "../src/pdf/resume-pdf";
import { saveProfile } from "../src/profile/service";
import { handlePdf, handleTailor } from "../src/queue/handlers";
import { createDatabaseStorage, getStorage } from "../src/storage";
import { fullProfile } from "./fixtures";

const ai = createAiClient({ provider: createMockProvider() });

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => setInlineDispatcher(null));
afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("database file storage", () => {
  it("stores, reads and deletes a student's files, and they go with the account", async () => {
    const alice = await createUser("alice@example.test");
    const bob = await createUser("bob@example.test");
    const storage = createDatabaseStorage({
      secret: "a-long-enough-development-secret",
      appUrl: "https://demo.example.test",
    });
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3]);
    await storage.put(`users/${alice.id}/resumes/a.pdf`, bytes, "application/pdf");
    await storage.put(`users/${alice.id}/resumes/b.pdf`, bytes, "application/pdf");
    await storage.put(`users/${bob.id}/resumes/c.pdf`, bytes, "application/pdf");

    expect(Array.from(await storage.get(`users/${alice.id}/resumes/a.pdf`))).toEqual(
      Array.from(bytes),
    );
    await storage.delete(`users/${alice.id}/resumes/a.pdf`);
    await expect(storage.get(`users/${alice.id}/resumes/a.pdf`)).rejects.toThrow("Not found");

    await storage.deleteUserFiles(alice.id);
    expect(await getPrisma().storedFile.count({ where: { userId: alice.id } })).toBe(0);
    expect(await getPrisma().storedFile.count({ where: { userId: bob.id } })).toBe(1);

    // Deleting the account removes the rest.
    await getPrisma().user.delete({ where: { id: bob.id } });
    expect(await getPrisma().storedFile.count()).toBe(0);

    await expect(
      storage.put("not-a-user-folder/x.pdf", bytes, "application/pdf"),
    ).rejects.toThrow();
    const url = await storage.signedUrl(`users/${alice.id}/resumes/b.pdf`, { filename: "b.pdf" });
    expect(url).toMatch(/^https:\/\/demo\.example\.test\/api\/files\?/);
  });
});

describe("demo site: drafting and PDFs run inside the web app", () => {
  it("goes from 'Start application' to a downloadable PDF stored in the database, without a queue", async () => {
    expect(getConfig().STORAGE_DRIVER).toBe("database");
    expect(getStorage(getConfig()).driver).toBe("database");

    const user = await createUser("demo@example.test");
    const db = scopedDb(user.id);
    await saveProfile(db, fullProfile(), 0);
    const job = await getPrisma().jobListing.create({
      data: {
        source: "manual",
        sourceId: "demo-1",
        title: "QA Engineer",
        company: "Example Softech",
        location: "Pune",
        description:
          "Fresher QA engineer. Selenium, SQL, Java, Postman, JIRA. Write and run manual test cases.",
        dedupeKey: dedupeKey({
          title: "QA Engineer",
          company: "Example Softech",
          location: "Pune",
        }),
      },
    });

    // The web app's dispatcher runs jobs after responding; here they run in order, the same way.
    const pending: InlineJob[] = [];
    setInlineDispatcher((j) => pending.push(j));
    const { applicationId } = await startApplication(db, job.id);
    const info = { retryCount: 0, retryLimit: 0 };
    while (pending.length) {
      const next = pending.shift()!;
      if (next.queue === "ai.tailor")
        await handleTailor({ id: "inline", ...info, data: next.data }, { ai, budgetMs: 60_000 });
      else
        await handlePdf(
          { id: "inline", ...info, data: next.data },
          { renderResume: renderResumePdf },
        );
    }

    const view = await getApplication(db, applicationId);
    expect(view.tasks.map((t) => `${t.kind}:${t.state}`).sort()).toEqual([
      "pdf:done",
      "tailor:needs_input",
    ]);
    expect(view.resume?.pdfReady).toBe(true);
    const pdf = await getLatestResumePdf(db, applicationId);
    const stored = await getStorage(getConfig()).get(pdf.storageKey);
    expect(Buffer.from(stored.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(await getPrisma().storedFile.count({ where: { userId: user.id } })).toBe(1);
    // No pg-boss job was created.
    const tasks = await getPrisma().applicationTask.findMany();
    expect(tasks.every((t) => t.bossJobId?.startsWith("inline:"))).toBe(true);
  });
});
