import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase, testDatabaseUrl } from "@/test/db";
import { CURRENT_USER, rawClientOf } from "@/lib/owner/scope";

import { createPrismaClient } from "./database";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("the database client", () => {
  it("keeps a write made while a transaction is open out of that transaction", async () => {
    let opened!: () => void;
    const open = new Promise<void>((resolve) => (opened = resolve));
    const undone = db
      .$transaction(async (tx) => {
        await tx.fact.create({ data: { text: "inside" } });
        opened();
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error("undo");
      })
      .catch((error: Error) => error.message);

    await open;
    await db.fact.create({ data: { text: "outside" } });

    expect(await undone).toBe("undo");
    expect((await db.fact.findMany()).map((fact) => fact.text)).toEqual(["outside"]);
  });

  it("compares skill names without case", async () => {
    await db.skill.create({ data: { name: "TypeScript" } });
    expect(await db.skill.findUnique({ where: { userId_name: { userId: CURRENT_USER, name: "typescript" } } })).toMatchObject({ name: "TypeScript" });
    await expect(db.skill.create({ data: { name: "TYPESCRIPT" } })).rejects.toThrow();
  });

  it("stops a statement that runs too long in the database (P0 task 4)", async () => {
    const [row] = await rawClientOf(db).$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    expect(row.statement_timeout).toBe("30s");
  });

  it("waits for a busy pool instead of failing a transaction after 2 seconds (P0 task 4)", async () => {
    // One connection, three transactions that each hold it for 2.2 s: the last waits about 4.4 s,
    // which Prisma's default (2 s) turned into P2028 under load.
    const single = createPrismaClient(testDatabaseUrl(), 1);
    try {
      const hold = () => single.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        await new Promise((resolve) => setTimeout(resolve, 2_200));
        return "done";
      });
      expect(await Promise.all([hold(), hold(), hold()])).toEqual(["done", "done", "done"]);
    } finally {
      await single.$disconnect();
    }
  }, 20_000);
});
