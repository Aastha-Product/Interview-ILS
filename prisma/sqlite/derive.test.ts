import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POSTGRES_SCHEMA, SQLITE_SCHEMA, sqliteSchema } from "./derive";

describe("sqliteSchema", () => {
  it("is what prisma/sqlite/schema.prisma holds (run `yarn sqlite-schema` after changing the schema)", () => {
    expect(readFileSync(SQLITE_SCHEMA, "utf8").replace(/\r\n/g, "\n")).toBe(sqliteSchema(readFileSync(POSTGRES_SCHEMA, "utf8")));
  });

  it("refuses a PostgreSQL type it doesn't know", () => {
    const schema = readFileSync(POSTGRES_SCHEMA, "utf8").replace("key       String   @id", "key       String   @id @db.Uuid");
    expect(() => sqliteSchema(schema)).toThrow("SQLite has no @db.Uuid");
  });
});
