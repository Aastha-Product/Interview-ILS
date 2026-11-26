// Pathfinder extension (Phase 3): what the job page said when an application stopped short of
// applied, for the student to read on Auto-apply: the page's address and heading, the error
// messages it shows, and the labels of required questions still empty. It reads labels and the
// site's own messages only, never anything typed into the form.
import { isVisible } from "./fill";
import type { Report, Snapshot } from "./protocol";

const MESSAGES = "[role='alert'], [aria-live='assertive'], .error, .errors, .error-message, .field-error, .invalid-feedback, [data-automation-id='errorMessage'], .application--error";
const FIELDS = "input, textarea, select";
const SKIPPED_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "file", "password"]);

const words = (text: string | null | undefined, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A field's question, as its label, aria-label or placeholder words it. */
function labelOf(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const labelled = field.getAttribute("aria-labelledby");
  const fromIds = labelled ? labelled.split(/\s+/).map((id) => field.ownerDocument.getElementById(id)?.textContent ?? "").join(" ") : "";
  const label = field.labels?.[0]?.textContent ?? fromIds ?? "";
  return words(label || field.getAttribute("aria-label") || field.getAttribute("placeholder") || "", 150).replace(/\s*[*✱]$/u, "");
}

function isEmpty(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    const group = field.name ? field.form?.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(field.name)}"]`) : null;
    return !(group ? Array.from(group).some((input) => input.checked) : field.checked);
  }
  return field.value.trim() === "";
}

/** What the page shows now. */
export function pageSnapshot(doc: Document, href: string): Snapshot {
  const heading = Array.from(doc.querySelectorAll("h1, h2")).find((element) => isVisible(element) && words(element.textContent, 200));
  const messages = [
    ...new Set(
      Array.from(doc.querySelectorAll(MESSAGES))
        .filter((element) => isVisible(element))
        .map((element) => words(element.textContent, 300))
        .filter((text) => text.length > 1),
    ),
  ].slice(0, 8);
  const unfilled = [
    ...new Set(
      Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FIELDS))
        .filter((field) => !(field instanceof HTMLInputElement && SKIPPED_TYPES.has(field.type.toLowerCase())))
        .filter((field) => (field.required || field.getAttribute("aria-required") === "true" || field.getAttribute("aria-invalid") === "true") && isVisible(field) && isEmpty(field))
        .map(labelOf)
        .filter(Boolean),
    ),
  ].slice(0, 10);
  return { url: href.slice(0, 2000), title: words(heading?.textContent || doc.title, 200), messages, unfilled };
}

/** The report, with what the page said when it stopped short of applied. */
export function withSnapshot(report: Report, doc: Document, href: string): Report {
  if (report.outcome !== "needs-student" && report.outcome !== "uncertain" && report.outcome !== "failed") return report;
  try {
    return { ...report, snapshot: pageSnapshot(doc, href) };
  } catch {
    // A snapshot is a help, never a reason for the report not to arrive.
    return report;
  }
}
