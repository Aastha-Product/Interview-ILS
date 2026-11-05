import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runAsUser } from "@/lib/owner/context";
import { CURRENT_USER, OWNED_MODELS, rawClientOf, SYSTEM_MODELS } from "@/lib/owner/scope";
import { createTestClient, resetDatabase, TEST_USER_ID } from "@/test/db";

// Pathfinder (private accounts): one student never sees or changes another student's data.

const db = createTestClient();
const raw = rawClientOf(db);
const OTHER = "other-student";
const asOther = <T>(fn: () => Promise<T>) => runAsUser(OTHER, fn);

beforeEach(async () => {
  await resetDatabase(db);
  await raw.user.create({ data: { id: OTHER, email: "other@example.test" } });
  await db.application.create({
    data: { id: "mine", company: "Ledgerly", notes: { create: [{ body: "Call back Monday" }] } },
  });
  await db.setting.create({ data: { key: "paper", value: "A4" } });
  await db.skill.create({ data: { name: "Figma" } });
});
afterAll(() => db.$disconnect());

describe("the owner scope", () => {
  it("gives every row it creates, nested ones included, the current student", async () => {
    const notes = await raw.note.findMany({ select: { userId: true } });
    expect(notes).toEqual([{ userId: TEST_USER_ID }]);
    expect(await raw.application.findUniqueOrThrow({ where: { id: "mine" }, select: { userId: true } })).toEqual({ userId: TEST_USER_ID });
  });

  it("hides one student's rows from another, however they're asked for", async () => {
    await asOther(async () => {
      expect(await db.application.findMany()).toEqual([]);
      expect(await db.application.findUnique({ where: { id: "mine" } })).toBeNull();
      expect(await db.application.count()).toBe(0);
      expect(await db.note.findMany()).toEqual([]);
      expect(await db.setting.findUnique({ where: { userId_key: { userId: CURRENT_USER, key: "paper" } } })).toBeNull();
      // Naming the other student's id outright doesn't help.
      expect(await db.setting.findUnique({ where: { userId_key: { userId: TEST_USER_ID, key: "paper" } } })).toBeNull();
      expect(await db.application.findMany({ where: { OR: [{ id: "mine" }, { userId: TEST_USER_ID }] } })).toEqual([]);
    });
  });

  it("refuses to change or delete another student's rows", async () => {
    await asOther(async () => {
      await expect(db.application.update({ where: { id: "mine" }, data: { company: "Hacked" } })).rejects.toThrow();
      expect((await db.application.updateMany({ data: { company: "Hacked" } })).count).toBe(0);
      await expect(db.application.delete({ where: { id: "mine" } })).rejects.toThrow();
      expect((await db.note.deleteMany()).count).toBe(0);
    });
    expect(await db.application.findUniqueOrThrow({ where: { id: "mine" } })).toMatchObject({ company: "Ledgerly" });
    expect(await db.note.count()).toBe(1);
  });

  it("lets each student use the same setting keys and skill names", async () => {
    await asOther(async () => {
      await db.setting.create({ data: { key: "paper", value: "LETTER" } });
      await db.skill.create({ data: { name: "figma" } });
      await db.setting.upsert({
        where: { userId_key: { userId: CURRENT_USER, key: "paper" } },
        create: { key: "paper", value: "LETTER" },
        update: { value: "LEGAL" },
      });
      expect((await db.setting.findUniqueOrThrow({ where: { userId_key: { userId: CURRENT_USER, key: "paper" } } })).value).toBe("LEGAL");
    });
    expect((await db.setting.findUniqueOrThrow({ where: { userId_key: { userId: CURRENT_USER, key: "paper" } } })).value).toBe("A4");
  });

  it("ignores an owner the caller supplies, and refuses to move a row to another student", async () => {
    await db.note.create({ data: { userId: OTHER, applicationId: "mine", body: "Mine after all" } as never });
    expect(await raw.note.count({ where: { userId: OTHER } })).toBe(0);
    await expect(db.application.update({ where: { id: "mine" }, data: { userId: OTHER } as never })).rejects.toThrow(/owner/);
  });

  it("refuses a row that links to another student's row, even with its id", async () => {
    await asOther(async () => {
      await expect(db.note.create({ data: { applicationId: "mine", body: "Planted" } })).rejects.toThrow();
      await expect(db.note.create({ data: { application: { connect: { id: "mine" } }, body: "Planted" } })).rejects.toThrow();
    });
    expect(await db.note.count()).toBe(1);
  });

  it("keeps raw SQL and system tables off the student's client", async () => {
    expect(() => db.$queryRaw`SELECT 1`).toThrow(/system client/);
    expect(() => db.$executeRawUnsafe("DELETE FROM \"Note\"")).toThrow(/system client/);
    await expect(db.loginThrottle.findMany()).rejects.toThrow(/system client/);
  });

  it("fails closed: a write that skipped the scope has no owner, so the database refuses it", async () => {
    await expect(raw.setting.create({ data: { key: "stray", value: "x" } })).rejects.toThrow(/app\.user_id/);
  });

  it("knows every table: each one with an owner column is scoped, every other one is a system table", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({ name, body }));
    const withOwner = models.filter((m) => /^\s+userId\s+String\b/m.test(m.body)).map((m) => m.name).sort();
    expect(withOwner).toEqual([...OWNED_MODELS].sort());
    const rest = models.map((m) => m.name).filter((name) => !OWNED_MODELS.has(name)).sort();
    expect(rest).toEqual([...SYSTEM_MODELS].sort());
  });
});
