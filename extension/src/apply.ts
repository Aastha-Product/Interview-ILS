// The apply script's entry, put in the job's tab by the background worker (see run.ts).
import { REASONS, type Reply, type TabRequest } from "./protocol";
import { apply, type Finish, type Port, type TabTask } from "./run";
import { withSnapshot } from "./snapshot";

const port: Port = <T>(request: TabRequest) => chrome.runtime.sendMessage<Reply<T>>(request);

async function main(): Promise<void> {
  const reply = await port<TabTask>({ type: "task" });
  if (!reply.ok) return; // Not a tab Pathfinder opened, or it's done with it.
  let finish: Finish;
  try {
    finish = await apply(port, document, location, reply.data);
  } catch (error) {
    // "uncertain" is only accepted once Submit was pressed; before that, the form couldn't be filled.
    const after = await port({ type: "report", report: withSnapshot({ outcome: "uncertain", reason: REASONS.noAnswer }, document, location.href), keepTab: true });
    if (after.ok) return;
    const reason = `Pathfinder couldn't fill this form (${error instanceof Error ? error.message : String(error)}).`.slice(0, 500);
    await port({ type: "report", report: withSnapshot({ outcome: "failed", reason }, document, location.href), keepTab: false });
    return;
  }
  // Phase 3: what the page said, when it stopped short of applied.
  await port({ type: "report", report: withSnapshot(finish.report, document, location.href), keepTab: finish.keepTab });
}

// Once per page, even when injected again.
const marker = globalThis as { pathfinderApplying?: boolean };
if (!marker.pathfinderApplying) {
  marker.pathfinderApplying = true;
  void main();
}
