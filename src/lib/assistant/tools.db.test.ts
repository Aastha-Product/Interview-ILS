import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";
import { runAsUser } from "@/lib/owner/context";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const toolsOn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/tools", () => ({ toolsEnabled: () => toolsOn.value, TOOLS_OFF_MESSAGE: "off" }));
vi.mock("@/lib/ai/config", async (orig) => ({ ...(await orig<object>()), isAiConfigured: async () => true }));
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<object>()), getAiProvider: async () => ({ complete: async () => ({ summary: "A fresh AI-written summary." }) }) }));

const prisma = () => db.client!;
const asUser = <T>(fn: () => Promise<T>) => runAsUser(TEST_USER_ID, fn);

// Imported after the mocks so tools.ts and the job key pick up the test client.
const { assistantTool, availableTools } = await import("./tools");
const { refineJobKey } = await import("@/lib/jobs/refine");

beforeEach(() => {
  toolsOn.value = true;
  return resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("assistant tools (Pathfinder, Phase 2)", () => {
  it("update_profile writes the basics it's given, and only those", async () => {
    const done = await asUser(() => assistantTool("update_profile")!.run({ headline: "Product Manager", city: "Delhi" }));
    expect(done).toContain("title, city");
    const fields = await asUser(() => prisma().profileField.findMany());
    const byKey = Object.fromEntries(fields.map((row) => [row.key, row.value]));
    expect(byKey).toMatchObject({ headline: "Product Manager", city: "Delhi" });
    expect(byKey.name).toBeUndefined();
  });

  it("set_job_search merges into the agent search and maps the country to its code", async () => {
    await asUser(() => assistantTool("set_job_search")!.run({ keywords: "Frontend engineer", place: "Pune", country: "India" }));
    expect(await asUser(async () => (await loadSettings()).agentQuery)).toMatchObject({ keywords: "Frontend engineer", place: "Pune", country: "in" });
  });

  it("set_job_search keeps the country as it was when it can't match the name, and says so", async () => {
    const done = await asUser(() => assistantTool("set_job_search")!.run({ keywords: "Designer", country: "Freedonia" }));
    expect(done).toMatch(/couldn.t match the country/i);
    expect(await asUser(async () => (await loadSettings()).agentQuery)).toMatchObject({ keywords: "Designer", country: "" });
  });

  it("offers the job-agent tools only where the job tools are on", () => {
    expect(availableTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["set_job_search", "run_job_agent", "configure_job_agent"]));
    toolsOn.value = false;
    expect(availableTools().map((tool) => tool.name)).toEqual(["update_profile"]);
    expect(assistantTool("run_job_agent")).toBeUndefined();
  });

  it("run_job_agent won't run while the agent is off", async () => {
    await expect(asUser(() => assistantTool("run_job_agent")!.run({}))).rejects.toThrow(/off/i);
  });

  it("configure_job_agent turns the agent on only once its search is ready", async () => {
    // No search yet: enabling is refused with a helpful message, and nothing is turned on.
    await expect(asUser(() => assistantTool("configure_job_agent")!.run({ enabled: "on" }))).rejects.toThrow(/what to look for/i);
    expect(await asUser(async () => (await loadSettings()).agentEnabled)).toBe(false);

    // With a ready search, it turns on, and sets "prepare drafts on its own".
    await asUser(() => saveSettings({ agentQuery: { ...EMPTY_QUERY, keywords: "Frontend", country: "de" } }));
    const done = await asUser(() => assistantTool("configure_job_agent")!.run({ enabled: "on", autoDraft: "on" }));
    expect(done).toContain("Updated the job agent");
    expect(await asUser(async () => ({ enabled: (await loadSettings()).agentEnabled, autoDraft: (await loadSettings()).agentAutoDraft }))).toEqual({
      enabled: true,
      autoDraft: true,
    });
  });

  it("tailor_application starts a rewrite of the application's document (the same path as its chat)", async () => {
    const app = await asUser(() => prisma().application.create({ data: { company: "Acme Corp", origin: "AGENT", awaitingReview: false }, select: { id: true } }));
    const done = await asUser(() =>
      assistantTool("tailor_application")!.run({ applicationId: app.id, document: "resume", instruction: "Emphasise my React work." }),
    );
    expect(done).toContain("Rewriting the resume for Acme Corp");
    // A chat message and a refine job for that application: exactly what the application's own chat does.
    expect(await asUser(() => prisma().chatMessage.count({ where: { applicationId: app.id } }))).toBe(1);
    expect(await asUser(() => prisma().job.count({ where: { key: refineJobKey(app.id) } }))).toBe(1);

    // A second request won't pile on while the first is still unfinished.
    await expect(
      asUser(() => assistantTool("tailor_application")!.run({ applicationId: app.id, document: "letter", instruction: "Shorten it." })),
    ).rejects.toThrow(/already being rewritten/i);
  });

  it("tailor_application refuses an application that isn't the student's", async () => {
    await expect(
      asUser(() => assistantTool("tailor_application")!.run({ applicationId: "no-such-app", document: "letter", instruction: "x" })),
    ).rejects.toThrow(/couldn.t find/i);
  });

  it("improve_resume_summary saves the AI-written summary to the profile", async () => {
    const done = await asUser(() => assistantTool("improve_resume_summary")!.run({ instruction: "make it shorter" }));
    expect(done).toContain("A fresh AI-written summary.");
    const field = await asUser(() => prisma().profileField.findUnique({ where: { userId_key: { userId: TEST_USER_ID, key: "summary" } } }));
    expect(field?.value).toBe("A fresh AI-written summary.");
  });
});
