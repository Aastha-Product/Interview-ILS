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

const prisma = () => db.client!;
const asUser = <T>(fn: () => Promise<T>) => runAsUser(TEST_USER_ID, fn);

// Imported after the mocks so tools.ts picks up the test client.
const { assistantTool, availableTools } = await import("./tools");

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
});
