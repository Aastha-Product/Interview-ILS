// Phase 5: a resume's text, read in the visitor's browser for the public ATS checker, so the file
// never leaves their device. PDF (unpdf), Word .docx (mammoth) or plain text, loaded only when a
// file is chosen. A scanned PDF has no text to read, and says so.

/** The largest file read: resumes are rarely over 1 MB. */
export const BROWSER_RESUME_MAX_BYTES = 5 * 1024 * 1024;

export type BrowserResumeText = { ok: true; text: string } | { ok: false; error: string };

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

export async function readResumeFile(file: File): Promise<BrowserResumeText> {
  if (file.size > BROWSER_RESUME_MAX_BYTES) return { ok: false, error: "That file is over 5 MB. Export your resume again without images." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      text = (await extractText(await getDocumentProxy(bytes), { mergePages: true })).text;
    } else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ arrayBuffer: bytes.buffer as ArrayBuffer })).value;
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
  } catch {
    return { ok: false, error: "That file couldn't be read here. Choose a PDF or .docx, or paste your resume's text instead." };
  }
  if (text.replace(/\s/g, "").length < 80) return { ok: false, error: "There's hardly any text in that file: it may be a scan. Paste your resume's text instead." };
  return { ok: true, text };
}
