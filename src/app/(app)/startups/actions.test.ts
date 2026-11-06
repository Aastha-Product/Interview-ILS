import { afterEach, describe, expect, it, vi } from "vitest";

import StartupsLayout from "./layout";
import { lookUpStartupAddresses, refreshStartupsNow, removeStartupForGood, saveStartupNotes, setStartupStatus } from "./actions";

// Pathfinder: Startups is off unless PATHFINDER_STARTUPS=on. While it's off,
// its screen and every one of its actions answer 404, and nothing is fetched.

const flags = vi.hoisted(() => ({ startups: "off" as "on" | "off" }));
vi.mock("@/lib/env", () => ({
  env: {
    get PATHFINDER_STARTUPS() {
      return flags.startups;
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ userId: "test-student", persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
const work = vi.hoisted(() => ({
  refresh: vi.fn(async () => "job-1"),
  lookUp: vi.fn(async () => ({ id: "s1", emails: [] })),
  update: vi.fn(async () => ({ status: "SAVED" })),
  remove: vi.fn(async () => true),
}));
vi.mock("@/lib/startups/refresh", () => ({ startStartupsRefresh: work.refresh }));
vi.mock("@/lib/startups/store", () => ({ lookUpStartup: work.lookUp, updateStartup: work.update, removeStartup: work.remove }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  flags.startups = "off";
});

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const calls = [
  () => refreshStartupsNow({}),
  () => setStartupStatus({ id: "s1", status: "SAVED" }),
  () => lookUpStartupAddresses({ id: "s1", people: false }),
  () => saveStartupNotes({ id: "s1", notes: "Call on Monday" }),
  () => removeStartupForGood({ id: "s1" }),
];

describe("Startups while PATHFINDER_STARTUPS is off (the default)", () => {
  it("answers 404 for the screen", () => {
    expect(() => StartupsLayout({ children: "screen", params: Promise.resolve({}) } as never)).toThrow(expect.objectContaining(NOT_FOUND));
  });

  it("answers 404 for every action, and fetches or changes nothing", async () => {
    for (const call of calls) await expect(call()).rejects.toMatchObject(NOT_FOUND);
    expect(work.refresh).not.toHaveBeenCalled();
    expect(work.lookUp).not.toHaveBeenCalled();
    expect(work.update).not.toHaveBeenCalled();
    expect(work.remove).not.toHaveBeenCalled();
  });
});

describe("Startups with PATHFINDER_STARTUPS=on", () => {
  it("shows the screen", () => {
    flags.startups = "on";
    expect(StartupsLayout({ children: "screen", params: Promise.resolve({}) } as never)).toBe("screen");
  });

  it("runs its actions", async () => {
    flags.startups = "on";
    for (const call of calls) expect(await call()).toMatchObject({ ok: true });
    expect(work.refresh).toHaveBeenCalledTimes(1);
    expect(work.lookUp).toHaveBeenCalledTimes(1);
    expect(work.update).toHaveBeenCalledTimes(2);
    expect(work.remove).toHaveBeenCalledTimes(1);
  });
});
