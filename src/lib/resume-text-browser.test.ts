// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { BROWSER_RESUME_MAX_BYTES, readResumeFile } from "./resume-text-browser";

const pdf = vi.hoisted(() => ({ text: "", fail: false }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => {
    if (pdf.fail) throw new Error("bad pdf");
    return { text: pdf.text };
  }),
}));
vi.mock("mammoth", () => ({ extractRawText: vi.fn(async () => ({ value: "Asha Rao, Data Analyst. ".repeat(10) })) }));

const resume = "Asha Rao, Data Analyst with SQL and Python. ".repeat(5);
const file = (bytes: (string | Uint8Array)[], name = "resume") => new File(bytes as BlobPart[], name);

describe("reading a resume in the browser (Phase 5: ATS checker)", () => {
  it("reads PDF, Word and plain text by what the file starts with", async () => {
    pdf.text = resume;
    expect(await readResumeFile(file(["%PDF-1.7 ..."], "a.pdf"))).toEqual({ ok: true, text: resume });
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(await readResumeFile(file([docx], "a.docx"))).toMatchObject({ ok: true, text: expect.stringContaining("Data Analyst") });
    expect(await readResumeFile(file([resume], "a.txt"))).toEqual({ ok: true, text: resume });
  });

  it("says why it can't: too big, unreadable, or hardly any text", async () => {
    const big = new File([new Uint8Array(BROWSER_RESUME_MAX_BYTES + 1)], "big.pdf");
    expect(await readResumeFile(big)).toMatchObject({ ok: false, error: expect.stringContaining("over 5 MB") });
    pdf.fail = true;
    expect(await readResumeFile(file(["%PDF-1.7"], "broken.pdf"))).toMatchObject({ ok: false, error: expect.stringContaining("couldn't be read") });
    pdf.fail = false;
    pdf.text = "  ";
    expect(await readResumeFile(file(["%PDF-1.7"], "scan.pdf"))).toMatchObject({ ok: false, error: expect.stringContaining("may be a scan") });
    // Not text at all (invalid UTF-8).
    expect(await readResumeFile(file([new Uint8Array([0xff, 0xfe, 0xfd])], "x.bin"))).toMatchObject({ ok: false, error: expect.stringContaining("couldn't be read") });
  });
});
