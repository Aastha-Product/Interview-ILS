import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { createTestClient, resetDatabase } from "@/test/db";

import { EMPTY_ANSWERS } from "./answers";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: {} }));

const { rawClientOf } = await import("@/lib/owner/scope");
const { giveConsent, saveAutoApply, setAutoApplyEnabled } = await import("./settings");
const { DRY_RUN_REASON, LEASE_MS, leaseNext, markAppliedByStudent, reportOutcome, SUBMIT_MS, sweepLeases, UNCERTAIN_REASON } = await import("./lease");
const { createExtensionToken, listExtensionTokens, revokeExtensionToken, verifyExtensionToken, TOKEN_LIFETIME_MS } = await import("@/lib/extension/tokens");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());
const preferences = { titles: ["Data Analyst"], skills: [], countries: ["in"], cities: [], remoteOk: true, level: "entry" as const, employmentTypes: [] };

async function switchedOn(dryRun = false) {
  await saveAutoApply({ preferences, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 2, dryRun, answers: EMPTY_ANSWERS });
  await giveConsent();
  await setAutoApplyEnabled(true);
}

let company = "";
async function readyTask(id: string, options: { closed?: boolean; answers?: object } = {}) {
  const posting = await raw().sharedPosting.create({
    data: { companyId: company, system: "GREENHOUSE", externalId: id, title: `Analyst ${id}`, companyName: "Acme", location: "Pune", country: "in", description: "", url: `https://acme.example/${id}`, applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${id}`, closedAt: options.closed ? new Date() : null, dedupeKey: id, contentHash: "v1" },
  });
  const match = await prisma().jobMatch.create({ data: { sharedPostingId: posting.id, rank: 1, status: "SCORED", score: 85, tier: "STRONG" } });
  const application = await prisma().application.create({ data: { title: `Analyst ${id}`, company: "Acme", documents: { create: [{ kind: "RESUME", units: [] }] } } });
  return prisma().applyTask.create({ data: { jobMatchId: match.id, sharedPostingId: posting.id, state: "READY", applicationId: application.id, answers: options.answers ?? { first_name: { kind: "text", value: "Asha" } } } });
}
const state = async (id: string) => prisma().applyTask.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDatabase(prisma());
  for (const table of ["applyTask", "autoApplySettings", "jobMatch", "sharedPosting", "company", "extensionToken"] as const) await (raw()[table] as { deleteMany: () => Promise<unknown> }).deleteMany();
  company = (await raw().company.create({ data: { name: "Acme", system: "GREENHOUSE", boardToken: "acme" } })).id;
});
afterAll(() => prisma().$disconnect());

describe("leasing applications to a browser (auto-apply step 5)", () => {
  it("hands out nothing while auto-apply is off", async () => {
    await readyTask("1");
    expect(await leaseNext()).toBeNull();
  });

  it("hands out the oldest ready one with what the extension needs, and holds it", async () => {
    await switchedOn(true);
    const task = await readyTask("1");
    const now = new Date();
    const leased = await leaseNext(now);
    expect(leased).toMatchObject({
      taskId: task.id,
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      system: "GREENHOUSE",
      title: "Analyst 1",
      company: "Acme",
      dryRun: true,
      answers: { first_name: { kind: "text", value: "Asha" } },
      documents: { resume: true, coverLetter: false },
    });
    expect(new Date(leased!.leaseUntil).getTime()).toBe(now.getTime() + LEASE_MS);
    expect(await state(task.id)).toMatchObject({ state: "LEASED", leaseId: leased!.leaseId, attempts: 1 });
    // Held: no second browser gets it.
    expect(await leaseNext(now)).toBeNull();
  });

  it("gives two browsers asking at once different applications", async () => {
    await switchedOn();
    await readyTask("1");
    await readyTask("2");
    const [a, b] = await Promise.all([leaseNext(), leaseNext()]);
    expect(a && b && a.taskId !== b.taskId).toBe(true);
  });

  it("skips a job that closed instead of handing it out", async () => {
    await switchedOn();
    const closed = await readyTask("1", { closed: true });
    expect(await leaseNext()).toBeNull();
    expect(await state(closed.id)).toMatchObject({ state: "SKIPPED", leaseId: null });
  });
});

describe("what a browser reports (auto-apply step 5)", () => {
  async function leased() {
    await switchedOn();
    const task = await readyTask("1");
    const lease = (await leaseNext())!;
    return { task, leaseId: lease.leaseId };
  }

  it("records an application as applied after Submit, with proof, and shows it as sent", async () => {
    const { task, leaseId } = await leased();
    expect(await reportOutcome(task.id, { outcome: "submitting", leaseId })).toBe(true);
    expect(await state(task.id)).toMatchObject({ state: "SUBMITTING" });
    expect(await reportOutcome(task.id, { outcome: "applied", leaseId, evidence: { url: "https://job-boards.greenhouse.io/acme/jobs/1/confirmation", text: "Thank you for applying" } })).toBe(true);
    const applied = await state(task.id);
    expect(applied).toMatchObject({ state: "APPLIED", reason: null, evidence: { url: "https://job-boards.greenhouse.io/acme/jobs/1/confirmation", text: "Thank you for applying" } });
    expect(applied.appliedAt).not.toBeNull();
    expect(await prisma().application.findUniqueOrThrow({ where: { id: task.applicationId! } })).toMatchObject({ status: "SENT" });
    expect(await prisma().statusEvent.count({ where: { applicationId: task.applicationId! } })).toBe(1);
  });

  it("ignores reports from a browser that doesn't hold it, or out of order", async () => {
    const { task, leaseId } = await leased();
    expect(await reportOutcome(task.id, { outcome: "submitting", leaseId: "someone-else" })).toBe(false);
    // Applied without Submit first: refused.
    expect(await reportOutcome(task.id, { outcome: "applied", leaseId, evidence: { url: "", text: "" } })).toBe(false);
    expect((await state(task.id)).state).toBe("LEASED");
  });

  it("never hands out again once Submit was pressed: no answer means the student checks", async () => {
    const { task, leaseId } = await leased();
    const now = new Date();
    await reportOutcome(task.id, { outcome: "submitting", leaseId }, now);
    // The browser went quiet; the wait runs out.
    expect(await sweepLeases(new Date(now.getTime() + SUBMIT_MS + 1000))).toEqual({ released: 0, uncertain: 1 });
    expect(await state(task.id)).toMatchObject({ state: "UNCERTAIN", reason: UNCERTAIN_REASON });
    expect(await leaseNext(new Date(now.getTime() + SUBMIT_MS + 2000))).toBeNull();
    // A late confirmation still counts.
    expect(await reportOutcome(task.id, { outcome: "applied", leaseId, evidence: { url: "", text: "Thanks" } })).toBe(true);
    expect((await state(task.id)).state).toBe("APPLIED");
  });

  it("puts a hold that ran out before Submit back for any browser", async () => {
    const { task, leaseId } = await leased();
    const later = new Date(Date.now() + LEASE_MS + 1000);
    expect(await sweepLeases(later)).toEqual({ released: 1, uncertain: 0 });
    expect(await state(task.id)).toMatchObject({ state: "READY", leaseId: null });
    // The old lease can't report any more.
    expect(await reportOutcome(task.id, { outcome: "submitting", leaseId }, later)).toBe(false);
  });

  it("records a dry run, a question for the student, a failure and a release", async () => {
    const { task, leaseId } = await leased();
    expect(await reportOutcome(task.id, { outcome: "dry-run", leaseId })).toBe(true);
    expect(await state(task.id)).toMatchObject({ state: "NEEDS_STUDENT", reason: DRY_RUN_REASON });

    await prisma().applyTask.update({ where: { id: task.id }, data: { state: "READY", leaseId: null } });
    const second = (await leaseNext())!;
    expect(await reportOutcome(task.id, { outcome: "needs-student", leaseId: second.leaseId, reason: "The form asks for a code sent to your email." })).toBe(true);
    expect((await state(task.id)).reason).toBe("The form asks for a code sent to your email.");

    await prisma().applyTask.update({ where: { id: task.id }, data: { state: "READY", leaseId: null } });
    const third = (await leaseNext())!;
    expect(await reportOutcome(task.id, { outcome: "release", leaseId: third.leaseId })).toBe(true);
    expect(await state(task.id)).toMatchObject({ state: "READY", leaseId: null });

    const fourth = (await leaseNext())!;
    expect(await reportOutcome(task.id, { outcome: "failed", leaseId: fourth.leaseId, reason: "The form didn't load." })).toBe(true);
    expect(await state(task.id)).toMatchObject({ state: "FAILED", reason: "The form didn't load.", attempts: 4 });
  });

  it("lets the student mark a dry run or an uncertain one as applied", async () => {
    const { task, leaseId } = await leased();
    await reportOutcome(task.id, { outcome: "dry-run", leaseId });
    expect(await markAppliedByStudent(task.id)).toBe(true);
    expect(await state(task.id)).toMatchObject({ state: "APPLIED", evidence: { byStudent: true } });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: task.applicationId! } })).toMatchObject({ status: "SENT" });
    expect(await markAppliedByStudent(task.id)).toBe(false);
  });

  it("keeps students' applications apart", async () => {
    const { task, leaseId } = await leased();
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    expect(await runAsUser("other-student", () => leaseNext())).toBeNull();
    expect(await runAsUser("other-student", () => reportOutcome(task.id, { outcome: "submitting", leaseId }))).toBe(false);
    expect(await runAsUser("other-student", () => markAppliedByStudent(task.id))).toBe(false);
  });
});

describe("extension tokens (auto-apply step 5)", () => {
  it("connects a browser with a token only it knows, and disconnects it", async () => {
    const { id, token } = await createExtensionToken("Chrome on Windows");
    expect(token).toMatch(/^pfx_[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(await raw().extensionToken.findUniqueOrThrow({ where: { id } }))).not.toContain(token);
    expect(await verifyExtensionToken(token)).toEqual({ userId: "test-student", tokenId: id });
    expect(await listExtensionTokens()).toMatchObject([{ id, label: "Chrome on Windows" }]);
    expect(await revokeExtensionToken(id)).toBe(true);
    expect(await verifyExtensionToken(token)).toBeNull();
    expect(await listExtensionTokens()).toEqual([]);
  });

  it("refuses unknown, malformed and expired tokens", async () => {
    const { token } = await createExtensionToken("Chrome");
    expect(await verifyExtensionToken("pfx_unknown")).toBeNull();
    expect(await verifyExtensionToken("not-a-token")).toBeNull();
    expect(await verifyExtensionToken(undefined)).toBeNull();
    expect(await verifyExtensionToken(token, new Date(Date.now() + TOKEN_LIFETIME_MS + 1000))).toBeNull();
  });

  it("doesn't let another student disconnect someone's browser", async () => {
    const { id, token } = await createExtensionToken("Chrome");
    await raw().user.create({ data: { id: "other-student", email: "other@example.test" } });
    expect(await runAsUser("other-student", () => revokeExtensionToken(id))).toBe(false);
    expect(await runAsUser("other-student", () => listExtensionTokens())).toEqual([]);
    expect(await verifyExtensionToken(token)).not.toBeNull();
  });
});
