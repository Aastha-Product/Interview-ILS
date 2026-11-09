import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { rawClientOf } from "@/lib/owner/scope";
import { createTestClient, resetDatabase } from "@/test/db";

import { studentForFirebase, studentForGoogle } from "./students";

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

describe("studentForFirebase", () => {
  const firebaseAsha = { uid: "firebase-asha", email: "asha@example.com", emailVerified: true, name: "Asha Rao" };

  it("makes a new student the first time, and finds the same one after", async () => {
    const id = await studentForFirebase(firebaseAsha, system);
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ email: "asha@example.com", firebaseUid: "firebase-asha" });
    expect(await studentForFirebase({ ...firebaseAsha, email: "asha.rao@example.com" }, system)).toBe(id);
  });

  it("links the student who signed in another way before, by their verified address", async () => {
    const id = await studentForGoogle(asha, system);
    expect(await studentForFirebase(firebaseAsha, system)).toBe(id);
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ googleSub: "google-asha", firebaseUid: "firebase-asha" });
  });

  it("lets a student in straight after signing up, before they verify their address", async () => {
    const id = await studentForFirebase({ ...firebaseAsha, emailVerified: false }, system);
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ email: "asha@example.com", firebaseUid: "firebase-asha" });
    // Signing in again, still unverified: the same student.
    expect(await studentForFirebase({ ...firebaseAsha, emailVerified: false }, system)).toBe(id);
  });

  it("never hands an existing student to an address that isn't verified", async () => {
    const existing = await system.user.create({ data: { email: "asha@example.com" } });
    await expect(studentForFirebase({ ...firebaseAsha, emailVerified: false }, system)).rejects.toMatchObject({ kind: "taken" });
    await expect(studentForFirebase({ ...firebaseAsha, email: "" }, system)).rejects.toMatchObject({ kind: "unverified" });
    expect(await system.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ firebaseUid: null });
    // Once verified (or through Google), the address is theirs, and so is the student.
    expect(await studentForFirebase(firebaseAsha, system)).toBe(existing.id);
  });

  it("moves a student to the new Firebase account of a verified address, never for an unverified one", async () => {
    const id = await studentForFirebase(firebaseAsha, system);
    // Firebase keeps one account per address: a new account with the same verified address means the old one is gone.
    await expect(studentForFirebase({ ...firebaseAsha, uid: "firebase-new", emailVerified: false }, system)).rejects.toMatchObject({ kind: "taken" });
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ firebaseUid: "firebase-asha" });
    expect(await studentForFirebase({ ...firebaseAsha, uid: "firebase-new" }, system)).toBe(id);
    expect(await system.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ firebaseUid: "firebase-new" });
  });
});
