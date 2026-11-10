// Pathfinder extension: Greenhouse's hosted application form (job-boards.greenhouse.io), as read
// from real postings on 10 November 2026: <form id="application-form">; every control's id is the
// field's name in Greenhouse's API (first_name, question_123, question_123[] for multi-selects), so
// the answers the server prepared from that API fit it directly; drop-downs are react-select;
// multi-choice questions are checkboxes named question_123[]; resume and cover letter are hidden
// file inputs #resume and #cover_letter.

import { attachFile, chooseInCombobox, chooseInputs, chooseInSelect, comboboxChoices, comboboxOptions, isVisible, labelOf, norm, setValue } from "./fill";
import type { Answer, FieldOption, FormField } from "./protocol";

export type Files = Partial<Record<"resume" | "cover_letter", File>>;

/** What the page shows after Submit, or before it when something only the student can do appears. */
export type Outcome = { kind: "confirmed"; text: string } | { kind: "challenge" } | { kind: "email-code" } | { kind: "error"; text: string };

/** A control on the form, by the field name it answers. */
type Control =
  | { kind: "text"; key: string; element: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "combobox"; key: string; element: HTMLInputElement }
  | { kind: "select"; key: string; element: HTMLSelectElement }
  | { kind: "choices"; key: string; elements: HTMLInputElement[] }
  | { kind: "file"; key: string; element: HTMLInputElement };

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "number", "search", ""]);

export function findForm(doc: Document): HTMLFormElement | null {
  return doc.querySelector<HTMLFormElement>("form#application-form, form#application_form, form.application--form");
}

/** Every question on the form, once each. */
function controls(form: HTMLFormElement): Control[] {
  const found: Control[] = [];
  const groups = new Map<string, HTMLInputElement[]>();
  for (const element of Array.from(form.querySelectorAll<HTMLElement>("input, textarea, select"))) {
    if (element instanceof HTMLSelectElement) {
      if (element.id) found.push({ kind: "select", key: element.id, element });
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.id) found.push({ kind: "text", key: element.id, element });
    } else if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === "checkbox" || type === "radio") {
        const name = element.name || element.id;
        if (!name) continue;
        if (!groups.has(name)) {
          groups.set(name, []);
          found.push({ kind: "choices", key: name, elements: groups.get(name)! });
        }
        groups.get(name)!.push(element);
      } else if (type === "file") {
        if (element.id) found.push({ kind: "file", key: element.id, element });
      } else if (element.getAttribute("role") === "combobox") {
        if (element.id) found.push({ kind: "combobox", key: element.id, element });
      } else if (TEXT_TYPES.has(type) && element.id) {
        // react-select's stand-in for the browser's required check has no id, so it's left out here.
        found.push({ kind: "text", key: element.id, element });
      }
    }
  }
  return found;
}

/** The control answering field `key`; multi-selects are named with [] in some places and without in others. */
function controlFor(form: HTMLFormElement, key: string): Control | null {
  const all = controls(form);
  const twin = key.endsWith("[]") ? key.slice(0, -2) : `${key}[]`;
  return all.find((control) => control.key === key) ?? all.find((control) => control.key === twin) ?? null;
}

/** The question's wording as the page shows it (with its asterisk): a file input's own label is just "Attach", so it looks further up. */
function rawLabel(control: Control): string {
  const element = control.kind === "choices" ? control.elements[0] : control.element;
  const doc = element.ownerDocument;
  if (control.kind !== "file" && control.kind !== "choices") {
    const own = doc.getElementById(`${element.id}-label`) ?? doc.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (own?.textContent?.trim()) return own.textContent;
  }
  const legend = element.closest("fieldset")?.querySelector("legend")?.textContent;
  if (legend?.trim()) return legend;
  for (let node: Element | null = element.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    const label = node.querySelector(':scope > .label, :scope > label, :scope > [id$="-label"], :scope > .upload-label');
    // Not the input's own label ("Attach"), the question's.
    if (label && !label.contains(element) && label.getAttribute("for") !== element.id && label.textContent?.trim()) return label.textContent;
  }
  return control.kind === "choices" ? labelOf(element) : control.key;
}

const clean = (text: string) => text.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
const questionLabel = (control: Control) => clean(rawLabel(control));

function isRequired(control: Control): boolean {
  const elements = control.kind === "choices" ? control.elements : [control.element];
  if (elements.some((element) => element.required || element.getAttribute("aria-required") === "true")) return true;
  // Greenhouse marks required questions with an asterisk after the wording.
  return /\*\s*$/.test(rawLabel(control).trim());
}

function isEmpty(control: Control): boolean {
  switch (control.kind) {
    case "text":
      return control.element.value.trim() === "";
    case "combobox":
      return comboboxChoices(control.element).length === 0;
    case "select":
      return control.element.value === "";
    case "choices":
      return !control.elements.some((element) => element.checked);
    case "file":
      return (control.element.files?.length ?? 0) === 0;
  }
}

async function fieldOf(control: Control): Promise<FormField> {
  const base = { key: control.key, label: questionLabel(control), required: isRequired(control) };
  switch (control.kind) {
    case "text":
      return { ...base, type: control.element instanceof HTMLTextAreaElement ? "textarea" : "text", options: [] };
    case "file":
      return { ...base, type: "file", options: [] };
    case "select":
      return {
        ...base,
        type: control.element.multiple ? "multi" : "single",
        options: Array.from(control.element.options)
          .filter((option) => option.value !== "")
          .map((option) => ({ label: (option.textContent ?? "").trim(), value: option.value })),
      };
    case "choices": {
      const options: FieldOption[] = control.elements.map((element) => ({ label: labelOf(element), value: element.value }));
      return { ...base, type: control.elements[0].type === "radio" ? "single" : "multi", options };
    }
    case "combobox": {
      const multi = control.key.endsWith("[]") || control.element.closest("[aria-multiselectable='true']") !== null;
      const options = (await comboboxOptions(control.element)).map((label) => ({ label, value: label }));
      return { ...base, type: multi ? "multi" : "single", options };
    }
  }
}

/** The form's questions, for the server to answer when it couldn't read the form itself. */
export async function readFields(form: HTMLFormElement): Promise<FormField[]> {
  const fields: FormField[] = [];
  for (const control of controls(form)) fields.push(await fieldOf(control));
  return fields;
}

/** Required questions still unanswered. */
export async function emptyRequired(form: HTMLFormElement): Promise<FormField[]> {
  const fields: FormField[] = [];
  for (const control of controls(form)) if (isRequired(control) && isEmpty(control)) fields.push(await fieldOf(control));
  return fields;
}

async function fillOne(control: Control, answer: Answer, files: Files): Promise<boolean> {
  const labels = answer.kind === "option" ? [answer.label] : answer.kind === "options" ? answer.labels : answer.kind === "text" ? [answer.value] : [];
  const values = answer.kind === "option" ? [answer.value] : answer.kind === "options" ? answer.values : answer.kind === "text" ? [answer.value] : [];
  if (answer.kind === "file") {
    const file = files[answer.file];
    return control.kind === "file" && file !== undefined && attachFile(control.element, file);
  }
  switch (control.kind) {
    case "text":
      setValue(control.element, labels.join(", "));
      return control.element.value === labels.join(", ");
    case "combobox":
      return chooseInCombobox(control.element, labels);
    case "select":
      return chooseInSelect(control.element, { values, labels });
    case "choices":
      return chooseInputs(control.elements, { values, labels });
    case "file":
      return false;
  }
}

/** Fills the answers in; returns the questions it couldn't fill, by their wording. */
export async function fill(form: HTMLFormElement, answers: Record<string, Answer>, files: Files): Promise<string[]> {
  const unfilled: string[] = [];
  for (const [key, answer] of Object.entries(answers)) {
    const control = controlFor(form, key);
    if (!control) continue; // Not on this page (an optional question Greenhouse no longer shows).
    if (!(await fillOne(control, answer, files))) unfilled.push(questionLabel(control));
  }
  return unfilled;
}

export function submitButton(form: HTMLFormElement): HTMLButtonElement | null {
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"], input[type="submit"]')) as HTMLButtonElement[];
  return buttons.find((button) => isVisible(button) && !button.disabled) ?? null;
}

const THANKS = /(thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied))/i;
const EMAIL_CODE = /(security code|verification code|enter the code|code (was |has been )?sent to)/i;

const textOf = (root: Element | null | undefined) => ((root as HTMLElement | null)?.innerText ?? root?.textContent ?? "").replace(/\s+/g, " ").trim();

/** A puzzle shown to the student (not reCAPTCHA's invisible check, which needs nothing from them). */
export function challengeShown(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe")).some((frame) => {
    const source = frame.src || frame.getAttribute("src") || "";
    const puzzle = (/recaptcha/.test(source) && /\/bframe\b/.test(source)) || /hcaptcha\.com/.test(source) || /challenges\.cloudflare\.com/.test(source);
    const checkbox = /recaptcha/.test(source) && /\/anchor\b/.test(source) && /size=normal/.test(source);
    if (!puzzle && !checkbox) return false;
    if (!isVisible(frame)) return false;
    // reCAPTCHA keeps its puzzle frame on the page, moved off screen, until it's needed.
    const style = doc.defaultView?.getComputedStyle(frame.closest("div") ?? frame);
    if (style?.visibility === "hidden") return false;
    const box = frame.getBoundingClientRect();
    return box.width === 0 && box.height === 0 ? true : box.bottom > 0 && box.right > 0 && box.height > 40;
  });
}

/** What the page says now, once Submit was pressed (or null while it says nothing yet). */
export function outcome(doc: Document, location: { pathname: string; href: string }): Outcome | null {
  const form = findForm(doc);
  const formShown = form !== null && isVisible(form);
  if (challengeShown(doc)) return { kind: "challenge" };
  if (doc.querySelector('[id^="security-input"]') || EMAIL_CODE.test(textOf(doc.querySelector("main") ?? doc.body))) {
    if (!/\/confirmation\b/.test(location.pathname)) return { kind: "email-code" };
  }
  const body = textOf(doc.body);
  const thanks = body.match(THANKS);
  if (/\/confirmation\b/.test(location.pathname) || (thanks && !formShown)) {
    const sentence = thanks ? body.slice(Math.max(0, (thanks.index ?? 0) - 60), (thanks.index ?? 0) + thanks[0].length + 120) : body.slice(0, 200);
    return { kind: "confirmed", text: sentence.trim().slice(0, 300) };
  }
  if (form) {
    const errors = Array.from(doc.querySelectorAll('.helper-text--error, [role="alert"], [id$="-error"], .error-message, .field-error'))
      .filter((node) => isVisible(node))
      .map((node) => textOf(node))
      .filter(Boolean);
    if (errors.length > 0) return { kind: "error", text: errors[0] };
  }
  return null;
}

/** Whether this page is Greenhouse's own (the company didn't move the form to its own site). */
export const isGreenhouse = (hostname: string) => /(^|\.)greenhouse\.io$/.test(hostname);

export const greenhouse = { findForm, readFields, emptyRequired, fill, submitButton, outcome, challengeShown, norm };
