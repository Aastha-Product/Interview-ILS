import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_ANSWERS } from "@/lib/apply/answers";
import { createTestClient, resetDatabase } from "@/test/db";

// The extension's routes, called as the extension calls them: with its token, no session cookie.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile(), loadProfileName: async () => "Jane Doe" };
});
// Printing a PDF needs Chromium; the route's own work is what's tested here.
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async (path: string) => new TextEncoder().encode(`%PDF ${path}`)) }));

const { rawClientOf } = await import("@/lib/owner/scope");
const { createExtensionToken } = await import("@/lib/extension/tokens");
const { giveConsent, saveAutoApply, setAutoApplyEnabled } = await import("@/lib/apply/settings");
const status = await import("./status/route");
const lease = await import("./lease/route");
const answers = await import("./tasks/[id]/answers/route");
const documentRoute = await import("./tasks/[id]/document/route");
const report = await import("./tasks/[id]/report/route");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());

const call = (handler: (request: NextRequest, context: never) => Promise<Response>, url: string, init: { token?: string; method?: string; body?: unknown; id?: string } = {}) =>
  handler(
    new NextRequest(`https://pathfinderedtech.com${url}`, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve({ id: init.id ?? "" }) } as never,
  );

let token = "";
let taskId = "";
beforeEach(async () => {
  await resetDatabase(prisma());
  for (const table of ["applyTask", "autoApplySettings", "jobMatch", "sharedPosting", "company", "extensionToken"] as const) await (raw()[table] as { deleteMany: () => Promise<unknown> }).deleteMany();
  await saveAutoApply({ preferences: { titles: ["Data Analyst"], skills: [], countries: ["in"], cities: [], remoteOk: true, level: "entry", employmentTypes: [] }, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 2, dryRun: false, answers: { ...EMPTY_ANSWERS, workAuthorized: true } });
  await giveConsent();
  await setAutoApplyEnabled(true);
  const company = await raw().company.create({ data: { name: "Acme", system: "LEVER", boardToken: "acme" } });
  const posting = await raw().sharedPosting.create({
    data: { companyId: company.id, system: "LEVER", externalId: "1", title: "Data Analyst", companyName: "Acme", location: "Pune", country: "in", description: "", url: "https://jobs.lever.co/acme/1", applyUrl: "https://jobs.lever.co/acme/1/apply", dedupeKey: "1", contentHash: "v1" },
  });
  const match = await prisma().jobMatch.create({ data: { sharedPostingId: posting.id, rank: 1, status: "SCORED", score: 85, tier: "STRONG" } });
  const application = await prisma().application.create({ data: { title: "Data Analyst", company: "Acme", role: "Data Analyst", documents: { create: [{ kind: "RESUME", units: [] }] } } });
  taskId = (await prisma().applyTask.create({ data: { jobMatchId: match.id, sharedPostingId: posting.id, state: "READY", applicationId: application.id } })).id;
  token = (await createExtensionToken("Chrome")).token;
});
afterAll(() => prisma().$disconnect());

describe("the extension's API (auto-apply step 5)", () => {
  it("refuses requests without a valid token", async () => {
    expect((await call(status.GET, "/api/ext/status")).status).toBe(401);
    expect((await call(lease.POST, "/api/ext/lease", { method: "POST", token: "pfx_wrong" })).status).toBe(401);
  });

  it("says who it's connected to and whether there's work", async () => {
    const response = await call(status.GET, "/api/ext/status", { token });
    expect(await response.json()).toEqual({ name: "Jane Doe", enabled: true, dryRun: false, ready: 1 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leases, answers a form it read, hands over the resume, and records the application as applied", async () => {
    const leased = await call(lease.POST, "/api/ext/lease", { method: "POST", token });
    expect(leased.status).toBe(200);
    const task = await leased.json();
    expect(task).toMatchObject({ taskId, system: "LEVER", applyUrl: "https://jobs.lever.co/acme/1/apply", answers: null, documents: { resume: true, coverLetter: false } });
    // Nothing more to hand out.
    expect((await call(lease.POST, "/api/ext/lease", { method: "POST", token })).status).toBe(204);

    const answered = await call(answers.POST, `/api/ext/tasks/${taskId}/answers`, {
      method: "POST",
      token,
      id: taskId,
      body: {
        leaseId: task.leaseId,
        fields: [
          { key: "email", label: "Email", required: true, type: "text", options: [] },
          { key: "auth", label: "Are you legally authorized to work in India?", required: true, type: "single", options: [{ label: "Yes", value: "y" }, { label: "No", value: "n" }] },
          { key: "why", label: "Why Acme?", required: true, type: "textarea", options: [] },
        ],
      },
    });
    expect(await answered.json()).toMatchObject({ answers: { auth: { kind: "option", value: "y" } }, missing: ["Why Acme?"] });

    const pdf = await call(documentRoute.GET, `/api/ext/tasks/${taskId}/document?kind=resume&lease=${task.leaseId}`, { token, id: taskId });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(await pdf.arrayBuffer())).toContain(`/print/resume/`);
    expect((await call(documentRoute.GET, `/api/ext/tasks/${taskId}/document?kind=letter&lease=${task.leaseId}`, { token, id: taskId })).status).toBe(404);

    const send = (body: object) => call(report.POST, `/api/ext/tasks/${taskId}/report`, { method: "POST", token, id: taskId, body });
    expect((await send({ outcome: "submitting", leaseId: task.leaseId })).status).toBe(200);
    expect((await send({ outcome: "applied", leaseId: task.leaseId, evidence: { url: "https://jobs.lever.co/acme/1/thanks", text: "Application submitted" } })).status).toBe(200);
    expect(await prisma().applyTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ state: "APPLIED" });
    // A second "applied" changes nothing.
    expect((await send({ outcome: "applied", leaseId: task.leaseId, evidence: { url: "", text: "" } })).status).toBe(409);
  });

  it("gives nothing to a browser that doesn't hold the application", async () => {
    const task = await (await call(lease.POST, "/api/ext/lease", { method: "POST", token })).json();
    expect((await call(documentRoute.GET, `/api/ext/tasks/${taskId}/document?kind=resume&lease=other`, { token, id: taskId })).status).toBe(409);
    expect((await call(answers.POST, `/api/ext/tasks/${taskId}/answers`, { method: "POST", token, id: taskId, body: { leaseId: "other", fields: [] } })).status).toBe(409);
    expect((await call(report.POST, `/api/ext/tasks/${taskId}/report`, { method: "POST", token, id: taskId, body: { outcome: "nonsense", leaseId: task.leaseId } })).status).toBe(400);
  });

  it("gives another student's extension nothing of this student's", async () => {
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    const { runAsUser } = await import("@/lib/owner/context");
    const other = await runAsUser("other-student", () => createExtensionToken("Their Chrome"));
    expect((await call(lease.POST, "/api/ext/lease", { method: "POST", token: other.token })).status).toBe(204);
    const mine = await (await call(lease.POST, "/api/ext/lease", { method: "POST", token })).json();
    expect((await call(report.POST, `/api/ext/tasks/${taskId}/report`, { method: "POST", token: other.token, id: taskId, body: { outcome: "submitting", leaseId: mine.leaseId } })).status).toBe(409);
  });
});
