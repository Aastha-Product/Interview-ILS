import { afterEach, describe, expect, it, vi } from "vitest";

import { StartupsOffError } from "./enabled";
import { refreshStartupsJob, startStartupsRefresh } from "./refresh";

// Pathfinder: while PATHFINDER_STARTUPS is off, no refresh starts, and one
// queued before it was turned off fetches nothing.

const flags = vi.hoisted(() => ({ startups: "off" as "on" | "off" }));
vi.mock("@/lib/env", () => ({
  env: {
    get PATHFINDER_STARTUPS() {
      return flags.startups;
    },
  },
}));
const runner = vi.hoisted(() => ({ startJob: vi.fn(async () => "job-1"), findUnfinishedJobs: vi.fn(async () => []) }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: <T,>(definition: T) => definition, ...runner }));
const sources = vi.hoisted(() => ({ yc: vi.fn(async () => []), hn: vi.fn(async () => []) }));
vi.mock("./sources/yc", () => ({ fetchYcStartups: sources.yc }));
vi.mock("./sources/hn", () => ({ fetchHnStartups: sources.hn }));
vi.mock("@/lib/prisma", () => ({ prisma: { startup: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => ({ basics: { city: "", country: "" } }) }));
vi.mock("@/lib/settings-data", () => ({ saveSettings: vi.fn() }));
vi.mock("./store", () => ({ lookUpStartup: vi.fn(), rescoreStartups: vi.fn(), sweepStartups: vi.fn(), upsertStartups: vi.fn(async () => 0) }));

afterEach(() => {
  vi.clearAllMocks();
  flags.startups = "off";
});

const context = () => ({ step: async () => {}, signal: new AbortController().signal });

describe("Startups' refresh (Pathfinder: PATHFINDER_STARTUPS)", () => {
  it("starts nothing while Startups is off", async () => {
    await expect(startStartupsRefresh()).rejects.toBeInstanceOf(StartupsOffError);
    expect(runner.startJob).not.toHaveBeenCalled();
  });

  it("fetches nothing for a refresh queued before Startups was turned off", async () => {
    await expect(refreshStartupsJob.run({}, context() as never)).rejects.toBeInstanceOf(StartupsOffError);
    expect(sources.yc).not.toHaveBeenCalled();
    expect(sources.hn).not.toHaveBeenCalled();
  });

  it("starts and runs as before while Startups is on", async () => {
    flags.startups = "on";
    expect(await startStartupsRefresh()).toBe("job-1");
    await refreshStartupsJob.run({}, context() as never);
    expect(sources.yc).toHaveBeenCalledTimes(1);
    expect(sources.hn).toHaveBeenCalledTimes(1);
  });
});
