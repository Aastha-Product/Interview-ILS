import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Pathfinder: a student's client (`prisma`) refuses raw SQL, which could
// read every student's rows; it throws at run time, so this finds the calls
// before a page breaks on it (Settings → About did). Raw SQL belongs on
// `systemPrisma`, for system work only.

describe("raw SQL", () => {
  it("is never run on a student's client", () => {
    const files = globSync("src/**/*.{ts,tsx}")
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !/\.test\.tsx?$/.test(file) && !file.startsWith("src/generated/") && !file.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(100);
    const raw = files.filter((file) => /\bprisma\s*\.\s*\$(?:query|execute)Raw/.test(readFileSync(file, "utf8")));
    expect(raw).toEqual([]);
  });
});
