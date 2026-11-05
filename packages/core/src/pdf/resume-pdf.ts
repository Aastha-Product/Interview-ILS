import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ResumeContent } from "../applications/types";

/**
 * Renders a resume straight to PDF with pdf-lib: no browser, no network, no files on disk. Used on
 * demo sites, which have no worker to run Chromium. Same sections and order as resume-html.ts:
 * one column, real text (ATS-friendly), A4.
 *
 * The built-in PDF fonts only cover Western European characters, so other characters are swapped
 * for close equivalents (curly quotes, dashes, bullets, ₹) or dropped. The Chromium renderer used by
 * the worker has no such limit.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 42;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.35, 0.37, 0.4);
const RULE = rgb(0.75, 0.77, 0.8);

const REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "•": "-",
  "●": "-",
  "…": "...",
  "₹": "Rs.",
  " ": " ",
  "→": "->",
};

/** Text the standard Helvetica font can draw (WinAnsi), with common symbols swapped. */
export function toPdfText(text: string): string {
  return [...text.normalize("NFC")]
    .map((ch) => REPLACEMENTS[ch] ?? ch)
    .join("")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

class Writer {
  page: PDFPage;
  y: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.y = PAGE.height - MARGIN;
    }
  }

  /** Splits text into lines that fit the width. Over-long words are broken mid-word. */
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = toPdfText(text).split(" ").filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  text(
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gapAfter?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.3;
    for (const line of this.wrap(text, font, size, CONTENT_WIDTH - indent)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y + size * 0.25,
        size,
        font,
        color: opts.color ?? INK,
      });
    }
    this.y -= opts.gapAfter ?? 0;
  }

  bullet(text: string) {
    const size = 10;
    const lines = this.wrap(text, this.fonts.regular, size, CONTENT_WIDTH - 14);
    lines.forEach((line, i) => {
      const lineHeight = size * 1.3;
      this.ensure(lineHeight);
      this.y -= lineHeight;
      if (i === 0)
        this.page.drawText("-", {
          x: MARGIN + 3,
          y: this.y + size * 0.25,
          size,
          font: this.fonts.regular,
          color: INK,
        });
      this.page.drawText(line, {
        x: MARGIN + 14,
        y: this.y + size * 0.25,
        size,
        font: this.fonts.regular,
        color: INK,
      });
    });
  }

  heading(title: string) {
    this.ensure(30);
    this.y -= 12;
    this.text(title.toUpperCase(), { size: 10.5, bold: true });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 2 },
      end: { x: PAGE.width - MARGIN, y: this.y - 2 },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 6;
  }
}

const joinParts = (...parts: Array<string | undefined>) =>
  parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" | ");

export async function renderResumePdf(content: ResumeContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const name = toPdfText(content.header.name) || "Resume";
  doc.setTitle(`${name} - Resume`);
  doc.setCreator("Pathfinder");
  doc.setProducer("Pathfinder");
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, fonts);

  w.text(name, { size: 18, bold: true, gapAfter: 2 });
  const contact = joinParts(content.header.email, content.header.phone, content.header.location);
  if (contact) w.text(contact, { size: 9.5, color: MUTED });
  const links = content.header.links
    .filter((l) => /^https?:\/\//i.test(l.url))
    .map((l) => `${l.label}: ${l.url.replace(/^https?:\/\//i, "")}`);
  if (links.length) w.text(links.join("  |  "), { size: 9.5, color: MUTED });
  if (content.headline) {
    w.y -= 4;
    w.text(content.headline, { size: 11, bold: true });
  }

  if (content.summary.text) {
    w.heading("Summary");
    w.text(content.summary.text);
  }
  if (content.skills.length) {
    w.heading("Skills");
    w.text(content.skills.join(", "));
  }
  const experiences = content.experiences.filter((e) => e.title || e.bullets.length);
  if (experiences.length) {
    w.heading("Experience");
    for (const e of experiences) {
      w.y -= 3;
      w.text(joinParts(e.title, e.company), { bold: true });
      const meta = joinParts(e.location, e.dates);
      if (meta) w.text(meta, { size: 9, color: MUTED });
      for (const b of e.bullets) if (b.text.trim()) w.bullet(b.text);
    }
  }
  const projects = content.projects.filter((p) => p.name || p.bullets.length);
  if (projects.length) {
    w.heading("Projects");
    for (const p of projects) {
      w.y -= 3;
      w.text(joinParts(p.name, p.role), { bold: true });
      const meta = joinParts(
        p.technologies.join(", "),
        p.dates,
        /^https?:\/\//i.test(p.url) ? p.url.replace(/^https?:\/\//i, "") : "",
      );
      if (meta) w.text(meta, { size: 9, color: MUTED });
      for (const b of p.bullets) if (b.text.trim()) w.bullet(b.text);
    }
  }
  if (content.education.length) {
    w.heading("Education");
    for (const e of content.education) {
      w.y -= 3;
      w.text([e.degree, e.field].filter(Boolean).join(", ") || e.institution, { bold: true });
      w.text(joinParts(e.degree || e.field ? e.institution : "", e.dates, e.grade), {
        size: 9.5,
        color: MUTED,
      });
    }
  }

  return doc.save();
}
