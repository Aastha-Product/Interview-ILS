import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getConfig,
  getLogger,
  handlePdf,
  handleTailor,
  QUEUE,
  renderResumePdf,
  runsJobsInline,
  setInlineDispatcher,
  type InlineJob,
} from "@pathfinder/core";
import { after } from "next/server";
import { getAi } from "./services";

/**
 * Demo sites have no worker. Here, a queued job runs inside the web app right after the response
 * is sent (Next's `after`), so the student sees "queued → working → done" exactly as with the
 * worker. A PDF queued by a draft runs in the same background chain. No retries: a failure marks
 * the task failed and the student can press "Try again".
 *
 * Routes that start jobs set maxDuration = 120 s, which is the budget for both steps together.
 */
const DRAFT_BUDGET_MS = 90_000;

const chain = new AsyncLocalStorage<Array<Promise<unknown>>>();

async function run(job: InlineJob): Promise<void> {
  const info = { id: `inline:${job.data.taskId}`, retryCount: 0, retryLimit: 0 };
  try {
    if (job.queue === QUEUE.tailor) {
      await handleTailor({ ...info, data: job.data }, { ai: getAi(), budgetMs: DRAFT_BUDGET_MS });
    } else {
      await handlePdf({ ...info, data: job.data }, { renderResume: renderResumePdf });
    }
  } catch (error) {
    // The handler has already marked the task failed (no retries here); just record the kind.
    getLogger().warn({ queue: job.queue, errName: (error as Error).name }, "inline job failed");
  }
}

function dispatch(job: InlineJob): void {
  const pending = chain.getStore();
  if (pending) {
    // Already running in the background (a draft queueing its PDF): add to that chain.
    pending.push(run(job));
    return;
  }
  after(async () => {
    const queue: Array<Promise<unknown>> = [];
    await chain.run(queue, async () => {
      await run(job);
      while (queue.length) await queue.shift();
    });
  });
}

let installed = false;

/** Called at the start of every API request; turns inline jobs on for demo sites. */
export function ensureInlineJobs(): void {
  if (installed) return;
  installed = true;
  if (runsJobsInline(getConfig())) setInlineDispatcher(dispatch);
}
