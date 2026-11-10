// Pathfinder extension: the job boards it fills, as their pages were read from real postings on
// 10 November 2026 (Greenhouse: Zscaler; Lever: Meesho; Ashby: Tekion). Each says where its form
// is and how a question looks; form.ts does the rest.

import { isVisible, labelOf } from "./fill";
import { cleanLabel, isTextInput, markedRequired, type Board, type Control, type Question } from "./form";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const visibleButton = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).find((button) => isVisible(button) && !(button as HTMLButtonElement).disabled) ?? null;

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
  submitButton: (form) => visibleButton(form, 'button[type="submit"], input[type="submit"]'),
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
      if (key && control) questions.push({ key, label: cleanLabel(raw), required, control });
    }
    return questions;
  },
  submitButton: (form) => visibleButton(form.ownerDocument, ".ashby-application-form-submit-button"),
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

export const BOARDS: readonly Board[] = [greenhouse, lever, ashby];

/** The board this page belongs to, or null (a company's own site). */
export const boardFor = (hostname: string): Board | null => BOARDS.find((board) => board.isHost(hostname)) ?? null;
