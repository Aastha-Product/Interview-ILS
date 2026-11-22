import "server-only";

import { loadAutoApply, setAutoApplyEnabled } from "@/lib/apply/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { toolsEnabled } from "@/lib/tools";

// Pathfinder (Phase 3): one switch for everything that runs on its own, on Runs & schedule.
// Pausing turns auto-apply and the job agent off and remembers which were on; Resume turns those
// back on. Nothing is lost: settings, answers and the queue stay as they are.

export type PauseState = { paused: { since: Date } | null; running: { autoApply: boolean; agent: boolean } };

/** Whether everything is paused, and what's running now. */
export async function loadPauseState(): Promise<PauseState> {
  const [autoApply, settings] = await Promise.all([loadAutoApply(), loadSettings()]);
  return {
    paused: settings.pausedAll ? { since: new Date(settings.pausedAll.at) } : null,
    running: { autoApply: autoApply.enabled, agent: toolsEnabled() && settings.agentEnabled },
  };
}

/** Pauses auto-apply and the agent; false when nothing was running. */
export async function pauseAll(now: Date = new Date()): Promise<boolean> {
  const { paused, running } = await loadPauseState();
  if (paused || (!running.autoApply && !running.agent)) return false;
  if (running.autoApply) await setAutoApplyEnabled(false);
  await saveSettings({ agentEnabled: false, pausedAll: { ...running, at: now.toISOString() } });
  return true;
}

export type ResumeOutcome = { resumed: ("autoApply" | "agent")[]; problem: string | null };

/**
 * Turns back on what was running when paused. Auto-apply may no longer be ready (its answers or
 * consent changed meanwhile): it then stays off, with why.
 */
export async function resumeAll(): Promise<ResumeOutcome> {
  const { pausedAll } = await loadSettings();
  if (!pausedAll) return { resumed: [], problem: null };
  const resumed: ResumeOutcome["resumed"] = [];
  let problem: string | null = null;
  if (pausedAll.autoApply) {
    try {
      await setAutoApplyEnabled(true);
      resumed.push("autoApply");
    } catch (error) {
      problem = error instanceof Error ? error.message : "Auto-apply couldn't be switched back on.";
    }
  }
  if (pausedAll.agent && toolsEnabled()) resumed.push("agent");
  await saveSettings({ agentEnabled: resumed.includes("agent") || undefined, pausedAll: null });
  return { resumed, problem };
}
