import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE_ACCOUNT_MISMATCH } from "@/lib/account-deletion";
import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { deleteMyAccount } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  const { rawClientOf } = await import("@/lib/owner/scope");
  db.client = createTestClient();
  return { prisma: db.client, systemPrisma: rawClientOf(db.client) };
});
const signedOut = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ userId: "test-student", persistent: false, version: 0, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
  endSession: async () => void (signedOut.count += 1),
}));
vi.mock("@/lib/google/account", () => ({ disconnectGoogle: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: "" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to = to;
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  unstable_rethrow: (error: unknown) => {
    if ((error as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw error;
  },
}));
const dataDir = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({ env: { get DOSSIER_DATA_DIR() { return dataDir.path; }, DOSSIER_SECRET: "s".repeat(32) } }));

const system = () => rawClientOf(db.client!);
let email = "";

beforeEach(async () => {
  dataDir.path = await mkdtemp(path.join(tmpdir(), "pathfinder-delete-my-account-"));
  redirected.to = "";
  signedOut.count = 0;
  await resetDatabase(db.client!);
  email = (await system().user.findUniqueOrThrow({ where: { id: "test-student" } })).email;
});
afterAll(async () => {
  await rm(dataDir.path, { recursive: true, force: true });
  await db.client!.$disconnect();
});

describe("deleteMyAccount (QA M-3)", () => {
  it("does nothing unless the student types their own email address", async () => {
    for (const typed of ["", "someone@else.example", "DELETE"]) {
      expect(await deleteMyAccount({ email: typed })).toEqual({ ok: false, error: DELETE_ACCOUNT_MISMATCH });
    }
    expect(await system().user.findUnique({ where: { id: "test-student" } })).not.toBeNull();
    expect(signedOut.count).toBe(0);
  });

  it("deletes the account, signs the student out and takes them to the homepage", async () => {
    await expect(deleteMyAccount({ email: ` ${email.toUpperCase()} ` })).rejects.toThrow("NEXT_REDIRECT");
    expect(await system().user.findUnique({ where: { id: "test-student" } })).toBeNull();
    expect(signedOut.count).toBe(1);
    expect(redirected.to).toBe("/");
  });
});
