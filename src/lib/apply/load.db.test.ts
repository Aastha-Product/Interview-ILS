// Auto-apply step 6: a load test, run on request (PATHFINDER_LOAD_TEST=1), never in CI: many
// students at once, each with two connected browsers taking turns on the same applications, all
// through the extension's real routes, token checks and per-student scoping, on Postgres.
//
//   $env:PATHFINDER_LOAD_TEST = "1"; $env:PATHFINDER_LOAD_STUDENTS = "100"   (default 100)
//   corepack yarn vitest run --project db src/lib/apply/load.db.test.ts --silent=false
//
// It checks what must hold at any scale: every application submitted exactly once, by a browser of
// its own student; nothing of one student seen by another; no request failing.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";
import { COMPLETE_ANSWERS } from "@/test/answers";

const RUN = process.env.PATHFINDER_LOAD_TEST === "1";
const STUDENTS = Number(process.env.PATHFINDER_LOAD_STUDENTS ?? 100);
const TASKS = Number(process.env.PATHFINDER_LOAD_TASKS ?? 5);

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: async () => "Student" }));

const { rawClientOf } = await import("@/lib/owner/scope");
const { runAsUser } = await import("@/lib/owner/context");
const { createExtensionToken } = await import("@/lib/extension/tokens");
const { giveConsent, saveAutoApply, setAutoApplyEnabled } = await import("@/lib/apply/settings");
const lease = await import("@/app/api/ext/lease/route");
const report = await import("@/app/api/ext/tasks/[id]/report/route");

const prisma = () => db.client!;
const raw = () => rawClientOf(prisma());

type Handler = (request: NextRequest, context: never) => Promise<Response>;
const timings: number[] = [];
const failures: string[] = [];

async function call(handler: Handler, token: string, path: string, id = "", body?: unknown): Promise<Response> {
  const started = performance.now();
  const response = await handler(
    new NextRequest(`https://pathfinderedtech.com${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) } as never,
  );
  timings.push(performance.now() - started);
  if (response.status >= 500) failures.push(`${path}: ${response.status}`);
  return response;
}

type Browser = { student: string; token: string };
type Leased = { taskId: string; leaseId: string };
/** Who submitted what: every "submitting" the server accepted. */
const submittedBy = new Map<string, string[]>();
const strangers: string[] = [];

/** One browser's extension: lease, say it's submitting, report applied; until there's nothing left. */
async function browse({ student, token }: Browser, everyone: Leased[]) {
  for (;;) {
    const response = await call(lease.POST, token, "/api/ext/lease");
    if (response.status === 204) return;
    if (response.status !== 200) throw new Error(`lease: ${response.status}`);
    const task = (await response.json()) as Leased;
    everyone.push(task);
    // Another student's application, by id and lease, must be refused.
    const other = everyone.find((candidate) => !candidate.taskId.startsWith(student));
    if (other) {
      const refused = await call(report.POST, token, `/api/ext/tasks/${other.taskId}/report`, other.taskId, { outcome: "release", leaseId: other.leaseId });
      if (refused.status !== 409) strangers.push(`${student} touched ${other.taskId}: ${refused.status}`);
    }
    const submitting = await call(report.POST, token, `/api/ext/tasks/${task.taskId}/report`, task.taskId, { outcome: "submitting", leaseId: task.leaseId });
    if (submitting.status !== 200) continue; // Not ours any more: never press Submit.
    submittedBy.set(task.taskId, [...(submittedBy.get(task.taskId) ?? []), student]);
    const applied = await call(report.POST, token, `/api/ext/tasks/${task.taskId}/report`, task.taskId, { outcome: "applied", leaseId: task.leaseId, evidence: { url: "https://boards.example/thanks", text: "Thank you for applying" } });
    if (applied.status !== 200) failures.push(`applied ${task.taskId}: ${applied.status}`);
  }
}

describe.skipIf(!RUN)(`auto-apply under load: ${STUDENTS} students, ${TASKS} applications each, two browsers each`, () => {
  const browsers: Browser[] = [];

  beforeAll(async () => {
    await resetDatabase(prisma());
    const company = await raw().company.create({ data: { name: "Acme", system: "GREENHOUSE", boardToken: "acme" } });
    const postings = await Promise.all(
      Array.from({ length: TASKS }, (_, index) =>
        raw().sharedPosting.create({ data: { companyId: company.id, system: "GREENHOUSE", externalId: String(index), title: `Analyst ${index}`, companyName: "Acme", location: "Pune", country: "in", description: "", url: `https://boards.example/${index}`, applyUrl: `https://boards.example/${index}/apply`, dedupeKey: String(index), contentHash: "v1" } }),
      ),
    );
    for (let index = 0; index < STUDENTS; index++) {
      const student = `load-${String(index).padStart(4, "0")}`;
      await raw().user.create({ data: { id: student, email: `${student}@example.test` } });
      await runAsUser(student, async () => {
        await saveAutoApply({ preferences: { titles: ["Analyst"], skills: [], countries: ["in"], cities: ["Pune"], remoteOk: true, level: "entry", employmentTypes: [] }, minTier: "GOOD", dailyLimit: 10, perCompanyLimit: 5, dryRun: false, answers: COMPLETE_ANSWERS });
        await giveConsent();
        await setAutoApplyEnabled(true);
        for (const [slot, posting] of postings.entries()) {
          const match = await prisma().jobMatch.create({ data: { sharedPostingId: posting.id, rank: slot + 1, status: "SCORED", score: 85, tier: "STRONG" } });
          const application = await prisma().application.create({ data: { title: posting.title, company: "Acme" } });
          // The student's id first, so a stranger's task is easy to pick out.
          await prisma().applyTask.create({ data: { id: `${student}-${slot}`, jobMatchId: match.id, sharedPostingId: posting.id, state: "READY", applicationId: application.id } });
        }
        for (const label of ["Chrome on Windows", "Chrome on a laptop"]) browsers.push({ student, token: (await createExtensionToken(label)).token });
      });
    }
  }, 600_000);

  afterAll(() => prisma().$disconnect());

  it("submits every application exactly once, each by its own student, with no request failing", async () => {
    const everyone: Leased[] = [];
    const started = performance.now();
    await Promise.all(browsers.map((browser) => browse(browser, everyone)));
    const seconds = (performance.now() - started) / 1000;

    const sorted = [...timings].sort((a, b) => a - b);
    const at = (share: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]);
    console.log(`${STUDENTS} students × ${TASKS} applications, ${browsers.length} browsers: ${timings.length} requests in ${seconds.toFixed(1)}s; median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms`);

    expect(failures).toEqual([]);
    expect(strangers).toEqual([]);
    const tasks = await raw().applyTask.findMany({ select: { id: true, userId: true, state: true, application: { select: { status: true } } } });
    expect(tasks).toHaveLength(STUDENTS * TASKS);
    for (const task of tasks) {
      expect(task.state, task.id).toBe("APPLIED");
      expect(task.application?.status, task.id).toBe("SENT");
      // Submitted once, by a browser of its own student.
      expect(submittedBy.get(task.id), task.id).toEqual([task.userId]);
    }
  }, 600_000);
});
