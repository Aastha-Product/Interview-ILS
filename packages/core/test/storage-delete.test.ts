import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorage, createMemoryStorage, userFolder } from "../src/storage";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("deleteUserFiles", () => {
  it("local storage removes one student's folder and nothing else", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pf-storage-"));
    const storage = createLocalStorage(dir);
    await storage.put("users/alice/resumes/a.pdf", new Uint8Array([1]), "application/pdf");
    await storage.put("users/alice/applications/x/resume-v1.pdf", new Uint8Array([2]), "application/pdf");
    await storage.put("users/alice2/resumes/b.pdf", new Uint8Array([3]), "application/pdf");
    await storage.deleteUserFiles("alice");
    expect(await readdir(path.join(dir, "users"))).toEqual(["alice2"]);
    // A second call (nothing left) is fine.
    await expect(storage.deleteUserFiles("alice")).resolves.toBeUndefined();
  });

  it("memory storage matches on the folder, not a name prefix", async () => {
    const storage = createMemoryStorage();
    await storage.put("users/alice/a.pdf", new Uint8Array([1]), "application/pdf");
    await storage.put("users/alice2/b.pdf", new Uint8Array([2]), "application/pdf");
    await storage.deleteUserFiles("alice");
    expect([...storage.files.keys()]).toEqual(["users/alice2/b.pdf"]);
  });

  it("refuses anything that isn't a plain user id", () => {
    for (const bad of ["", "..", "a/b", "../x", "a b", "x".repeat(65)]) {
      expect(() => userFolder(bad)).toThrow("Unsafe user id");
    }
    expect(userFolder("cmw376qw100gxhsvpa4py4ami")).toBe("users/cmw376qw100gxhsvpa4py4ami/");
  });
});
