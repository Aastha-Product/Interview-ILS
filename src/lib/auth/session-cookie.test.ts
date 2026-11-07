import { beforeEach, describe, expect, it, vi } from "vitest";

import { endSession, getSession, SESSION_COOKIE, SESSION_LIFETIME, startSession, verifySession } from "./session";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), remove: vi.fn(), proto: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: object) => {
      jar.values.set(name, value);
      jar.set(name, value, options);
    },
    delete: (name: string) => {
      jar.values.delete(name);
      jar.remove(name);
    },
  }),
  headers: async () => new Headers(jar.proto ? { "x-forwarded-proto": jar.proto } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32), DOSSIER_PASSWORD: "correct horse" } }));
// The students and their session versions (Pathfinder, QA M-4), in memory.
const users = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/prisma", () => ({
  systemPrisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.has(where.id) ? { sessionVersion: users.get(where.id)! } : null,
      update: async ({ where }: { where: { id: string } }) => {
        users.set(where.id, users.get(where.id)! + 1);
        return {};
      },
    },
  },
}));
// React's per-request cache would keep the first answer across tests.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

beforeEach(() => {
  jar.values.clear();
  jar.set.mockClear();
  jar.remove.mockClear();
  jar.proto = null;
  users.clear();
  users.set("test-student", 0);
  users.set("other-student", 0);
});

describe("the session cookie (E3-1)", () => {
  it("starts a browser session: an HTTP-only, same-site cookie without an expiry", async () => {
    await startSession({ persistent: false, userId: "test-student" });
    expect(jar.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), { httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(await getSession()).toMatchObject({ persistent: false, userId: "test-student" });
  });

  it("keeps a remembered session for 30 days, secure behind an HTTPS proxy", async () => {
    jar.proto = "https, http";
    await startSession({ persistent: true, userId: "test-student" });
    expect(jar.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), expect.objectContaining({ secure: true, maxAge: SESSION_LIFETIME.persistent }));
  });

  it("reads no session from a missing or forged cookie", async () => {
    expect(await getSession()).toBeNull();
    jar.values.set(SESSION_COOKIE, "not-a-token");
    expect(await getSession()).toBeNull();
  });

  it("sends visitors without a session to the sign-in page", async () => {
    await expect(verifySession()).rejects.toThrow("redirect /login");
    await startSession({ persistent: false, userId: "test-student" });
    await expect(verifySession()).resolves.toMatchObject({ persistent: false, userId: "test-student" });
  });

  it("ends the session by deleting the cookie", async () => {
    await startSession({ persistent: false, userId: "test-student" });
    await endSession();
    expect(jar.remove).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(await getSession()).toBeNull();
  });

  it("ends a copied cookie too, and the student's other sessions, but no one else's (QA M-4)", async () => {
    await startSession({ persistent: true, userId: "other-student" });
    const others = jar.values.get(SESSION_COOKIE)!;
    await startSession({ persistent: true, userId: "test-student" });
    const copied = jar.values.get(SESSION_COOKIE)!;
    await endSession();
    // Someone who kept a copy of the cookie puts it back.
    jar.values.set(SESSION_COOKIE, copied);
    expect(await getSession()).toBeNull();
    jar.values.set(SESSION_COOKIE, others);
    expect(await getSession()).toMatchObject({ userId: "other-student" });
    // Signing in again works as usual.
    await startSession({ persistent: false, userId: "test-student" });
    expect(await getSession()).toMatchObject({ userId: "test-student", version: 1 });
  });

  it("reads no session for a student who no longer exists", async () => {
    await startSession({ persistent: false, userId: "test-student" });
    users.delete("test-student");
    expect(await getSession()).toBeNull();
  });
});
