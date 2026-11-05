import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "../src/client";
import { INTERNAL_MODELS, scopedDb, ScopeViolationError, SHARED_MODELS, USER_OWNED_MODELS } from "../src/scoped";
import { createUser, resetDatabase } from "./helpers";

let aliceId: string;
let bobId: string;
let aliceProfileId: string;

beforeEach(async () => {
  await resetDatabase();
  aliceId = (await createUser("alice@example.test")).id;
  bobId = (await createUser("bob@example.test")).id;
  const alice = scopedDb(aliceId);
  const profile = await alice.profile.create({ data: { userId: aliceId, headline: "Alice's headline" } });
  aliceProfileId = profile.id;
  await alice.skill.create({ data: { userId: aliceId, profileId: profile.id, order: 0, name: "Python" } });
  await alice.resumeFile.create({
    data: { userId: aliceId, storageKey: "users/alice/resume.pdf", mime: "application/pdf", size: 10 },
  });
});

afterAll(async () => {
  await getPrisma().$disconnect();
});

describe("scopedDb: user B cannot read user A's data", () => {
  it("finds nothing of A's through find, count or aggregate", async () => {
    const bob = scopedDb(bobId);
    expect(await bob.profile.findMany()).toEqual([]);
    expect(await bob.profile.findFirst()).toBeNull();
    expect(await bob.profile.findUnique({ where: { id: aliceProfileId } })).toBeNull();
    expect(await bob.profile.findUnique({ where: { userId: aliceId } })).toBeNull();
    expect(await bob.skill.findMany({ where: { profileId: aliceProfileId } })).toEqual([]);
    expect(await bob.resumeFile.count()).toBe(0);
    expect((await bob.skill.aggregate({ _count: true }))._count).toBe(0);
  });

  it("still lets A read A's own data", async () => {
    const alice = scopedDb(aliceId);
    const profile = await alice.profile.findFirst({ include: { skills: true } });
    expect(profile?.headline).toBe("Alice's headline");
    expect(profile?.skills.map((s) => s.name)).toEqual(["Python"]);
  });

  it("cannot see A's rows even when asking for A's userId explicitly", async () => {
    const bob = scopedDb(bobId);
    await bob.profile.create({ data: { userId: bobId, headline: "Bob's headline" } });
    expect(await bob.profile.findMany({ where: { userId: aliceId } })).toEqual([]);
    expect(await bob.profile.findUnique({ where: { userId: aliceId } })).toBeNull();
    expect((await bob.profile.findMany()).map((p) => p.headline)).toEqual(["Bob's headline"]);
  });

  it("sees only itself in the User table", async () => {
    const bob = scopedDb(bobId);
    const users = await bob.user.findMany();
    expect(users.map((u) => u.id)).toEqual([bobId]);
    expect(await bob.user.findUnique({ where: { id: aliceId } })).toBeNull();
  });
});

describe("scopedDb: user B cannot change user A's data", () => {
  it("cannot update or delete A's rows", async () => {
    const bob = scopedDb(bobId);
    await expect(
      bob.profile.update({ where: { id: aliceProfileId }, data: { headline: "hacked" } }),
    ).rejects.toThrow();
    expect((await bob.profile.updateMany({ data: { headline: "hacked" } })).count).toBe(0);
    await expect(bob.profile.delete({ where: { id: aliceProfileId } })).rejects.toThrow();
    expect((await bob.skill.deleteMany()).count).toBe(0);

    const alice = scopedDb(aliceId);
    expect((await alice.profile.findFirst())?.headline).toBe("Alice's headline");
    expect(await alice.skill.count()).toBe(1);
  });

  it("creates rows as B even if the data names A as the owner", async () => {
    const bob = scopedDb(bobId);
    const created = await bob.profile.create({ data: { userId: aliceId, headline: "Bob" } });
    expect(created.userId).toBe(bobId);
  });

  it("refuses to move a row to another owner", async () => {
    const alice = scopedDb(aliceId);
    await expect(
      alice.profile.update({ where: { id: aliceProfileId }, data: { userId: bobId } }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("refuses nested relation writes, which would skip the owner check", async () => {
    const bob = scopedDb(bobId);
    await expect(
      bob.profile.create({
        data: { headline: "x", skills: { create: [{ userId: aliceId, order: 0, name: "Go" }] } },
      } as never),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("keeps the scope inside interactive transactions", async () => {
    const bob = scopedDb(bobId);
    const seen = await bob.$transaction(async (tx) => tx.profile.findMany());
    expect(seen).toEqual([]);
  });
});

describe("scopedDb: shared job data does not leak user rows", () => {
  it("refuses to include other users' applications through a job listing", async () => {
    const prisma = getPrisma();
    const job = await prisma.jobListing.create({
      data: { source: "manual", sourceId: "j1", company: "Acme", title: "QA", description: "d", dedupeKey: "acme|qa|" },
    });
    await scopedDb(aliceId).application.create({ data: { userId: aliceId, jobListingId: job.id } });

    const bob = scopedDb(bobId);
    expect((await bob.jobListing.findMany()).length).toBe(1);
    await expect(bob.jobListing.findMany({ include: { applications: true } })).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
    await expect(
      bob.jobListing.findMany({ select: { _count: { select: { applications: true } } } }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(
      bob.application.findMany({ include: { jobListing: { include: { applications: true } } } }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(
      bob.jobListing.update({ where: { id: job.id }, data: { title: "changed" } }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });
});

describe("scopedDb: escape hatches are closed", () => {
  it("blocks raw SQL", () => {
    const bob = scopedDb(bobId);
    expect(() => (bob as unknown as { $queryRawUnsafe: unknown }).$queryRawUnsafe).toThrow(
      ScopeViolationError,
    );
  });

  it("blocks the Auth.js tables", async () => {
    const bob = scopedDb(bobId);
    await expect(bob.session.findMany()).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(bob.account.findMany()).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("blocks internal tables such as rate-limit counters", async () => {
    await expect(scopedDb(bobId).rateLimit.findMany()).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("needs a user id", () => {
    expect(() => scopedDb("")).toThrow(ScopeViolationError);
  });

  it("classifies every model in the schema", () => {
    const schema = readFileSync(path.resolve(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
      name: m[1]!,
      hasUserId: /^\s+userId\s+String/m.test(m[2]!),
    }));
    const authModels = new Set(["Account", "Session", "VerificationToken"]);
    for (const model of models) {
      if (authModels.has(model.name) || INTERNAL_MODELS.has(model.name) || model.name === "User") continue;
      if (model.hasUserId) expect(USER_OWNED_MODELS, model.name).toContain(model.name);
      else expect(SHARED_MODELS, model.name).toContain(model.name);
    }
  });
});
