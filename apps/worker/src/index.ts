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
import { scopedDb } from "@pathfinder/db";
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

  log.info({ ai: ai.providerName }, "worker started");
  process.stdout.write("Worker ready\n");
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker stopping");
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
