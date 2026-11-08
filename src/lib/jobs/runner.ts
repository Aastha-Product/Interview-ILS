import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Client as PgClient } from "pg";
import type { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { JobStatus } from "@/generated/prisma/enums";
import { loadAiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { providerOption } from "@/lib/ai/provider-options";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { managedMode, studentMessage } from "@/lib/managed";
import { runAsUser } from "@/lib/owner/context";
import { currentUserId } from "@/lib/owner/current";
import { prisma, systemPrisma } from "@/lib/prisma";

// Long AI tasks run as background jobs (E6-7): the request that starts one
// returns at once with its id, the work goes on in the background, and the
// page follows its named steps (/api/jobs/[id]/events). Progress lives in
// the Job table, so a reloaded page can pick the job up again.
//
// Pathfinder (private accounts): every queued job remembers the student who started it and runs
// as them (runAsUser), so it reads their settings and writes their rows. Only that student can
// cancel it.
//
// Pathfinder (P0 task 3): the Job table is the queue, so jobs survive a restart and can run in
// another process than the page that started them. A process that runs jobs (PATHFINDER_ROLE all
// or worker) claims queued ones with FOR UPDATE SKIP LOCKED, so two workers never take the same
// job; students take turns, and each may have only a few running at once. Progress, new jobs and
// cancels reach the other processes through Postgres LISTEN/NOTIFY (startJobEvents); a worker
// also polls, in case a notification was missed. A running job's heartbeat says its worker is
// alive; one gone quiet counts as interrupted.

export type JobContext = {
  /** The job's own id, e.g. to link it to the application it makes. */
  id: string;
  /** Names the step now in progress, e.g. "Reading the posting". */
  step: (name: string) => Promise<void>;
  /** Aborts when the job is cancelled; pass it on to AI calls. */
  signal: AbortSignal;
};

export type JobDefinition<I, R> = {
  type: string;
  input: z.ZodType<I>;
  result: z.ZodType<R>;
  /**
   * Does the work. It may run again on Retry with the same input, so it must
   * write its data idempotently (upsert, or replace in one transaction).
   */
  run: (input: I, context: JobContext) => Promise<R>;
};

/** What a page learns about a job. */
export type JobView<R = unknown> = {
  id: string;
  type: string;
  status: JobStatus;
  step: string | null;
  error: string | null;
  result: R | null;
};

export const JOB_MESSAGES = {
  failed: "Something went wrong while working on this. Try again.",
  interrupted: "Dossier restarted before this finished. Try again.",
  cancelled: "Cancelled.",
} as const;

/** Jobs at once: local models do best with one request at a time (PRD §11). */
const LOCAL_CONCURRENCY = 1;
/** Jobs at once in one process with a hosted AI, unless PATHFINDER_JOB_CONCURRENCY says otherwise. */
const HOSTED_CONCURRENCY = 10;
/** Jobs one student may have running at once, unless PATHFINDER_JOBS_PER_STUDENT says otherwise. */
const PER_STUDENT = 2;

/** How often a worker looks for queued jobs it wasn't told about. */
const POLL_MS = 2_000;
/** How often a worker renews its running jobs' heartbeat and checks for cancels from elsewhere. */
const HEARTBEAT_MS = 5_000;
/** A running job whose heartbeat is older than this lost its worker. */
const STALE_MS = 60_000;
/** How often a worker looks for such jobs. */
const REAP_MS = 30_000;

/** The channel the processes tell each other about jobs on. */
const CHANNEL = "pathfinder_jobs";

type Listener = (job: JobView) => void;

/** What one process tells the others: a job changed, a job was queued, or a cancel for a running job. */
type JobSignal = { kind: "change" | "cancel"; id: string } | { kind: "queued" };

type RunnerState = {
  definitions: Map<string, JobDefinition<unknown, unknown>>;
  running: Map<string, { controller: AbortController; userId: string }>;
  listeners: Map<string, Set<Listener>>;
  /** This process, in the Job table and in its notifications. */
  workerId: string;
  claiming: boolean;
  /** Something may have been queued while a claim was under way: claim again after it. */
  again: boolean;
  timers: NodeJS.Timeout[];
  events?: { stop: () => void };
};

// On globalThis, so the dev server's hot reloads keep one runner.
const globalForJobs = globalThis as unknown as { jobRunner?: RunnerState };
const state: RunnerState = (globalForJobs.jobRunner ??= {
  definitions: new Map(),
  running: new Map(),
  listeners: new Map(),
  workerId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
  claiming: false,
  again: false,
  timers: [],
});

/**
 * One of the runner's settings. A running server checked its environment at startup; a test or
 * script with only part of one gets the default instead of failing here.
 */
function setting<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** What this process does (PATHFINDER_ROLE): all (the default), web or worker. */
export function processRole(): "all" | "web" | "worker" {
  return setting(() => env.PATHFINDER_ROLE) ?? "all";
}

/** Whether this process runs background jobs and schedules. */
export function runsJobs(): boolean {
  return processRole() !== "web";
}

/** Registers a job type; call at module level where the job is defined. */
export function defineJob<I, R>(definition: JobDefinition<I, R>): JobDefinition<I, R> {
  state.definitions.set(definition.type, definition as JobDefinition<unknown, unknown>);
  return definition;
}

const VIEW_FIELDS = { id: true, type: true, status: true, step: true, error: true, result: true } as const;

export async function getJob(id: string): Promise<JobView | null> {
  return prisma.job.findUnique({ where: { id }, select: VIEW_FIELDS });
}

/** The newest job for something on screen, e.g. "application:<id>", to reattach after a reload. */
export async function findLatestJob(key: string): Promise<JobView | null> {
  return prisma.job.findFirst({ where: { key }, orderBy: { createdAt: "desc" }, select: VIEW_FIELDS });
}

/** Jobs for something on screen that are still queued or running, oldest first, with their input. */
export async function findUnfinishedJobs(key: string): Promise<{ id: string; type: string; input: unknown }[]> {
  return prisma.job.findMany({
    where: { key, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, input: true },
  });
}

export function isFinished(job: Pick<JobView, "status">): boolean {
  return job.status === JobStatus.DONE || job.status === JobStatus.FAILED;
}

/**
 * Queues a job and returns its id right away. A job that works on an
 * application names it, so deleting the application deletes the job too.
 */
export async function startJob<I, R>(
  definition: JobDefinition<I, R>,
  input: NoInfer<I>,
  options: { key?: string; applicationId?: string } = {},
): Promise<string> {
  defineJob(definition);
  const job = await prisma.job.create({
    data: {
      type: definition.type,
      key: options.key,
      applicationId: options.applicationId,
      input: definition.input.parse(input) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await queued();
  return job.id;
}

/** Runs a failed job again, as the same job with the same input. */
export async function retryJob(id: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id, status: JobStatus.FAILED },
    data: {
      status: JobStatus.QUEUED,
      step: null,
      error: null,
      result: Prisma.DbNull,
      startedAt: null,
      finishedAt: null,
      workerId: null,
      heartbeatAt: null,
      cancelRequested: false,
    },
  });
  if (count === 0) return false;
  await notify(id);
  await queued();
  return true;
}

/** Stops a queued or running job; it ends as failed with "Cancelled.". */
export async function cancelJob(id: string): Promise<void> {
  // Only the student who started a job can stop it: the scoped client sees only their jobs.
  const { count } = await prisma.job.updateMany({
    where: { id, status: JobStatus.QUEUED },
    data: { status: JobStatus.FAILED, error: JOB_MESSAGES.cancelled, finishedAt: new Date() },
  });
  if (count > 0) return notify(id);
  const userId = await currentUserId();
  const running = state.running.get(id);
  if (running) {
    if (running.userId === userId) running.controller.abort();
    return;
  }
  // Running in another process: ask its worker, which also finds the request with its heartbeat.
  const asked = await prisma.job.updateMany({ where: { id, status: JobStatus.RUNNING }, data: { cancelRequested: true } });
  if (asked.count > 0) await signal({ kind: "cancel", id });
}

/** Stops every queued or running job that works on an application, e.g. before it's deleted. */
export async function cancelApplicationJobs(applicationId: string): Promise<void> {
  const unfinished = await prisma.job.findMany({
    where: { applicationId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    select: { id: true },
  });
  for (const job of unfinished) await cancelJob(job.id);
}

/** Calls `listener` with the job's state after every change; returns how to stop. */
export function subscribeJob(id: string, listener: Listener): () => void {
  const listeners = state.listeners.get(id) ?? new Set();
  listeners.add(listener);
  state.listeners.set(id, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) state.listeners.delete(id);
  };
}

/** Tells this process's listeners and the other processes that a job changed. */
async function notify(id: string): Promise<void> {
  await Promise.all([tellListeners(id), signal({ kind: "change", id })]);
}

/**
 * Sends the job's state to whoever follows it in this process. The page that subscribed already
 * checked that the job is the student's, so this reads it without a student, which also works
 * for a change another process reported.
 */
async function tellListeners(id: string): Promise<void> {
  const listeners = state.listeners.get(id);
  if (!listeners?.size) return;
  const job = await systemPrisma.job.findUnique({ where: { id }, select: VIEW_FIELDS });
  if (job) for (const listener of listeners) listener(job);
}

/** Tells the other processes about a job; best effort, as a worker also polls. */
async function signal(message: JobSignal): Promise<void> {
  try {
    const payload = JSON.stringify({ ...message, from: state.workerId });
    await systemPrisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (error) {
    logServerError("job events", error);
  }
}

/** A job was queued: run it here if this process runs jobs, and tell the workers. */
async function queued(): Promise<void> {
  void claim();
  await signal({ kind: "queued" });
}

/** Records how a job ended; one deleted meanwhile (its application, a discarded import) just ends. */
async function finish(
  id: string,
  data: { status: JobStatus; result?: Prisma.InputJsonValue; error?: string },
): Promise<void> {
  const { count } = await prisma.job.updateMany({ where: { id }, data: { ...data, finishedAt: new Date() } });
  if (count > 0) await notify(id);
}

/** Jobs this process runs at once: one for a local model, more for a hosted one. */
async function concurrency(): Promise<number> {
  try {
    if (providerOption((await loadAiConfig()).provider).local) return LOCAL_CONCURRENCY;
    return setting(() => env.PATHFINDER_JOB_CONCURRENCY) ?? HOSTED_CONCURRENCY;
  } catch {
    return LOCAL_CONCURRENCY;
  }
}

/**
 * Takes as many queued jobs as this process has room for and starts them. Students take turns:
 * everyone's oldest job comes before anyone's second, and no one gets more than PER_STUDENT
 * running. Locked rows are skipped, so two workers claiming at once take different jobs.
 */
async function claim(): Promise<void> {
  if (!runsJobs()) return;
  if (state.claiming) {
    state.again = true;
    return;
  }
  state.claiming = true;
  try {
    do {
      state.again = false;
      // The AI provider sets the pace; it can be each student's own (self-hosted), so the next
      // job's student's counts, as before.
      const next = await systemPrisma.job.findFirst({
        where: { status: JobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      if (!next) break;
      const room = (await runAsUser(next.userId, concurrency)) - state.running.size;
      if (room <= 0) break;
      const perStudent = setting(() => env.PATHFINDER_JOBS_PER_STUDENT) ?? PER_STUDENT;
      // Prisma keeps times in UTC in columns without a time zone, so now() is turned into UTC too.
      const claimed = await systemPrisma.$queryRaw<{ id: string; userId: string }[]>`
        WITH turns AS (
          SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt") AS turn
          FROM "Job" WHERE status = 'QUEUED'
        ),
        busy AS (
          -- A job whose worker went quiet doesn't hold up its student's queue while it waits to be marked interrupted.
          SELECT "userId", count(*) AS running FROM "Job"
          WHERE status = 'RUNNING' AND "heartbeatAt" > (now() AT TIME ZONE 'UTC') - make_interval(secs => ${STALE_MS / 1000})
          GROUP BY "userId"
        ),
        picked AS (
          SELECT j.id FROM "Job" j
          JOIN turns t ON t.id = j.id
          LEFT JOIN busy b ON b."userId" = j."userId"
          WHERE j.status = 'QUEUED' AND t.turn + coalesce(b.running, 0) <= ${perStudent}
          ORDER BY t.turn, j."createdAt"
          LIMIT ${room}
          FOR UPDATE OF j SKIP LOCKED
        )
        UPDATE "Job" SET status = 'RUNNING', "startedAt" = utc.now, "heartbeatAt" = utc.now, "workerId" = ${state.workerId}, "updatedAt" = utc.now
        FROM picked, (SELECT now() AT TIME ZONE 'UTC' AS now) utc
        WHERE "Job".id = picked.id
        RETURNING "Job".id, "Job"."userId"`;
      for (const job of claimed) launch(job.id, job.userId);
      // A full batch may have left more behind.
      if (claimed.length === room) state.again = true;
    } while (state.again);
  } catch (error) {
    logServerError("job queue", error);
  } finally {
    state.claiming = false;
  }
}

/** Claims queued jobs now, where this process runs them (a worker also does this on its own). */
export const claimQueuedJobs = claim;

function launch(id: string, userId: string): void {
  const controller = new AbortController();
  state.running.set(id, { controller, userId });
  void runAsUser(userId, () => execute(id, userId, controller)).finally(() => {
    state.running.delete(id);
    void claim();
  });
}

async function execute(id: string, userId: string, controller: AbortController): Promise<void> {
  try {
    // The claim marked it running; deleted since, it throws and ends below.
    const job = await prisma.job.findUniqueOrThrow({ where: { id }, select: { type: true, input: true } });
    await notify(id);
    // Job types register when their module loads; make sure they all have.
    await import("./definitions");
    const definition = state.definitions.get(job.type);
    if (!definition) throw new Error(`No job type "${job.type}" is defined.`);

    const result = await definition.run(definition.input.parse(job.input), {
      id,
      signal: controller.signal,
      step: async (name) => {
        // Deleted meanwhile: there's no one left to do it for.
        const { count } = await prisma.job.updateMany({ where: { id }, data: { step: name } });
        if (count === 0) controller.abort();
        else await notify(id);
      },
    });
    await finish(id, { status: JobStatus.DONE, result: definition.result.parse(result) as Prisma.InputJsonValue });
  } catch (error) {
    // Deleted before it started: nothing to report.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    // AI failures already say what to do; anything else is logged and kept vague. Pathfinder, managed
    // mode: the student can't fix the AI's setup, so its messages are plain ones, and the server
    // logs the failure for whoever runs it (the message names the problem, never the request).
    const message = controller.signal.aborted
      ? JOB_MESSAGES.cancelled
      : error instanceof AiError
        ? studentMessage(error.message)
        : JOB_MESSAGES.failed;
    if (!controller.signal.aborted && (!(error instanceof AiError) || managedMode())) logServerError(`job ${id}`, error);
    try {
      await finish(id, { status: JobStatus.FAILED, error: message });
    } catch (cause) {
      logServerError(`job ${id}`, cause);
    }
    await failIfUnfinished(id, userId, message);
  }
}

/**
 * Last resort after a failure: a job still queued or running here would show its progress
 * forever (for example when the failure was the scoped database itself). Marks it failed
 * directly, for its own student only, so the page offers Retry.
 */
async function failIfUnfinished(id: string, userId: string, error: string): Promise<void> {
  try {
    await systemPrisma.job.updateMany({
      where: { id, userId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      data: { status: JobStatus.FAILED, error, finishedAt: new Date() },
    });
  } catch (cause) {
    logServerError(`job ${id}`, cause);
  }
}

/**
 * Running jobs whose worker went quiet (it stopped or crashed) can't finish, so they're marked
 * failed and the page offers Retry. Queued jobs wait for a worker: the queue keeps them.
 */
export async function recoverInterruptedJobs(now = new Date()): Promise<number> {
  // Every student's jobs: this runs for no one in particular.
  const stale = new Date(now.getTime() - STALE_MS);
  const { count } = await systemPrisma.job.updateMany({
    where: { status: JobStatus.RUNNING, OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: stale } }] },
    data: { status: JobStatus.FAILED, error: JOB_MESSAGES.interrupted, finishedAt: now },
  });
  return count;
}

/** Renews the heartbeat of the jobs running here, and stops those cancelled from elsewhere. */
async function heartbeat(): Promise<void> {
  const ids = [...state.running.keys()];
  if (ids.length === 0) return;
  await systemPrisma.job.updateMany({ where: { id: { in: ids }, status: JobStatus.RUNNING }, data: { heartbeatAt: new Date() } });
  const cancelled = await systemPrisma.job.findMany({ where: { id: { in: ids }, cancelRequested: true }, select: { id: true } });
  for (const { id } of cancelled) state.running.get(id)?.controller.abort();
}

/**
 * Called once at startup where this process runs jobs: claims what's queued, then keeps looking,
 * renews heartbeats and marks jobs whose worker went quiet as interrupted.
 */
export function startWorker(): void {
  if (!runsJobs() || state.timers.length > 0) return;
  const every = (ms: number, task: () => Promise<unknown>, where: string) => {
    const timer = setInterval(() => void task().catch((error: unknown) => logServerError(where, error)), ms);
    // Don't keep the process alive just for this.
    timer.unref?.();
    state.timers.push(timer);
  };
  every(POLL_MS, claim, "job queue");
  every(HEARTBEAT_MS, heartbeat, "job heartbeat");
  every(REAP_MS, recoverInterruptedJobs, "job recovery");
  void recoverInterruptedJobs()
    .catch((error: unknown) => logServerError("job recovery", error))
    .then(() => claim());
}

/**
 * Called once at startup in every process: listens for the other processes' job news, so a page
 * follows a job a worker runs, a worker hears of new jobs at once, and a cancel reaches the worker
 * running the job. Reconnects when the connection drops.
 */
export function startJobEvents(): void {
  if (state.events) return;
  let stopped = false;
  let client: PgClient | undefined;
  const connect = async () => {
    const { Client } = await import("pg");
    const next = new Client({ connectionString: env.DATABASE_URL });
    client = next;
    const retry = () => {
      if (stopped || client !== next) return;
      client = undefined;
      void next.end().catch(() => {});
      setTimeout(() => void connect().catch(onError), 5_000).unref?.();
    };
    next.on("error", (error) => {
      logServerError("job events", error);
      retry();
    });
    next.on("end", retry);
    next.on("notification", (message) => void heard(message.payload));
    await next.connect();
    await next.query(`LISTEN ${CHANNEL}`);
  };
  const onError = (error: unknown) => {
    logServerError("job events", error);
    if (!stopped) setTimeout(() => void connect().catch(onError), 5_000).unref?.();
  };
  void connect().catch(onError);
  state.events = {
    stop: () => {
      stopped = true;
      void client?.end().catch(() => {});
    },
  };
}

/** One notification from another process. */
async function heard(payload: string | undefined): Promise<void> {
  try {
    const message = JSON.parse(payload ?? "{}") as JobSignal & { from?: string };
    if (message.from === state.workerId) return;
    if (message.kind === "queued") await claim();
    else if (message.kind === "cancel") state.running.get(message.id)?.controller.abort();
    else if (message.kind === "change") await tellListeners(message.id);
  } catch (error) {
    logServerError("job events", error);
  }
}
