import { beforeEach, describe, expect, it, vi } from "vitest";

// Pause everything (Phase 3), with auto-apply's and the settings' stores faked.

const state = vi.hoisted(() => ({
  autoApply: false,
  ready: true,
  settings: { agentEnabled: false, pausedAll: null as { autoApply: boolean; agent: boolean; at: string } | null },
  tools: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/apply/settings", () => ({
  loadAutoApply: async () => ({ enabled: state.autoApply }),
  setAutoApplyEnabled: async (enabled: boolean) => {
    if (enabled && !state.ready) throw new Error("Answer the questions first.");
    state.autoApply = enabled;
  },
}));
vi.mock("@/lib/settings-data", () => ({
  loadSettings: async () => ({ ...state.settings }),
  saveSettings: async (changes: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) Object.assign(state.settings, { [key]: value });
  },
}));
vi.mock("@/lib/tools", () => ({ toolsEnabled: () => state.tools }));

const { loadPauseState, pauseAll, resumeAll } = await import("./pause-all");

const now = new Date("2026-11-22T10:00:00Z");

beforeEach(() => {
  state.autoApply = false;
  state.ready = true;
  state.settings = { agentEnabled: false, pausedAll: null };
  state.tools = true;
});

describe("Pause everything (Phase 3)", () => {
  it("has nothing to pause while nothing runs", async () => {
    expect(await loadPauseState()).toEqual({ paused: null, running: { autoApply: false, agent: false } });
    expect(await pauseAll(now)).toBe(false);
  });

  it("pauses auto-apply and the agent, and resumes what was running", async () => {
    state.autoApply = true;
    state.settings.agentEnabled = true;
    expect(await pauseAll(now)).toBe(true);
    expect(await loadPauseState()).toEqual({ paused: { since: now }, running: { autoApply: false, agent: false } });
    // Paused twice is still once.
    expect(await pauseAll(now)).toBe(false);

    expect(await resumeAll()).toEqual({ resumed: ["autoApply", "agent"], problem: null });
    expect(await loadPauseState()).toEqual({ paused: null, running: { autoApply: true, agent: true } });
  });

  it("resumes only what was on, and says why auto-apply can't come back", async () => {
    state.autoApply = true;
    await pauseAll(now);
    state.ready = false;
    expect(await resumeAll()).toEqual({ resumed: [], problem: "Answer the questions first." });
    expect(state.settings).toMatchObject({ agentEnabled: false, pausedAll: null });
    expect(await resumeAll()).toEqual({ resumed: [], problem: null });
  });

  it("leaves the agent out where the job-search tools are off", async () => {
    state.settings.agentEnabled = true;
    state.tools = false;
    expect((await loadPauseState()).running.agent).toBe(false);
    expect(await pauseAll(now)).toBe(false);
  });
});
