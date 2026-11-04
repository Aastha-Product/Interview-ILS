import { scopedDb } from "@pathfinder/db";
import { getPrisma } from "@pathfinder/db/raw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, resetDatabase } from "../../db/test/helpers";
import { UserFacingError } from "../src/errors";
import { getPreferences, getProfile, savePreferences, saveProfile } from "../src/profile/service";
import { fullProfile } from "./fixtures";

let aliceId: string;
let bobId: string;

beforeEach(async () => {
  await resetDatabase();
  aliceId = (await createUser("alice@example.test")).id;
  bobId = (await createUser("bob@example.test")).id;
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("getProfile / saveProfile", () => {
  it("returns an empty profile with version 0 before the first save", async () => {
    const profile = await getProfile(scopedDb(aliceId));
    expect(profile.version).toBe(0);
    expect(profile.updatedAt).toBeNull();
    expect(profile.skills).toEqual([]);
  });

  it("saves the whole profile and reads it back in the same order", async () => {
    const db = scopedDb(aliceId);
    const input = fullProfile();
    const saved = await saveProfile(db, input, 0);
    expect(saved.version).toBe(1);
    const { version: _v, updatedAt, ...content } = await getProfile(db);
    expect(updatedAt).not.toBeNull();
    expect(content).toEqual(input);
  });

  it("increments the version on every save and keeps the new order", async () => {
    const db = scopedDb(aliceId);
    const input = fullProfile();
    await saveProfile(db, input, 0);

    const reordered = { ...input, skills: [...input.skills].reverse(), projects: [...input.projects].reverse() };
    const second = await saveProfile(db, reordered, 1);
    expect(second.version).toBe(2);
    expect(second.skills.map((s) => s.name)).toEqual(reordered.skills.map((s) => s.name));
    expect(second.projects.map((p) => p.name)).toEqual(["Sales Dashboard", "Library Management System"]);

    // Replacing items leaves no orphans behind.
    expect(await db.skill.count()).toBe(input.skills.length);
    expect(await db.project.count()).toBe(2);
  });

  it("rejects a stale version with 409 and writes nothing", async () => {
    const db = scopedDb(aliceId);
    await saveProfile(db, fullProfile(), 0);
    await saveProfile(db, { ...fullProfile(), headline: "Second save" }, 1);

    const error = await saveProfile(db, { ...fullProfile(), headline: "Stale tab", skills: [] }, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).status).toBe(409);
    expect((error as UserFacingError).code).toBe("PROFILE_CHANGED");

    const after = await getProfile(db);
    expect(after.version).toBe(2);
    expect(after.headline).toBe("Second save");
    expect(after.skills).toHaveLength(fullProfile().skills.length);
  });

  it("rejects a first save that claims an existing version", async () => {
    const error = await saveProfile(scopedDb(aliceId), fullProfile(), 3).catch((e: unknown) => e);
    expect((error as UserFacingError).status).toBe(409);
    expect(await scopedDb(aliceId).profile.count()).toBe(0);
  });

  it("rejects invalid input without writing", async () => {
    const db = scopedDb(aliceId);
    await expect(saveProfile(db, { ...fullProfile(), links: [{ label: "x", url: "javascript:alert(1)" }] }, 0)).rejects.toThrow();
    expect(await db.profile.count()).toBe(0);
  });

  it("writes a PROFILE_UPDATE audit entry per save", async () => {
    const db = scopedDb(aliceId);
    await saveProfile(db, fullProfile(), 0);
    await saveProfile(db, fullProfile(), 1);
    expect(await db.auditLog.count({ where: { action: "PROFILE_UPDATE" } })).toBe(2);
  });

  it("never shows one student's profile to another", async () => {
    await saveProfile(scopedDb(aliceId), fullProfile(), 0);
    const bobView = await getProfile(scopedDb(bobId));
    expect(bobView.version).toBe(0);
    expect(bobView.headline).toBe("");
    expect(bobView.skills).toEqual([]);

    // Bob's first save creates his own profile and leaves Alice's untouched.
    await saveProfile(scopedDb(bobId), { ...fullProfile(), headline: "Bob" }, 0);
    expect((await getProfile(scopedDb(aliceId))).headline).toBe(fullProfile().headline);
    expect((await getProfile(scopedDb(aliceId))).version).toBe(1);
  });
});

describe("job preferences", () => {
  it("creates, then updates, one preferences row per student", async () => {
    const db = scopedDb(aliceId);
    expect(await getPreferences(db)).toBeNull();

    await savePreferences(db, { roles: ["Software tester"], locations: ["Indore"] });
    expect(await getPreferences(db)).toEqual({
      roles: ["Software tester"],
      locations: ["Indore"],
      remoteOk: true,
      minSalary: null,
      experienceLevel: "FRESHER",
    });

    await savePreferences(db, { roles: ["Data analyst"], locations: [], remoteOk: false, minSalary: 300000 });
    const updated = await getPreferences(db);
    expect(updated).toMatchObject({ roles: ["Data analyst"], remoteOk: false, minSalary: 300000 });
    expect(await db.jobPreference.count()).toBe(1);
    expect(await getPreferences(scopedDb(bobId))).toBeNull();
  });

  it("requires at least one role", async () => {
    await expect(savePreferences(scopedDb(aliceId), { roles: [] })).rejects.toThrow();
  });
});
