import { describe, expect, it } from "vitest";
import { extractResumeText, sniffResumeKind } from "../src/resume/extract";
import { assertSafeKey, createLocalStorage } from "../src/storage";
import { fixture } from "./fixtures";

describe("sniffResumeKind", () => {
  it("recognises PDF and Word by content", () => {
    expect(sniffResumeKind(fixture("resume-asha.pdf"))).toBe("pdf");
    expect(sniffResumeKind(fixture("resume-asha.docx"))).toBe("docx");
  });

  it("rejects other files, whatever they are called", () => {
    expect(sniffResumeKind(fixture("not-a-resume.png"))).toBeNull();
    expect(sniffResumeKind(new TextEncoder().encode("Just some text, not a resume file"))).toBeNull();
    expect(sniffResumeKind(new Uint8Array())).toBeNull();
    // A ZIP that is not a Word document (no word/document.xml).
    expect(sniffResumeKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).toBeNull();
  });
});

describe("extractResumeText", () => {
  it.each([
    ["resume-asha.pdf", "pdf"],
    ["resume-asha.docx", "docx"],
  ] as const)("reads the text of %s", async (name, kind) => {
    const text = await extractResumeText(fixture(name), kind);
    for (const expected of [
      "Final-year B.Tech Computer Science student",
      "Library Management System | Java, MySQL",
      "• Wrote 40 JUnit test cases covering issue, return and fine calculation",
      "QA Intern at Example Softech Pvt Ltd Jun 2025 - Aug 2025",
      "github.com/asha-verma-example",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toContain("\r");
  });

  it("finds almost no text in a scanned-like PDF", async () => {
    const text = await extractResumeText(fixture("scanned-like.pdf"), "pdf");
    expect(text.length).toBeLessThan(20);
  });

  it("fails on a damaged file", async () => {
    const broken = fixture("resume-asha.pdf").slice(0, 40);
    await expect(extractResumeText(broken, "pdf")).rejects.toThrow();
  });
});

describe("storage keys", () => {
  it("refuses keys that could escape the storage folder", async () => {
    for (const bad of ["../etc/passwd", "users/../../x", "/abs/path", "users//x", "users\\x", ""]) {
      expect(() => assertSafeKey(bad), bad).toThrow();
    }
    expect(() => assertSafeKey("users/abc123/resumes/1f2e.pdf")).not.toThrow();
    const storage = createLocalStorage(".local/never-used");
    await expect(storage.put("../outside.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow();
  });
});
