import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type ResumeKind = "pdf" | "docx";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const RESUME_MIME: Record<ResumeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = Buffer.from(needle, "ascii");
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(target);
}

/**
 * Identifies the file by its contents, not its name or the browser's claimed type.
 * PDF starts with "%PDF-". A .docx is a ZIP ("PK\x03\x04") that contains word/document.xml.
 */
export function sniffResumeKind(bytes: Uint8Array): ResumeKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && containsAscii(bytes, "word/document.xml")) return "docx";
  return null;
}

/** Plain text of a resume, with tidy line breaks. */
export async function extractResumeText(bytes: Uint8Array, kind: ResumeKind): Promise<string> {
  let raw: string;
  if (kind === "pdf") {
    // pdf.js may take ownership of the buffer, so give it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    raw = (await extractText(pdf, { mergePages: true })).text;
  } else {
    raw = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  }
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
