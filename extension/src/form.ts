// Pathfinder extension: one way of filling forms for every job board. Each board (boards.ts) says
// where its form is and how its questions look; this reads them as the server's answer rules do
// (FormField), fills the answers in, and reads what the page says after Submit.

import { attachFile, choiceLabel, chooseInCombobox, chooseInputs, chooseInSelect, comboboxChoices, comboboxOptions, isVisible, norm, setValue, sleep, until } from "./fill";
import type { Answer, FieldOption, FormField } from "./protocol";

export type Files = Partial<Record<"resume" | "cover_letter", File>>;

/** What the page shows after Submit, or before it when something only the student can do appears. */
export type Outcome = { kind: "confirmed"; text: string } | { kind: "challenge" } | { kind: "email-code" } | { kind: "error"; text: string };

export type Control =
  | { kind: "text"; element: HTMLInputElement | HTMLTextAreaElement }
  /** react-select (Greenhouse) or an autocomplete (Ashby's location). */
  | { kind: "combobox"; element: HTMLInputElement }
  | { kind: "select"; element: HTMLSelectElement }
  | { kind: "choices"; elements: HTMLInputElement[] }
  /** Ashby's Yes and No buttons. */
  | { kind: "buttons"; elements: HTMLButtonElement[] }
  | { kind: "file"; element: HTMLInputElement }
  /** Several inputs for one question (Ashby's education history): left to the student. */
  | { kind: "other"; elements: (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] };

/** One question: the field name it answers, its wording, and its control. */
export type Question = { key: string; label: string; required: boolean; control: Control };

export type Board = {
  name: "greenhouse" | "lever" | "ashby";
  isHost(hostname: string): boolean;
  /** The form, or (Ashby) the element holding its questions. */
  findForm(doc: Document): HTMLElement | null;
  questions(form: HTMLElement): Question[];
  submitButton(form: HTMLElement): HTMLElement | null;
  /** The page's path once applied, where the board moves to one. */
  confirmationPath?: RegExp;
  /** How long to wait after attaching the resume: Lever reads it and fills fields in itself. */
  afterResumeMs?: number;
};

/** Collapses spaces and drops a trailing required mark (*, ✱). */
export const cleanLabel = (text: string) => text.replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/u, "").trim();
export const markedRequired = (text: string) => /[*✱]\s*$/u.test(text.trim());

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "number", "search", ""]);
export const isTextInput = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && TEXT_TYPES.has(element.type.toLowerCase()) && element.getAttribute("role") !== "combobox");

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
    case "buttons":
      return !control.elements.some((button) => button.getAttribute("aria-pressed") === "true");
    case "file":
      return (control.element.files?.length ?? 0) === 0;
    case "other":
      return control.elements.every((element) => element.value.trim() === "");
  }
}

const optionText = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();

async function fieldOf({ key, label, required, control }: Question): Promise<FormField> {
  const base = { key, label, required };
  switch (control.kind) {
    case "text":
      return { ...base, type: control.element instanceof HTMLTextAreaElement ? "textarea" : "text", options: [] };
    case "file":
      return { ...base, type: "file", options: [] };
    case "other":
      return { ...base, type: "text", options: [] };
    case "select":
      return {
        ...base,
        type: control.element.multiple ? "multi" : "single",
        options: Array.from(control.element.options)
          .filter((option) => option.value !== "")
          .map((option) => ({ label: optionText(option), value: option.value })),
      };
    case "choices": {
      const distinct = new Set(control.elements.map((element) => element.value)).size === control.elements.length;
      const options: FieldOption[] = control.elements.map((element) => ({ label: choiceLabel(element), value: distinct ? element.value : choiceLabel(element) }));
      return { ...base, type: control.elements[0].type === "radio" ? "single" : "multi", options };
    }
    case "buttons":
      return { ...base, type: "single", options: control.elements.map((button) => ({ label: optionText(button), value: button.dataset.option ?? optionText(button) })) };
    case "combobox": {
      const multi = key.endsWith("[]") || control.element.closest("[aria-multiselectable='true']") !== null;
      const options = (await comboboxOptions(control.element)).map((text) => ({ label: text, value: text }));
      // Suggestions that only come once something's typed (a place, a school): asked as a written
      // answer, which then picks the suggestion that starts with it.
      if (options.length === 0 && !multi) return { ...base, type: "text", options: [] };
      return { ...base, type: multi ? "multi" : "single", options };
    }
  }
}

/** The question answering field `key`; multi-selects are named with [] in some places and without in others. */
function questionFor(board: Board, form: HTMLElement, key: string): Question | null {
  const all = board.questions(form);
  const twin = key.endsWith("[]") ? key.slice(0, -2) : `${key}[]`;
  return all.find((question) => question.key === key) ?? all.find((question) => question.key === twin) ?? null;
}

/** The form's questions, for the server to answer when it couldn't read the form itself. */
export async function readFields(board: Board, form: HTMLElement): Promise<FormField[]> {
  const fields: FormField[] = [];
  for (const question of board.questions(form)) fields.push(await fieldOf(question));
  return fields;
}

/** Required questions still unanswered. */
export async function emptyRequired(board: Board, form: HTMLElement): Promise<FormField[]> {
  const fields: FormField[] = [];
  for (const question of board.questions(form)) if (question.required && isEmpty(question.control)) fields.push(await fieldOf(question));
  return fields;
}

async function fillOne(control: Control, answer: Answer, files: Files): Promise<boolean> {
  if (answer.kind === "file") {
    const file = files[answer.file];
    return control.kind === "file" && file !== undefined && attachFile(control.element, file);
  }
  const labels = answer.kind === "option" ? [answer.label] : answer.kind === "options" ? answer.labels : [answer.value];
  const values = answer.kind === "option" ? [answer.value] : answer.kind === "options" ? answer.values : [answer.value];
  switch (control.kind) {
    case "text":
      setValue(control.element, labels.join(", "));
      return control.element.value === labels.join(", ");
    case "combobox":
      // A written answer ("Pune") picks the suggestion that starts with it ("Pune, Maharashtra, India").
      return chooseInCombobox(control.element, labels, { loose: answer.kind === "text" });
    case "select":
      return chooseInSelect(control.element, { values, labels });
    case "choices":
      return chooseInputs(control.elements, { values, labels });
    case "buttons": {
      const wanted = new Set(labels.map(norm));
      const button = control.elements.find((candidate) => wanted.has(norm(candidate.textContent)) || values.includes(candidate.dataset.option ?? ""));
      if (!button) return false;
      if (button.getAttribute("aria-pressed") !== "true") button.click();
      return (await until(() => button.getAttribute("aria-pressed") === "true", { timeout: 1000, every: 100 })) === true;
    }
    case "file":
    case "other":
      return false;
  }
}

/** Fills the answers in, files first; returns the questions it couldn't fill, by their wording. */
export async function fill(board: Board, form: HTMLElement, answers: Record<string, Answer>, files: Files): Promise<string[]> {
  const unfilled: string[] = [];
  const entries = Object.entries(answers).sort(([, a], [, b]) => Number(b.kind === "file") - Number(a.kind === "file"));
  let attached = false;
  for (const [key, answer] of entries) {
    if (answer.kind !== "file" && attached && board.afterResumeMs) {
      // Lever reads the resume and fills fields in itself: ours go in after.
      await sleep(board.afterResumeMs);
      attached = false;
    }
    // Asked again each time: forms show some questions only after others are answered.
    const question = questionFor(board, form, key);
    if (!question) continue; // Not on this page (an optional question the board no longer shows).
    const done = await fillOne(question.control, answer, files);
    if (!done) unfilled.push(question.label);
    if (done && answer.kind === "file" && answer.file === "resume") attached = true;
  }
  return unfilled;
}

// "thank you for your interest" is marketing copy that also appears on error/landing pages, so it's
// not treated as proof of submission (QA M2); the signals kept all mean an application went through.
const THANKS = /(thank you for (applying|your application)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied)|application submitted)/i;
const EMAIL_CODE = /(security code|verification code|enter the code|code (was |has been )?sent to)/i;

const textOf = (root: Element | null | undefined) => ((root as HTMLElement | null)?.innerText ?? root?.textContent ?? "").replace(/\s+/g, " ").trim();

/** A puzzle shown to the student (not the invisible checks reCAPTCHA and hCaptcha run, which need nothing from them). */
export function challengeShown(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe")).some((frame) => {
    const source = frame.src || frame.getAttribute("src") || "";
    const puzzle =
      (/recaptcha/.test(source) && /\/bframe\b/.test(source)) ||
      /hcaptcha\.com/.test(source) ||
      /challenges\.cloudflare\.com/.test(source) || // Cloudflare Turnstile and the interstitial
      /(arkoselabs|funcaptcha)\.com/.test(source) || // Arkose Labs / FunCaptcha
      /captcha-delivery\.com/.test(source) || // DataDome
      /geetest\.com/.test(source); // GeeTest
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
export function outcome(board: Board, doc: Document, location: { pathname: string; href: string }): Outcome | null {
  const form = board.findForm(doc);
  const formShown = form !== null && isVisible(form);
  const confirmedPath = board.confirmationPath?.test(location.pathname) === true;
  if (challengeShown(doc)) return { kind: "challenge" };
  if (!confirmedPath && (doc.querySelector('[id^="security-input"]') || EMAIL_CODE.test(textOf(doc.querySelector("main") ?? doc.body)))) return { kind: "email-code" };
  const body = textOf(doc.body);
  const thanks = body.match(THANKS);
  if (confirmedPath || (thanks && !formShown)) {
    const sentence = thanks ? body.slice(Math.max(0, (thanks.index ?? 0) - 60), (thanks.index ?? 0) + thanks[0].length + 120) : body.slice(0, 200);
    return { kind: "confirmed", text: sentence.trim().slice(0, 300) };
  }
  if (form) {
    const errors = Array.from(doc.querySelectorAll('.helper-text--error, [role="alert"], [id$="-error"], .error-message, .field-error, .application-error, [class*="_error_"]'))
      .filter((node) => isVisible(node))
      .map((node) => textOf(node))
      .filter(Boolean);
    if (errors.length > 0) return { kind: "error", text: errors[0] };
  }
  return null;
}
