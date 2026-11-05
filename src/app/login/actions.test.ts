import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { systemPrisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { signIn, signInWithForm } from "./actions";
import { loginMessages } from "./messages";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  passwordMatches: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("@/lib/auth/login-throttle", () => ({
  loginWaitMs: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  systemPrisma: { user: { upsert: vi.fn(async ({ create }: { create: { email: string } }) => ({ id: "student-1", email: create.email })) } },
}));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: vi.fn() }));
const mode = vi.hoisted(() => ({ value: "code" as "code" | "google" }));
vi.mock("@/lib/auth/google-sign-in", () => ({ signInMode: () => mode.value }));

describe("signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = "code";
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    vi.mocked(loginWaitMs).mockResolvedValue(0);
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  it("asks for a password when none was entered, without counting it as a failure", async () => {
    await expect(signIn({ email: "Jane@Example.com", password: "", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.empty,
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("refuses a wrong password and counts the failure for the client's IP", async () => {
    await expect(signIn({ email: "Jane@Example.com", password: "hunter2", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.wrong,
    });
    expect(recordLoginFailure).toHaveBeenCalledWith(systemPrisma, "203.0.113.7");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("refuses to even check the password while the IP is blocked", async () => {
    vi.mocked(loginWaitMs).mockResolvedValue(29_500);
    await expect(signIn({ email: "Jane@Example.com", password: "correct horse", remember: false })).resolves.toEqual({
      ok: false,
      error: "Too many attempts. Try again in 30 seconds.",
    });
    expect(passwordMatches).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts a session, resets the IP's counter and welcomes the user by first name", async () => {
    await expect(
      signIn({ email: "Jane@Example.com", password: "correct horse", remember: true, next: "/applications/abc" }),
    ).resolves.toEqual({
      ok: true,
      data: { redirectTo: "/applications/abc" },
      toast: "Welcome back, Jane.",
    });
    expect(recordLoginSuccess).toHaveBeenCalledWith(systemPrisma, "203.0.113.7");
    expect(startSession).toHaveBeenCalledWith({ persistent: true, userId: "student-1" });
  });

  it("refuses the access code once students sign in with Google (Pathfinder)", async () => {
    mode.value = "google";
    await expect(signIn({ email: "jane@example.com", password: "correct horse", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.useGoogle,
    });
    expect(passwordMatches).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("asks for an email address, and stores it in lower case", async () => {
    await expect(signIn({ email: "not an email", password: "correct horse", remember: false })).resolves.toMatchObject({ ok: false });
    expect(startSession).not.toHaveBeenCalled();
    await signIn({ email: "Jane@Example.com", password: "correct horse", remember: false });
    expect(systemPrisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "jane@example.com" } }));
  });

  it("says 'there' before the profile has a name, and ignores unsafe redirects", async () => {
    vi.mocked(loadProfileName).mockResolvedValue("");
    await expect(
      signIn({ email: "Jane@Example.com", password: "correct horse", remember: false, next: "https://evil.example" }),
    ).resolves.toMatchObject({ data: { redirectTo: "/" }, toast: "Welcome back, there." });
    expect(startSession).toHaveBeenCalledWith({ persistent: false, userId: "student-1" });
  });
});

describe("signInWithForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    vi.mocked(loginWaitMs).mockResolvedValue(0);
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }

  it("returns the error for the page to show", async () => {
    await expect(signInWithForm(null, form({ email: "jane@example.com", password: "hunter2" }))).resolves.toEqual({ error: loginMessages.wrong });
    await expect(signInWithForm(null, form({ email: "jane@example.com" }))).resolves.toEqual({ error: loginMessages.empty });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("signs in and goes on to the next page", async () => {
    await expect(
      signInWithForm(null, form({ email: "jane@example.com", password: "correct horse", remember: "on", next: "/profile" })),
    ).rejects.toThrow("redirect /profile");
    expect(startSession).toHaveBeenCalledWith({ persistent: true, userId: "student-1" });
  });

  it("goes to the dashboard when there's no next page, and remembers only when ticked", async () => {
    await expect(signInWithForm({ error: loginMessages.wrong }, form({ email: "jane@example.com", password: "correct horse" }))).rejects.toThrow(
      /^redirect \/$/,
    );
    expect(startSession).toHaveBeenCalledWith({ persistent: false, userId: "student-1" });
  });
});
