import type { ResumeContent } from "../applications/types";

/**
 * Renders a resume as a self-contained HTML document for Chromium's PDF printer.
 * Single column, real text and headings (ATS-friendly), system fonts, no images, no scripts and
 * no external resources. Everything from the content is HTML-escaped; links must be http(s).
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);
}

/** Only http(s) URLs survive; anything else (javascript:, data:, …) is dropped. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const e = escapeHtml;
const nonEmpty = (values: Array<string | undefined | null>) => values.map((v) => (v ?? "").trim()).filter(Boolean);

function bulletList(bullets: Array<{ text: string }>): string {
  const items = bullets.map((b) => b.text.trim()).filter(Boolean);
  if (items.length === 0) return "";
  return `<ul>${items.map((t) => `<li>${e(t)}</li>`).join("")}</ul>`;
}

function section(title: string, body: string): string {
  return body.trim() ? `<section><h2>${e(title)}</h2>${body}</section>` : "";
}

const STYLES = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; font-size: 10.5pt; color: #111; line-height: 1.35; }
  body { margin: 0; }
  header { margin-bottom: 10pt; }
  h1 { font-size: 18pt; margin: 0 0 2pt; }
  .contact { font-size: 9.5pt; color: #333; margin: 0; }
  .contact a { color: #1d4ed8; text-decoration: none; }
  .headline { font-weight: 600; margin: 4pt 0 0; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 2pt; margin: 12pt 0 6pt; }
  h3 { font-size: 10.5pt; margin: 0; }
  .item { margin-bottom: 7pt; break-inside: avoid; }
  .meta { color: #444; font-size: 9.5pt; margin: 0; }
  ul { margin: 3pt 0 0 14pt; padding: 0; }
  li { margin: 0 0 2pt; }
  p { margin: 0; }
`;

export function resumeToHtml(content: ResumeContent): string {
  const h = content.header;
  const links = h.links
    .map((l) => ({ label: l.label.trim() || l.url, href: safeHref(l.url) }))
    .filter((l): l is { label: string; href: string } => l.href !== null)
    .map((l) => `<a href="${e(l.href)}">${e(l.label)}</a>`);
  const contact = [...nonEmpty([h.email, h.phone, h.location]).map(e), ...links].join(" · ");

  const header = `<header>${h.name.trim() ? `<h1>${e(h.name)}</h1>` : ""}${
    contact ? `<p class="contact">${contact}</p>` : ""
  }${content.headline.trim() ? `<p class="headline">${e(content.headline)}</p>` : ""}</header>`;

  const summary = content.summary.text.trim() ? `<p>${e(content.summary.text)}</p>` : "";
  const skills = content.skills.filter((s) => s.trim()).length ? `<p>${content.skills.filter((s) => s.trim()).map(e).join(", ")}</p>` : "";

  const experience = content.experiences
    .map((x) => {
      const titleLine = nonEmpty([x.title, x.company]).map(e).join(" — ");
      const meta = nonEmpty([x.location, x.dates]).map(e).join(" · ");
      const bullets = bulletList(x.bullets);
      if (!titleLine && !bullets) return "";
      return `<div class="item"><h3>${titleLine}</h3>${meta ? `<p class="meta">${meta}</p>` : ""}${bullets}</div>`;
    })
    .join("");

  const projects = content.projects
    .map((p) => {
      const href = p.url ? safeHref(p.url) : null;
      const name = p.name.trim() ? e(p.name) : "";
      const title = [name, p.role.trim() ? e(p.role) : ""].filter(Boolean).join(" — ");
      const meta = nonEmpty([p.technologies.filter((t) => t.trim()).join(", "), p.dates]).map(e).join(" · ");
      const link = href ? `<p class="meta"><a href="${e(href)}">${e(href)}</a></p>` : "";
      const bullets = bulletList(p.bullets);
      if (!title && !bullets) return "";
      return `<div class="item"><h3>${title}</h3>${meta ? `<p class="meta">${meta}</p>` : ""}${link}${bullets}</div>`;
    })
    .join("");

  const education = content.education
    .map((ed) => {
      const degree = nonEmpty([ed.degree, ed.field]).map(e).join(", ");
      const meta = nonEmpty([ed.dates, ed.grade]).map(e).join(" · ");
      if (!ed.institution.trim() && !degree) return "";
      return `<div class="item"><h3>${e(ed.institution)}</h3>${degree ? `<p>${degree}</p>` : ""}${meta ? `<p class="meta">${meta}</p>` : ""}</div>`;
    })
    .join("");

  const title = h.name.trim() ? `${e(h.name)} — Resume` : "Resume";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
${header}
${section("Summary", summary)}
${section("Skills", skills)}
${section("Experience", experience)}
${section("Projects", projects)}
${section("Education", education)}
</body>
</html>
`;
}
