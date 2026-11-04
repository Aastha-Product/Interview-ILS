import { PgBoss } from "pg-boss";
import { getLogger } from "../logger";
import { deadLetterQueue, QUEUE, QUEUE_SETTINGS, type QueueName } from "./names";

/**
 * One pg-boss instance per process, with its tables in the "pgboss" schema of the main database.
 * The worker runs maintenance (supervise) and schedules; the web app only sends jobs.
 * Job payloads hold ids only, and are never logged.
 */

export interface BossOptions {
  /** True in the worker process. Defaults to PATHFINDER_SERVICE === "worker". */
  supervise?: boolean;
}

let starting: Promise<PgBoss> | undefined;

export function getBoss(options: BossOptions = {}): Promise<PgBoss> {
  starting ??= (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    const worker = options.supervise ?? process.env.PATHFINDER_SERVICE === "worker";
    const boss = new PgBoss({
      connectionString,
      schema: "pgboss",
      application_name: worker ? "pathfinder-worker" : "pathfinder-web",
      max: worker ? 10 : 3,
      supervise: worker,
      schedule: worker,
    });
    boss.on("error", (error: Error & { code?: string }) => {
      getLogger().error({ errName: error.name, errCode: error.code }, "pg-boss error");
    });
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  // A failed start must not be cached forever.
  starting.catch(() => {
    starting = undefined;
  });
  return starting;
}

/** Creates every queue from the brief's table (§8) plus one dead-letter queue each. Safe to repeat. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(QUEUE) as QueueName[]) {
    const settings = QUEUE_SETTINGS[name];
    const dead = deadLetterQueue(name);
    if (!(await boss.getQueue(dead))) {
      await boss.createQueue(dead, { retryLimit: 0, retentionSeconds: 14 * 24 * 60 * 60 });
    }
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, {
        retryLimit: settings.retryLimit,
        retryDelay: 1,
        retryBackoff: true,
        expireInSeconds: settings.expireInSeconds,
        deadLetter: dead,
      });
    }
  }
}

export async function stopBoss(): Promise<void> {
  const current = starting;
  starting = undefined;
  if (!current) return;
  try {
    const boss = await current;
    await boss.stop({ graceful: true, timeout: 10_000 });
  } catch {
    // Already stopped or never started.
  }
}
