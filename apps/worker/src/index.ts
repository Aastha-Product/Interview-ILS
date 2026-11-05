import "./env";
import { createAiClientFromEnv } from "@pathfinder/ai";
import {
  deadLetterQueue,
  getBoss,
  getConfig,
  getLogger,
  markTaskFailed,
  QUEUE,
  QUEUE_SETTINGS,
  stopBoss,
  type PdfJobData,
  type TailorJobData,
} from "@pathfinder/core";
import { deleteStaleRateLimits, failStaleTasks, runRetention, scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { handlePdf } from "./handlers/pdf";
import { handleTailor } from "./handlers/tailor";
import { closeBrowser } from "./pdf/browser";

const log = getLogger();

/** Job fields the handlers need. retryLimit comes from the job's metadata, else the queue setting. */
function info<T>(job: { id: string; data: T; retryCount: number }, queue: keyof typeof QUEUE_SETTINGS) {
  const limit = (job as { retryLimit?: number }).retryLimit;
  return { id: job.id, data: job.data, retryCount: job.retryCount, retryLimit: limit ?? QUEUE_SETTINGS[queue].retryLimit };
}
const config = getConfig();
const ai = createAiClientFromEnv(config);

const STALE_TASK_MS = 30 * 60 * 1000;
const RETENTION_CRON = "0 3 * * *";
const SWEEP_EVERY_MS = 5 * 60 * 1000;
let sweepTimer: NodeJS.Timeout | null = null;

async function main() {
  const boss = await getBoss({ supervise: true });

  await boss.work<TailorJobData>(
    QUEUE.tailor,
    {
      localConcurrency: QUEUE_SETTINGS["ai.tailor"].concurrency,
      localGroupConcurrency: QUEUE_SETTINGS["ai.tailor"].perUser ?? 2,
      includeMetadata: true,
    },
    async (jobs) => {
      for (const job of jobs) await handleTailor(info(job, QUEUE.tailor), { ai });
    },
  );

  await boss.work<PdfJobData>(
    QUEUE.pdf,
    { localConcurrency: QUEUE_SETTINGS["pdf.render"].concurrency, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) await handlePdf(info(job, QUEUE.pdf));
    },
  );

  // Jobs that used up their retries land here: log ids only and make sure the student sees "failed".
  for (const queue of [QUEUE.tailor, QUEUE.pdf] as const) {
    await boss.work<TailorJobData | PdfJobData>(deadLetterQueue(queue), async (jobs) => {
      for (const job of jobs) {
        log.error({ queue, jobId: job.id, taskId: job.data.taskId }, "job moved to dead-letter queue");
        const reason =
          queue === QUEUE.pdf
            ? "We couldn't create the PDF. Please try downloading again."
            : "We couldn't prepare this draft. Please try again.";
        await markTaskFailed(scopedDb(job.data.userId), job.data.taskId, reason).catch(() => {});
      }
    });
  }

  // cleanup.retention: nightly at 03:00 India time (schedule() is an upsert, so restarts are safe).
  // Deletes only derived or expired data; see RETENTION in packages/db/src/maintenance.ts.
  await boss.schedule(QUEUE.cleanup, RETENTION_CRON, null, { tz: "Asia/Kolkata" });
  await boss.work(QUEUE.cleanup, async (jobs) => {
    for (const job of jobs) {
      const report = await runRetention();
      log.info({ queue: QUEUE.cleanup, jobId: job.id, ...report }, "retention cleanup done");
    }
  });

  // A crashed worker or a lost job leaves a task "queued" or "working" forever, holding one of the
  // student's concurrent slots. Every few minutes, fail tasks that have been stuck far longer than
  // any run can take (expiry × attempts plus backoff is well under this).
  const sweep = async () => {
    try {
      const failed = await failStaleTasks({ olderThanMs: STALE_TASK_MS });
      if (failed > 0) log.warn({ failed }, "failed stale tasks");
      // Rate-limit counters only matter for minutes; drop ones untouched for a day.
      await deleteStaleRateLimits(new Date(Date.now() - 24 * 60 * 60 * 1000));
    } catch (error) {
      log.error({ errName: (error as Error).name }, "housekeeping sweep failed");
    }
  };
  await sweep();
  sweepTimer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
  sweepTimer.unref();

  log.info({ ai: ai.providerName }, "worker started");
  process.stdout.write("Worker ready\n");
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker stopping");
  if (sweepTimer) clearInterval(sweepTimer);
  await stopBoss();
  await closeBrowser();
  await getPrisma().$disconnect().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error: Error) => {
  log.fatal({ errName: error.name }, "worker failed to start");
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
