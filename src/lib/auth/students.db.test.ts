import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { studentForGoogle } from "./students";

// Pathfinder: which student a Google account signs in as.

const db = createTestClient();
const system = rawClientOf(db);
const asha = { sub: "google-asha", email: "asha@example.com", name: "Asha Rao" };

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("studentForGoogle", () => {
  it("makes a new student the first time, and finds the same one after", async () => {
    const id = await studentForGoogle(asha, system);
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ email: "asha@example.com", googleSub: "google-asha", name: "Asha Rao" });
    expect(await studentForGoogle(asha, system)).toBe(id);
    // Still the same student after the address changes at Google.
    expect(await studentForGoogle({ ...asha, email: "asha.rao@example.com" }, system)).toBe(id);
  });

  it("links a student made before Google sign-in by their verified address", async () => {
    const before = await system.user.create({ data: { email: "asha@example.com" } });
    expect(await studentForGoogle(asha, system)).toBe(before.id);
    expect(await system.user.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ googleSub: "google-asha", name: "Asha Rao" });
  });

  it("never hands a student linked to one Google account to another", async () => {
    await studentForGoogle(asha, system);
    await expect(studentForGoogle({ ...asha, sub: "google-impostor" }, system)).rejects.toMatchObject({ kind: "failed" });
    expect(await system.user.count({ where: { googleSub: "google-impostor" } })).toBe(0);
  });
});
