import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import { contextUserId, runAsUser } from "@/lib/owner/context";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { cancelApplicationJobs, cancelJob, claimQueuedJobs, defineJob, getJob, recoverInterruptedJobs, retryJob, startJob, subscribeJob } from "./runner";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const ai = vi.hoisted(() => ({ provider: "LOCAL" }));
// Pathfinder (P0 task 3): what this process does, and how many jobs a student may run at once.
const runner = vi.hoisted(() => ({ role: undefined as "all" | "web" | "worker" | undefined, perStudent: undefined as number | undefined }));
vi.mock("@/lib/env", () => ({
  env: {
    get PATHFINDER_ROLE() {
      return runner.role;
    },
    get PATHFINDER_JOBS_PER_STUDENT() {
      return runner.perStudent;
    },
  },
}));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: ai.provider }) }));
vi.spyOn(console, "error").mockImplementation(() => {});

const prisma = () => db.client!;

/** Waits until `check` passes, for work that runs in the background. */
async function eventually(check: () => Promise<void>, timeout = 3000) {
  const started = Date.now();
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
const status = async (id: string) => expect((await getJob(id))?.status);

// A job whose run waits until the test lets it go.
const gates = new Map<string, () => void>();
const gated = defineJob({
  type: "test-gated",
  input: z.object({ name: z.string(), fail: z.enum(["no", "error", "ai"]).default("no") }),
  result: z.object({ greeting: z.string() }),
  async run({ name, fail }, { step, signal }) {
    await step("Waiting");
    await new Promise<void>((resolve, reject) => {
      // Cancelled while reporting its step: the abort event has already fired.
      if (signal.aborted) return reject(signal.reason);
      gates.set(name, resolve);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    await step("Greeting");
    if (fail === "error") throw new Error("database exploded: secret details");
    if (fail === "ai") throw AiError.of("unreachable");
    return { greeting: `Hello, ${name}` };
  },
});
// A job that says which student it ran as (Pathfinder: private accounts).
const whoAmI = defineJob({
  type: "test-who-am-i",
  input: z.object({}),
  result: z.object({ greeting: z.string() }),
  async run() {
    return { greeting: contextUserId() ?? "nobody" };
  },
});

// The first job in a process loads every job type before its first step, which can take a few seconds.
const release = (name: string) => eventually(async () => {
  const open = gates.get(name);
  expect(open).toBeDefined();
  gates.delete(name);
  open!();
}, 10_000);

beforeEach(async () => {
  await resetDatabase(prisma());
  // A cancelled job's gate is never opened: a later job of the same name must get its own.
  gates.clear();
  ai.provider = "LOCAL";
  runner.role = undefined;
  runner.perStudent = undefined;
});
afterAll(() => prisma().$disconnect());

describe("the job runner", () => {
  it("runs a job in the background with named steps and keeps its result (E6-7)", async () => {
    const seen: string[] = [];
    const id = await startJob(gated, { name: "Jane", fail: "no" }, { key: "application:1" });
    const stop = subscribeJob(id, (job) => seen.push(`${job.status}${job.step ? ` · ${job.step}` : ""}`));
    await eventually(async () => (await status(id)).toBe("RUNNING"));
    await release("Jane");
    await eventually(async () => (await status(id)).toBe("DONE"));
    stop();
    expect(await getJob(id)).toMatchObject({ step: "Greeting", error: null, result: { greeting: "Hello, Jane" } });
    expect(seen).toContain("RUNNING · Waiting");
    expect(seen.at(-1)).toBe("DONE · Greeting");
    const row = await prisma().job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ type: "test-gated", key: "application:1", input: { name: "Jane", fail: "no" } });
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();
  });

  it("keeps AI errors' plain words and hides everything else", async () => {
    const ai = await startJob(gated, { name: "Ai", fail: "ai" });
    const other = await startJob(gated, { name: "Other", fail: "error" });
    await release("Ai");
    await eventually(async () => (await status(ai)).toBe("FAILED"));
    await release("Other");
    await eventually(async () => (await status(other)).toBe("FAILED"));
    expect((await getJob(ai))?.error).toBe("Couldn't reach the server. Check the address and that it's running.");
    expect((await getJob(other))?.error).toBe("Something went wrong while working on this. Try again.");
  });

  it("marks a job failed even when the student's own database calls fail, instead of leaving it running", async () => {
    const id = await startJob(gated, { name: "Broken", fail: "no" });
    // Claimed jobs show as running before their handler starts; wait until it's at work.
    await eventually(async () => expect((await getJob(id))?.step).toBe("Waiting"));
    // From here the scoped client can't update jobs: the next step and the normal finish both fail.
    const updateMany = vi.spyOn(prisma().job, "updateMany").mockRejectedValue(new Error("scope lost"));
    try {
      await release("Broken");
      await eventually(async () => {
        const job = await rawClientOf(prisma()).job.findUnique({ where: { id } });
        expect(job).toMatchObject({ status: "FAILED", error: "Something went wrong while working on this. Try again." });
      });
    } finally {
      updateMany.mockRestore();
    }
  });

  it("retries a failed job as the same job, without a duplicate", async () => {
    const id = await startJob(gated, { name: "Retry", fail: "ai" });
    await release("Retry");
    await eventually(async () => (await status(id)).toBe("FAILED"));
    expect(await retryJob(id)).toBe(true);
    await eventually(async () => (await status(id)).toBe("RUNNING"));
    expect(await retryJob(id)).toBe(false);
    await release("Retry");
    await eventually(async () => (await status(id)).toBe("FAILED"));
    expect(await prisma().job.count()).toBe(1);
  });

  it("runs one job at a time for a local model, more for hosted ones", async () => {
    const first = await startJob(gated, { name: "First", fail: "no" });
    const second = await startJob(gated, { name: "Second", fail: "no" });
    await eventually(async () => (await status(first)).toBe("RUNNING"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    (await status(second)).toBe("QUEUED");
    await release("First");
    await eventually(async () => (await status(second)).toBe("RUNNING"));
    await release("Second");
    await eventually(async () => (await status(second)).toBe("DONE"));

    ai.provider = "ANTHROPIC";
    const a = await startJob(gated, { name: "A", fail: "no" });
    const b = await startJob(gated, { name: "B", fail: "no" });
    await eventually(async () => {
      (await status(a)).toBe("RUNNING");
      (await status(b)).toBe("RUNNING");
    });
    await release("A");
    await release("B");
    await eventually(async () => (await status(b)).toBe("DONE"));
  });

  it("cancels an application's unfinished jobs, and only those", async () => {
    await prisma().application.createMany({ data: [{ id: "app-1" }, { id: "app-2" }] });
    const running = await startJob(gated, { name: "Mine", fail: "no" }, { applicationId: "app-1" });
    const queued = await startJob(gated, { name: "Mine too", fail: "no" }, { applicationId: "app-1" });
    const other = await startJob(gated, { name: "Theirs", fail: "no" }, { applicationId: "app-2" });
    await eventually(async () => (await status(running)).toBe("RUNNING"));
    await cancelApplicationJobs("app-1");
    await eventually(async () => {
      expect(await getJob(running)).toMatchObject({ status: "FAILED", error: "Cancelled." });
      expect(await getJob(queued)).toMatchObject({ status: "FAILED", error: "Cancelled." });
    });
    expect(await prisma().job.findUniqueOrThrow({ where: { id: other } })).toMatchObject({ applicationId: "app-2" });
    await eventually(async () => (await status(other)).toBe("RUNNING"));
    await release("Theirs");
    await eventually(async () => (await status(other)).toBe("DONE"));
  });

  it("ends a job deleted while it runs without an error", async () => {
    const id = await startJob(gated, { name: "Deleted", fail: "no" });
    // Claimed jobs show as running before their handler starts; wait until it's at work.
    await eventually(async () => expect((await getJob(id))?.step).toBe("Waiting"));
    vi.mocked(console.error).mockClear();
    await prisma().job.delete({ where: { id } });
    await release("Deleted");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("cancels a running or a queued job", async () => {
    const running = await startJob(gated, { name: "Running", fail: "no" });
    const queued = await startJob(gated, { name: "Queued", fail: "no" });
    await eventually(async () => (await status(running)).toBe("RUNNING"));
    await cancelJob(queued);
    await cancelJob(running);
    await eventually(async () => {
      expect(await getJob(running)).toMatchObject({ status: "FAILED", error: "Cancelled." });
      expect(await getJob(queued)).toMatchObject({ status: "FAILED", error: "Cancelled." });
    });
  });

  it("runs each job as the student who started it, out of other students' sight", async () => {
    await rawClientOf(prisma()).user.create({ data: { id: "other-student", email: "other@example.test" } });
    const id = await runAsUser("other-student", () => startJob(whoAmI, {}));
    await eventually(async () => {
      expect(await runAsUser("other-student", () => getJob(id))).toMatchObject({ status: "DONE", result: { greeting: "other-student" } });
    });
    expect(await getJob(id)).toBeNull();
  });

  it("lets only the student who started a job cancel it", async () => {
    await rawClientOf(prisma()).user.create({ data: { id: "other-student", email: "other@example.test" } });
    const running = await startJob(gated, { name: "Mine", fail: "no" });
    const queued = await startJob(gated, { name: "Mine too", fail: "no" });
    await eventually(async () => (await status(running)).toBe("RUNNING"));
    await runAsUser("other-student", async () => {
      await cancelJob(running);
      await cancelJob(queued);
    });
    await release("Mine");
    await eventually(async () => (await status(running)).toBe("DONE"));
    await release("Mine too");
    await eventually(async () => (await status(queued)).toBe("DONE"));
  });

  it("marks running jobs whose worker went quiet as failed, and keeps queued ones for a worker (P0 task 3)", async () => {
    const now = new Date();
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    await prisma().job.createMany({
      data: [
        { id: "no-heartbeat", type: "test-gated", status: "RUNNING", input: {} },
        { id: "quiet", type: "test-gated", status: "RUNNING", input: {}, heartbeatAt: ago(120) },
        { id: "alive", type: "test-gated", status: "RUNNING", input: {}, heartbeatAt: ago(10) },
        { id: "waiting", type: "test-who-am-i", status: "QUEUED", input: {} },
        { id: "done", type: "test-gated", status: "DONE", input: {} },
      ],
    });
    runner.role = "web"; // Nothing here runs the queued one, so it stays queued.
    expect(await recoverInterruptedJobs(now)).toBe(2);
    const statuses = Object.fromEntries((await prisma().job.findMany({ select: { id: true, status: true, error: true } })).map((job) => [job.id, job]));
    expect(statuses["no-heartbeat"]).toMatchObject({ status: "FAILED", error: "Dossier restarted before this finished. Try again." });
    expect(statuses.quiet).toMatchObject({ status: "FAILED" });
    expect(statuses.alive).toMatchObject({ status: "RUNNING" });
    expect(statuses.waiting).toMatchObject({ status: "QUEUED" });
    expect(statuses.done).toMatchObject({ status: "DONE" });
  });

  it("leaves jobs started on a web process in the queue, where a worker takes them (P0 task 3)", async () => {
    ai.provider = "ANTHROPIC";
    runner.role = "web";
    const id = await startJob(whoAmI, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    (await status(id)).toBe("QUEUED");
    runner.role = "worker";
    await claimQueuedJobs();
    await eventually(async () => expect(await getJob(id)).toMatchObject({ status: "DONE", result: { greeting: "test-student" } }));
    const row = await rawClientOf(prisma()).job.findUniqueOrThrow({ where: { id } });
    expect(row.workerId).toMatch(/:/);
    // In UTC like every other time Prisma keeps, whatever the database's own time zone.
    expect(Math.abs(row.heartbeatAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(row.startedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("lets students take turns, with only a few jobs each at once (P0 task 3)", async () => {
    ai.provider = "ANTHROPIC";
    await rawClientOf(prisma()).user.create({ data: { id: "other-student", email: "other@example.test" } });
    // Three jobs from the test student and one from another, queued before anything runs.
    runner.role = "web";
    const first = await startJob(gated, { name: "One", fail: "no" });
    const second = await startJob(gated, { name: "Two", fail: "no" });
    const third = await startJob(gated, { name: "Three", fail: "no" });
    const theirs = await runAsUser("other-student", () => startJob(whoAmI, {}));
    runner.role = "all";
    await claimQueuedJobs();
    await eventually(async () => {
      (await status(first)).toBe("RUNNING");
      (await status(second)).toBe("RUNNING");
      expect(await runAsUser("other-student", () => getJob(theirs))).toMatchObject({ status: "DONE" });
    });
    // Two at once per student: the third waits until one of theirs is done.
    (await status(third)).toBe("QUEUED");
    await release("One");
    await eventually(async () => (await status(third)).toBe("RUNNING"));
    await release("Two");
    await release("Three");
    await eventually(async () => (await status(third)).toBe("DONE"));
  });

  it("doesn't let a stopped worker's jobs hold up their student's queue (P0 task 3)", async () => {
    ai.provider = "ANTHROPIC";
    const quiet = new Date(Date.now() - 120_000);
    await prisma().job.createMany({
      data: [
        { type: "test-gated", status: "RUNNING", input: {}, workerId: "gone", heartbeatAt: quiet },
        { type: "test-gated", status: "RUNNING", input: {}, workerId: "gone", heartbeatAt: quiet },
      ],
    });
    const id = await startJob(whoAmI, {});
    await eventually(async () => (await status(id)).toBe("DONE"));
  });

  it("asks the worker running a job elsewhere to cancel it, only for its own student (P0 task 3)", async () => {
    await rawClientOf(prisma()).user.create({ data: { id: "other-student", email: "other@example.test" } });
    await prisma().job.create({ data: { id: "remote", type: "test-gated", status: "RUNNING", input: {}, workerId: "elsewhere", heartbeatAt: new Date() } });
    await runAsUser("other-student", () => cancelJob("remote"));
    expect((await rawClientOf(prisma()).job.findUniqueOrThrow({ where: { id: "remote" } })).cancelRequested).toBe(false);
    await cancelJob("remote");
    expect(await rawClientOf(prisma()).job.findUniqueOrThrow({ where: { id: "remote" } })).toMatchObject({ status: "RUNNING", cancelRequested: true });
  });
});
