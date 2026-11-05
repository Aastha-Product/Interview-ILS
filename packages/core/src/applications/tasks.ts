import type { ApplicationTask, ScopedDb } from "@pathfinder/db";
import { getConfig } from "../config";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { getBoss } from "../queue/boss";
import {
  deadLetterQueue,
  QUEUE,
  QUEUE_SETTINGS,
  type PdfJobData,
  type QueueName,
  type TailorJobData,
} from "../queue/names";
import { istDay } from "../usage";
import type { TaskStateView } from "./types";

export interface TaskView {
  id: string;
  kind: "tailor" | "pdf";
  state: TaskStateView;
  reason: string;
  documentId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function toTaskView(task: ApplicationTask): TaskView {
  return {
    id: task.id,
    kind: task.kind === "TAILOR" ? "tailor" : "pdf",
    state: task.state.toLowerCase() as TaskStateView,
    reason: task.reason,
    documentId: task.documentId,
    createdAt: task.createdAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
  };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ACTIVE_STATES = ["QUEUED", "WORKING"] as const;

export interface TaskLimits {
  dailyTailorLimit: number;
  concurrentPerUser: number;
}

function limitsFromConfig(): TaskLimits {
  const config = getConfig();
  return {
    dailyTailorLimit: config.TAILOR_DAILY_LIMIT,
    concurrentPerUser: config.AI_CONCURRENT_PER_USER,
  };
}

async function assertNotBusy(db: ScopedDb, limits: TaskLimits): Promise<void> {
  const active = await db.applicationTask.count({ where: { state: { in: [...ACTIVE_STATES] } } });
  if (active >= limits.concurrentPerUser) {
    throw new UserFacingError(
      "AI_BUSY",
      `You already have ${limits.concurrentPerUser} drafts being prepared. Wait for one to finish, then try again.`,
      429,
      30,
    );
  }
}

async function assertUnderDailyLimit(db: ScopedDb, limits: TaskLimits, now: Date): Promise<void> {
  const dayStart = new Date(istDay(now).getTime() - IST_OFFSET_MS); // midnight IST, in UTC
  const created = await db.applicationTask.count({
    where: { kind: "TAILOR", createdAt: { gte: dayStart } },
  });
  if (created >= limits.dailyTailorLimit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((dayStart.getTime() + 24 * 60 * 60 * 1000 - now.getTime()) / 1000),
    );
    throw new UserFacingError(
      "DAILY_LIMIT",
      `You've prepared ${limits.dailyTailorLimit} drafts today, which is the daily limit. You can prepare more tomorrow.`,
      429,
      retryAfterSeconds,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

/** A job handed to the web app to run itself (demo sites have no worker). */
export type InlineJob =
  | { queue: typeof QUEUE.tailor; data: TailorJobData }
  | { queue: typeof QUEUE.pdf; data: PdfJobData };

let inlineDispatcher: ((job: InlineJob) => void) | null = null;

/**
 * Demo sites: run queued jobs inside the web app instead of sending them to pg-boss. The
 * dispatcher must not block (the web app runs the job after responding). Pass null to restore
 * the queue.
 */
export function setInlineDispatcher(dispatch: ((job: InlineJob) => void) | null): void {
  inlineDispatcher = dispatch;
}

async function sendJob(
  name: QueueName,
  data: TailorJobData | PdfJobData,
  singletonKey: string,
  groupId: string,
): Promise<string | null> {
  const settings = QUEUE_SETTINGS[name];
  const boss = await getBoss();
  return boss.send(
    name,
    { ...data },
    {
      singletonKey,
      priority: settings.priority,
      retryLimit: settings.retryLimit,
      expireInSeconds: settings.expireInSeconds,
      deadLetter: deadLetterQueue(name),
      group: { id: groupId },
    },
  );
}

/**
 * Creates (or returns) the task row for an idempotency key and puts a job on the queue.
 * A second request with the same key returns the existing task: double clicks enqueue once.
 * A FAILED task with the same key is re-queued (that's the student's "Try again").
 */
async function enqueue(
  db: ScopedDb,
  args: {
    kind: "TAILOR" | "PDF";
    applicationId: string;
    documentId: string | null;
    key: string;
    queue: QueueName;
    data: (taskId: string) => TailorJobData | PdfJobData;
    checkLimits: () => Promise<void>;
  },
): Promise<TaskView> {
  const log = getLogger().child({ op: "task.enqueue", kind: args.kind });
  const existing = await db.applicationTask.findUnique({ where: { idempotencyKey: args.key } });
  if (existing && existing.state !== "FAILED") return toTaskView(existing);

  await args.checkLimits();

  let task: ApplicationTask;
  let singletonKey = args.key;
  if (existing) {
    task = await db.applicationTask.update({
      where: { id: existing.id },
      data: {
        state: "QUEUED",
        reason: "",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        bossJobId: null,
      },
    });
    singletonKey = `${args.key}|retry-${Date.now()}`;
  } else {
    try {
      task = await db.applicationTask.create({
        data: {
          userId: db.userId,
          applicationId: args.applicationId,
          kind: args.kind,
          documentId: args.documentId,
          idempotencyKey: args.key,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.applicationTask.findUnique({ where: { idempotencyKey: args.key } });
      if (raced) return toTaskView(raced);
      throw error;
    }
  }

  try {
    if (inlineDispatcher) {
      inlineDispatcher({ queue: args.queue, data: args.data(task.id) } as InlineJob);
      return toTaskView(
        await db.applicationTask.update({
          where: { id: task.id },
          data: { bossJobId: `inline:${task.id}` },
        }),
      );
    }
    const bossJobId = await sendJob(args.queue, args.data(task.id), singletonKey, db.userId);
    // No id means pg-boss kept an older job with this singleton key. That job carries another
    // task's id, so nothing would ever pick this task up: fail it rather than leave it "queued".
    if (!bossJobId) throw new Error("queue returned no job id");
    task = await db.applicationTask.update({ where: { id: task.id }, data: { bossJobId } });
  } catch (error) {
    log.error({ taskId: task.id, errName: (error as Error).name }, "could not enqueue");
    await db.applicationTask.update({
      where: { id: task.id },
      data: {
        state: "FAILED",
        reason: "We couldn't start this just now. Please try again.",
        finishedAt: new Date(),
      },
    });
    throw new UserFacingError(
      "QUEUE_UNAVAILABLE",
      "We couldn't start this just now. Please try again in a minute.",
      503,
    );
  }
  return toTaskView(task);
}

/** Queues drafting (tailored resume + answers) for one application. */
export async function enqueueTailor(
  db: ScopedDb,
  applicationId: string,
  options: { limits?: TaskLimits; now?: Date } = {},
): Promise<TaskView> {
  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, jobListingId: true },
  });
  if (!application)
    throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);
  const profile = await db.profile.findFirst({ select: { version: true } });
  if (!profile)
    throw new UserFacingError(
      "NO_PROFILE",
      "Set up your profile first so we can draft from it.",
      409,
    );

  const limits = options.limits ?? limitsFromConfig();
  const now = options.now ?? new Date();
  const key = `${db.userId}|${application.jobListingId}|tailor|${profile.version}`;
  return enqueue(db, {
    kind: "TAILOR",
    applicationId,
    documentId: null,
    key,
    queue: QUEUE.tailor,
    data: (taskId) => ({ userId: db.userId, applicationId, taskId }),
    checkLimits: async () => {
      await assertNotBusy(db, limits);
      await assertUnderDailyLimit(db, limits, now);
    },
  });
}

/** Queues a PDF render for one resume version. The worker passes fromWorker: the student's cap doesn't apply. */
export async function enqueuePdf(
  db: ScopedDb,
  documentId: string,
  options: { fromWorker?: boolean; limits?: TaskLimits } = {},
): Promise<TaskView> {
  const document = await db.generatedDocument.findUnique({
    where: { id: documentId },
    select: { id: true, applicationId: true, version: true, kind: true },
  });
  if (!document || document.kind !== "RESUME") {
    throw new UserFacingError("DOCUMENT_NOT_FOUND", "We couldn't find that resume draft.", 404);
  }
  const key = `${db.userId}|${documentId}|pdf|${document.version}`;
  return enqueue(db, {
    kind: "PDF",
    applicationId: document.applicationId,
    documentId,
    key,
    queue: QUEUE.pdf,
    data: (taskId) => ({
      userId: db.userId,
      applicationId: document.applicationId,
      documentId,
      taskId,
    }),
    checkLimits: async () => {
      if (!options.fromWorker) await assertNotBusy(db, options.limits ?? limitsFromConfig());
    },
  });
}

/** Tasks for one application, newest first. */
export async function getTasks(db: ScopedDb, applicationId: string): Promise<TaskView[]> {
  const tasks = await db.applicationTask.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
  });
  return tasks.map(toTaskView);
}

// ---------- worker helpers ----------

/**
 * Marks a task as being worked on. Returns false when the job should be skipped: the task is gone
 * (its application was deleted) or already finished (a redelivered job must not draft twice).
 */
export async function markTaskWorking(
  db: ScopedDb,
  taskId: string,
  attempt: number,
): Promise<boolean> {
  const task = await db.applicationTask.findUnique({
    where: { id: taskId },
    select: { startedAt: true, state: true },
  });
  if (!task || task.state === "DONE" || task.state === "NEEDS_INPUT") return false;
  await db.applicationTask.update({
    where: { id: taskId },
    data: { state: "WORKING", attempts: attempt, startedAt: task.startedAt ?? new Date() },
  });
  return true;
}

export async function markTaskDone(
  db: ScopedDb,
  taskId: string,
  options: { needsInput?: boolean; reason?: string; documentId?: string } = {},
): Promise<void> {
  await db.applicationTask.updateMany({
    where: { id: taskId },
    data: {
      state: options.needsInput ? "NEEDS_INPUT" : "DONE",
      reason: options.reason ?? "",
      finishedAt: new Date(),
      ...(options.documentId ? { documentId: options.documentId } : {}),
    },
  });
}

/** `reason` is shown to the student: plain English, never error internals. */
export async function markTaskFailed(db: ScopedDb, taskId: string, reason: string): Promise<void> {
  await db.applicationTask.updateMany({
    where: { id: taskId },
    data: { state: "FAILED", reason, finishedAt: new Date() },
  });
}
