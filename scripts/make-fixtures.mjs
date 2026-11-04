#!/usr/bin/env node
// Generates the binary test fixtures from fixtures/resume-asha.txt with no dependencies.
//
//   node scripts/make-fixtures.mjs
//
// Writes:
//   fixtures/resume-asha.pdf    hand-built PDF, Helvetica, one text line per resume line
//   fixtures/resume-asha.docx   minimal Word document, one paragraph per resume line
//   fixtures/scanned-like.pdf   valid PDF with almost no text (like a scanned image)
//   fixtures/not-a-resume.png   a 1x1 PNG
//
// The resume is fictional. Re-run this script after editing resume-asha.txt.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "fixtures");
const lines = readFileSync(path.join(fixtures, "resume-asha.txt"), "utf8")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .filter((l, i, all) => !(i === all.length - 1 && l === ""));

// ---------- PDF ----------

/** Encodes a line as a PDF literal string in WinAnsiEncoding (• = 0x95, – = 0x96). */
function pdfString(text) {
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (ch === "•") out += "\\225";
    else if (ch === "–") out += "\\226";
    else if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127) out += ch;
    else out += "-";
  }
  return `(${out})`;
}

/** Builds a PDF from page content streams, computing the xref table byte offsets. */
function buildPdf(pageStreams) {
  const objects = [];
  const pageCount = pageStreams.length;
  // 1: catalog, 2: pages, 3: font, then (page, content) pairs.
  const pageIds = pageStreams.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pageStreams.forEach((stream, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function textPage(pageLines) {
  const body = pageLines.map((l) => `${pdfString(l)} Tj T*`).join("\n");
  return `BT\n/F1 11 Tf\n14 TL\n50 800 Td\n${body}\nET`;
}

/**
 * Text past the right edge of the page is dropped by PDF readers, so long lines are split at
 * " | " separators (the contact line), the way a real resume would wrap.
 */
const MAX_PDF_CHARS = 95;
function wrapForPdf(line) {
  const out = [];
  let rest = line;
  while (rest.length > MAX_PDF_CHARS) {
    const cut = rest.lastIndexOf(" | ", MAX_PDF_CHARS);
    if (cut <= 0) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + 3);
  }
  out.push(rest);
  return out;
}
const pdfLines = lines.flatMap(wrapForPdf);

const LINES_PER_PAGE = 50;
const pages = [];
for (let i = 0; i < pdfLines.length; i += LINES_PER_PAGE) pages.push(textPage(pdfLines.slice(i, i + LINES_PER_PAGE)));
writeFileSync(path.join(fixtures, "resume-asha.pdf"), buildPdf(pages));

// A page that is mostly a drawn rectangle with a tiny caption, like a scanned photo of a resume.
writeFileSync(
  path.join(fixtures, "scanned-like.pdf"),
  buildPdf(["0.8 g\n50 300 495 500 re f\nBT\n/F1 8 Tf\n50 280 Td\n(Scan 1) Tj\nET"]),
);

// ---------- ZIP (store only) and DOCX ----------

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const paragraphs = lines
  .map((l) => (l ? `<w:p><w:r><w:t xml:space="preserve">${xml(l)}</w:t></w:r></w:p>` : "<w:p/>"))
  .join("");
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;

writeFileSync(
  path.join(fixtures, "resume-asha.docx"),
  zip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]),
);

// ---------- PNG ----------

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}
const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]); // 1x1, 8-bit RGB
const pixels = zlib.deflateSync(Buffer.from([0, 0x33, 0x66, 0x99])); // filter byte + RGB
writeFileSync(
  path.join(fixtures, "not-a-resume.png"),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0)),
  ]),
);

console.log("Wrote fixtures: resume-asha.pdf, resume-asha.docx, scanned-like.pdf, not-a-resume.png");
