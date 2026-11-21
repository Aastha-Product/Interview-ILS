// Pathfinder extension: the job boards it fills, as their pages were read from real postings on
// 10 November 2026 (Greenhouse: Zscaler; Lever: Meesho; Ashby: Tekion) and 21 November 2026
// (SmartRecruiters: Bosch). Each says where its form
// is and how a question looks; form.ts does the rest.

import { ancestorsOf, deepQuery, deepQueryAll, deepText, isVisible, labelOf } from "./fill";
import { cleanLabel, isTextInput, markedRequired, type Board, type Control, type Question } from "./form";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const visibleButton = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).find((button) => isVisible(button) && !(button as HTMLButtonElement).disabled) ?? null;

/** Among the visible, enabled buttons, the one that reads like the final submit (else the first): a form
 *  with an earlier "Save draft" submit shouldn't be clicked instead of "Submit application" (QA L). */
const submitLike = (root: ParentNode, selector: string): HTMLElement | null => {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((button) => isVisible(button) && !(button as HTMLButtonElement).disabled);
  return buttons.find((button) => /submit|apply/i.test(`${button.textContent ?? ""} ${(button as HTMLInputElement).value ?? ""}`)) ?? buttons[0] ?? null;
};

/** A question's wording, looked for upwards from its control (a file input's own label is just "Attach"). */
function wordingAbove(element: Element): string {
  const legend = element.closest("fieldset")?.querySelector("legend")?.textContent;
  if (legend?.trim()) return legend;
  for (let node: Element | null = element.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    const label = node.querySelector(':scope > .label, :scope > label, :scope > [id$="-label"], :scope > .upload-label');
    if (label && !label.contains(element) && label.getAttribute("for") !== element.id && label.textContent?.trim()) return label.textContent;
  }
  return "";
}

const isRequiredElement = (element: Element) => (element as HTMLInputElement).required || element.getAttribute("aria-required") === "true";

/** Every control under `root`, one per question: radios and checkboxes by `groupKey`, the rest by `key`. */
function controlsIn(root: ParentNode, key: (element: Field) => string, groupKey: (element: HTMLInputElement) => string): { key: string; control: Control; elements: Field[] }[] {
  const found: { key: string; control: Control; elements: Field[] }[] = [];
  const groups = new Map<string, HTMLInputElement[]>();
  for (const element of Array.from(root.querySelectorAll<Field>("input, textarea, select"))) {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      const name = groupKey(element);
      if (!name) continue;
      if (!groups.has(name)) {
        groups.set(name, []);
        found.push({ key: name, control: { kind: "choices", elements: groups.get(name)! }, elements: groups.get(name)! });
      }
      groups.get(name)!.push(element);
      continue;
    }
    const name = key(element);
    if (!name) continue;
    if (element instanceof HTMLSelectElement) found.push({ key: name, control: { kind: "select", element }, elements: [element] });
    else if (element instanceof HTMLInputElement && element.type === "file") found.push({ key: name, control: { kind: "file", element }, elements: [element] });
    else if (element instanceof HTMLInputElement && element.getAttribute("role") === "combobox") found.push({ key: name, control: { kind: "combobox", element }, elements: [element] });
    // Hidden inputs and react-select's stand-in for the required check (no id) are left out by `key`.
    else if (isTextInput(element)) found.push({ key: name, control: { kind: "text", element }, elements: [element] });
  }
  return found;
}

// Greenhouse (job-boards.greenhouse.io): <form id="application-form">; every control's id is the
// field's name in Greenhouse's API (first_name, question_123, question_123[] for multi-selects), so
// the answers the server prepared from that API fit directly; drop-downs are react-select;
// multi-choice questions are checkboxes named question_123[]; files are #resume and #cover_letter.
export const greenhouse: Board = {
  name: "greenhouse",
  isHost: (hostname) => /(^|\.)greenhouse\.io$/.test(hostname),
  findForm: (doc) => doc.querySelector<HTMLFormElement>("form#application-form, form#application_form, form.application--form"),
  questions(form) {
    return controlsIn(
      form,
      (element) => (element.type === "hidden" ? "" : element.id),
      (element) => element.name || element.id,
    ).map(({ key, control, elements }): Question => {
      const first = elements[0];
      const doc = first.ownerDocument;
      const own = control.kind === "file" || control.kind === "choices" ? null : (doc.getElementById(`${first.id}-label`) ?? doc.querySelector(`label[for="${CSS.escape(first.id)}"]`));
      const raw = own?.textContent?.trim() ? own.textContent : wordingAbove(first) || (control.kind === "choices" ? labelOf(first) : key);
      return { key, label: cleanLabel(raw), required: elements.some(isRequiredElement) || markedRequired(raw), control };
    });
  },
  submitButton: (form) => submitLike(form, 'button[type="submit"], input[type="submit"]'),
  confirmationPath: /\/confirmation\b/,
};

// Lever (jobs.lever.co/…/apply): a plain <form id="application-form">, each question in
// li.application-question with its wording in .application-label (required ones end with ✱);
// controls are named (name, email, org, urls[LinkedIn], cards[…][field0]); the resume is
// input[name=resume], which Lever reads to fill fields itself; Submit is #btn-submit (it runs
// hCaptcha's invisible check first).
export const lever: Board = {
  name: "lever",
  isHost: (hostname) => hostname === "jobs.lever.co" || hostname === "jobs.eu.lever.co",
  findForm: (doc) => doc.querySelector<HTMLFormElement>("form#application-form, form.application-form"),
  questions(form) {
    const questions: Question[] = [];
    const seen = new Set<string>();
    const items = Array.from(form.querySelectorAll<HTMLElement>("li.application-question, .application-question"));
    for (const item of items) {
      if (item.parentElement?.closest(".application-question")) continue; // nested: counted with its parent
      const wording = item.querySelector(".application-label .text, .application-label")?.textContent ?? "";
      for (const { key, control, elements } of controlsIn(item, (element) => (element.type === "hidden" ? "" : element.name), (element) => element.name)) {
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = wording.trim() ? wording : labelOf(elements[0]);
        questions.push({ key, label: cleanLabel(raw), required: elements.some(isRequiredElement) || markedRequired(raw), control });
      }
    }
    return questions;
  },
  submitButton: (form) => visibleButton(form, '#btn-submit, button[data-qa="btn-submit"], button[type="submit"]'),
  confirmationPath: /\/thanks\b/,
  afterResumeMs: 3000,
};

// Ashby (jobs.ashbyhq.com/…/application): no <form>; questions are
// .ashby-application-form-field-entry, each with data-field-path (the field's id: _systemfield_name,
// or a uuid) and its wording in .ashby-application-form-question-title (class _required_… when
// required). Yes/No questions are two buttons (aria-pressed, data-option); options of a checkbox
// question share one id; location is an autocomplete; Submit is .ashby-application-form-submit-button.
export const ashby: Board = {
  name: "ashby",
  isHost: (hostname) => hostname === "jobs.ashbyhq.com",
  findForm: (doc) => doc.querySelector<HTMLElement>(".ashby-application-form-container"),
  questions(form) {
    const questions: Question[] = [];
    for (const entry of Array.from(form.querySelectorAll<HTMLElement>(".ashby-application-form-field-entry[data-field-path]"))) {
      const key = entry.dataset.fieldPath ?? "";
      const title = entry.querySelector(".ashby-application-form-question-title, label");
      const raw = title?.textContent ?? key;
      const required = /(^|\s|_)required/.test(title?.className.toString() ?? "") || markedRequired(raw);
      const control = ashbyControl(entry);
      if (!key || !control) continue;
      questions.push({ key, label: cleanLabel(raw), required, control });
      // A required radio/checkbox group sharing the entry with the main control (e.g. a consent box
      // next to the phone number) is otherwise dropped, and Ashby has no native form check to catch
      // it. Surface a required one as its own question so it's answered, not silently skipped. An
      // optional one stays ignored, as before (the phone number is the question, not its SMS consent).
      if (control.kind !== "choices" && control.kind !== "buttons" && control.kind !== "other") {
        const choices = Array.from(entry.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')).filter((input) => input.tabIndex !== -1);
        if (choices.length > 0 && choices.some(isRequiredElement)) {
          questions.push({ key: `${key}#choice`, label: cleanLabel(labelOf(choices[0]) || raw), required: true, control: { kind: "choices", elements: choices } });
        }
      }
    }
    return questions;
  },
  submitButton: (form) => visibleButton(form.ownerDocument, ".ashby-application-form-submit-button"),
  preSubmitInvalid(form) {
    const errors = Array.from(form.querySelectorAll('[class*="_error_"], [role="alert"], [id$="-error"], .error-message, .field-error'))
      .filter((node) => isVisible(node))
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (errors.length > 0) return [...new Set(errors)];
    // Ashby keeps Submit disabled until the form validates; a disabled button means something's missing.
    const button = form.ownerDocument.querySelector<HTMLButtonElement>(".ashby-application-form-submit-button");
    if (button && (button.disabled || button.getAttribute("aria-disabled") === "true")) return ["a required question on the form"];
    return [];
  },
};

function ashbyControl(entry: HTMLElement): Control | null {
  const buttons = Array.from(entry.querySelectorAll<HTMLButtonElement>("button[data-option], .ashby-application-form-input-yesno-option"));
  if (buttons.length > 0) return { kind: "buttons", elements: buttons };
  const file = entry.querySelector<HTMLInputElement>('input[type="file"]');
  if (file) return { kind: "file", element: file };
  const texts = Array.from(entry.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).filter(isTextInput);
  const selects = Array.from(entry.querySelectorAll("select"));
  const combobox = entry.querySelector<HTMLInputElement>('input[role="combobox"]');
  // Education history and the like: several inputs for one question.
  if (texts.length + selects.length + (combobox ? 1 : 0) > 1) {
    return { kind: "other", elements: [...texts, ...selects, ...(combobox ? [combobox] : [])] };
  }
  // The phone number's entry also asks about text messages: the number is the question.
  if (texts.length === 1) return { kind: "text", element: texts[0] };
  if (combobox) return { kind: "combobox", element: combobox };
  if (selects.length === 1) return { kind: "select", element: selects[0] };
  const choices = Array.from(entry.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'));
  if (choices.length > 0) return { kind: "choices", elements: choices };
  return null;
}

// SmartRecruiters (jobs.smartrecruiters.com/oneclick-ui/…), as read from a real Bosch posting on 21
// November 2026: an Angular app (oc-* components) built from web components (spl-*), so every
// control sits in a shadow root and there's no <form>. Page 1 (oc-oneclick-form) asks the person's
// details by id (first-name-input, email-input, confirm-email-input, linkedin-input…), each with a
// <label for> in the same shadow root, "*" when required; the resume goes in oc-resume-upload's
// drop zone. A second page, /screening, holds the company's questions, each in
// [data-test="question-container"]. The footer's buttons are oc-button[data-test="footer-next"]
// and [data-test="footer-submit"]; once sent, the page moves to /success.
const SR_SKIP = new Set([
  // "Apply with your resume" at the top reads a resume and rewrites the form: ours is filled in instead.
  "oc-apply-with-resume",
  // The phone field's country search; the number beside it is the question.
  "spl-dropdown-search",
]);

/** A control's wording: its <label for> in its own shadow root, a host's label attribute, or aria-label. */
function srWording(element: Element): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const own = element.id ? root.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : null;
  if (own?.trim()) return own;
  for (let host = (root as ShadowRoot).host, depth = 0; host && depth < 4; host = (host.getRootNode() as ShadowRoot).host, depth++) {
    const label = host.getAttribute("label");
    if (label?.trim()) return label;
  }
  return element.getAttribute("aria-label") ?? "";
}

/** A screening question's wording: the first heading-like text in its container. */
function srQuestionTitle(container: Element): string {
  const title = deepQuery(container, 'legend, [data-test="question-title"], [class*="question-title"], [class*="title"], label');
  return (title?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The footer button with this data-test, as the native button inside it that takes the click. */
function srFooterButton(doc: Document, test: string): HTMLElement | null {
  const host = deepQuery(doc, `oc-button[data-test="${test}"]`);
  if (!host || !isVisible(host)) return null;
  const button = deepQuery<HTMLButtonElement>(host, "button") ?? (host as HTMLElement);
  return (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true" ? null : button;
}

export const smartrecruiters: Board = {
  name: "smartrecruiters",
  isHost: (hostname) => hostname === "jobs.smartrecruiters.com",
  // Page 1's form, else the screening page's questions.
  findForm: (doc) => deepQuery(doc, "oc-oneclick-form") ?? deepQuery(doc, '[data-test="question-container"]')?.parentElement ?? null,
  questions(form) {
    const questions: Question[] = [];
    const seen = new Set<string>();
    const add = (question: Question) => {
      if (seen.has(question.key)) return;
      seen.add(question.key);
      questions.push(question);
    };
    // The screening page: each container is one question, however many inputs it has.
    const containers = deepQueryAll(form.ownerDocument, '[data-test="question-container"]');
    const inContainer = new Set<Element>();
    containers.forEach((container, index) => {
      const fields = deepQueryAll<Field>(container, "input, textarea, select").filter((element) => element.type !== "hidden" && element.type !== "file");
      fields.forEach((element) => inContainer.add(element));
      if (fields.length === 0) return;
      const raw = srQuestionTitle(container) || srWording(fields[0]);
      const required = fields.some(isRequiredElement) || markedRequired(raw);
      const choices = fields.filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox"));
      const key = `question-${index}:${cleanLabel(raw).slice(0, 80)}`;
      if (choices.length > 0) add({ key, label: cleanLabel(raw), required, control: { kind: "choices", elements: choices } });
      else if (fields.length > 1) add({ key, label: cleanLabel(raw), required, control: { kind: "other", elements: fields } });
      else if (fields[0] instanceof HTMLSelectElement) add({ key, label: cleanLabel(raw), required, control: { kind: "select", element: fields[0] } });
      else if (isTextInput(fields[0])) add({ key, label: cleanLabel(raw), required, control: { kind: "text", element: fields[0] } });
    });
    // Page 1's own fields, by id.
    for (const element of deepQueryAll<Field>(form, "input, textarea, select")) {
      if (inContainer.has(element) || element.type === "hidden") continue;
      const hosts = ancestorsOf(element);
      if (hosts.some((host) => SR_SKIP.has(host))) continue;
      const raw = srWording(element);
      const required = isRequiredElement(element) || markedRequired(raw);
      if (element instanceof HTMLInputElement && element.type === "file") {
        // The drop zone's own words are "Choose a file or drop it here": the section says what it's for.
        if (!hosts.includes("oc-resume-upload")) continue;
        add({ key: "resume", label: "Resume", required, control: { kind: "file", element } });
        continue;
      }
      const key = element.id || `${hosts[0] ?? element.tagName.toLowerCase()}:${cleanLabel(raw)}`;
      // A place typed into the city autocomplete needs a suggestion picked: the student does it if it's required.
      if (hosts.includes("spl-autocomplete")) {
        if (required) add({ key, label: cleanLabel(raw), required, control: { kind: "other", elements: [element] } });
        continue;
      }
      if (element instanceof HTMLSelectElement) add({ key, label: cleanLabel(raw), required, control: { kind: "select", element } });
      else if (isTextInput(element)) add({ key, label: cleanLabel(raw), required, control: { kind: "text", element } });
    }
    return questions;
  },
  submitButton: (form) => srFooterButton(form.ownerDocument, "footer-submit"),
  nextButton: (form) => srFooterButton(form.ownerDocument, "footer-next"),
  preSubmitInvalid(form) {
    const doc = form.ownerDocument;
    const summary = deepQueryAll(doc, "oc-validation-summary").filter(isVisible).map((node) => deepText(node)).filter(Boolean);
    const invalid = deepQueryAll<Field>(doc, 'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]').map((element) => cleanLabel(srWording(element))).filter(Boolean);
    return [...new Set([...summary, ...invalid])];
  },
  confirmationPath: /\/success\b/,
  pageText: (doc) => deepText(doc.body),
};

export const BOARDS: readonly Board[] = [greenhouse, lever, ashby, smartrecruiters];

/** The board this page belongs to, or null (a company's own site). */
export const boardFor = (hostname: string): Board | null => BOARDS.find((board) => board.isHost(hostname)) ?? null;
