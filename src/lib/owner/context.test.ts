import { afterEach, describe, expect, it, vi } from "vitest";

// A production build loads src/lib/owner/context.ts more than once (instrumentation.ts and each
// route bundle), while the scoped database client is created once. Every copy must see the
// student that any other copy set, or jobs and schedulers act for the wrong student (QA C-2).
async function freshCopy() {
  vi.resetModules();
  return import("./context");
}

afterEach(() => vi.resetModules());

describe("runAsUser across copies of the module", () => {
  it("lets one copy read the student another copy set", async () => {
    const startup = await freshCopy();
    const route = await freshCopy();
    expect(startup).not.toBe(route);
    await startup.runAsUser("student-a", async () => {
      expect(route.contextUserId()).toBe("student-a");
    });
    expect(route.contextUserId()).toBeUndefined();
  });

  it("keeps two students' concurrent work apart", async () => {
    const one = await freshCopy();
    const two = await freshCopy();
    const seen: string[] = [];
    await Promise.all([
      one.runAsUser("student-a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        seen.push(`a:${two.contextUserId()}`);
      }),
      two.runAsUser("student-b", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(`b:${one.contextUserId()}`);
      }),
    ]);
    expect(seen.sort()).toEqual(["a:student-a", "b:student-b"]);
  });
});
