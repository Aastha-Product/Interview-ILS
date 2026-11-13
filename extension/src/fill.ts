// Pathfinder extension: filling a form the way a person would, so the page's own code (React, in
// Greenhouse's case) sees every change. Runs in the job's tab, which is usually in the background:
// nothing here relies on the page having focus.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `probe` returns something, or gives up with null. */
export async function until<T>(probe: () => T | null | undefined | false, { timeout = 10_000, every = 250 } = {}): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() >= end) return null;
    await sleep(every);
  }
}

/** Lower case, accents and punctuation dropped: "Yes, I am" and "yes i am" match. */
export const norm = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const fire = (element: Element, type: string) => element.dispatchEvent(new Event(type, { bubbles: true }));

/** Types `value` into a text box: the native setter, then the events typing sends. */
export function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  fire(element, "input");
  fire(element, "change");
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/** Picks options of a native <select> by value or label. */
export function chooseInSelect(select: HTMLSelectElement, wanted: { values: string[]; labels: string[] }): boolean {
  const values = new Set(wanted.values);
  const labels = new Set(wanted.labels.map(norm));
  let chosen = 0;
  for (const option of Array.from(select.options)) {
    const match = (option.value !== "" && values.has(option.value)) || labels.has(norm(option.textContent));
    if (match) chosen++;
    if (select.multiple) option.selected = match;
    else if (match && chosen === 1) select.value = option.value;
  }
  if (chosen === 0) return false;
  fire(select, "input");
  fire(select, "change");
  return true;
}

/** Ticks the checkboxes or radio button named `name` whose value or label is wanted, and unticks the rest. */
export function chooseInputs(inputs: HTMLInputElement[], wanted: { values: string[]; labels: string[] }): boolean {
  const values = new Set(wanted.values);
  const labels = new Set(wanted.labels.map(norm));
  // Ashby's options have no values (each reads "on"): then only their words tell them apart.
  const distinct = new Set(inputs.map((input) => input.value)).size === inputs.length;
  const want = (input: HTMLInputElement) => (distinct && values.has(input.value)) || labels.has(norm(choiceLabel(input)));
  if (!inputs.some(want)) return false;
  // click() sends the click React listens to for checkboxes, and toggles like a person would.
  for (const input of inputs) if (input.checked !== want(input)) input.click();
  return inputs.every((input) => input.checked === want(input));
}

/** A checkbox's or radio button's own words: its <label>, or the text right beside it. */
export function choiceLabel(input: HTMLInputElement): string {
  const text = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const doc = input.ownerDocument;
  const byFor = input.id ? doc.querySelectorAll(`label[for="${CSS.escape(input.id)}"]`) : [];
  // Ashby gives every option of a question the same id, so a label for it is ambiguous.
  const own = byFor.length === 1 ? byFor[0] : input.closest("label");
  const words = own ? text(own) : text(input.nextElementSibling ?? input.parentElement ?? input);
  return words || input.value;
}

/** The text of the label for an input: <label for>, a wrapping <label>, or aria-label. */
export function labelOf(element: Element): string {
  const id = element.id;
  const byFor = id ? element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const text = byFor?.textContent ?? element.closest("label")?.textContent ?? element.getAttribute("aria-label") ?? "";
  return text.replace(/\*\s*$/, "").replace(/\s+/g, " ").trim();
}

// react-select, which Greenhouse uses for every drop-down: its input has role="combobox", and its
// options render, once its menu opens, in #react-select-{id}-listbox.

/** Where a combobox's options show: react-select's own listbox, the one it names, or one beside it (Ashby). */
function listboxOf(input: HTMLInputElement): Element | null {
  const doc = input.ownerDocument;
  return (
    (input.id ? doc.getElementById(`react-select-${input.id}-listbox`) : null) ??
    doc.getElementById(input.getAttribute("aria-controls") ?? "") ??
    input.closest(".ashby-application-form-field-entry, [class*='container']")?.querySelector('[role="listbox"]') ??
    null
  );
}
const optionsOf = (input: HTMLInputElement) => Array.from(listboxOf(input)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
const reactSelectOf = (input: HTMLInputElement) => input.closest<HTMLElement>('[class*="select__control"], [class*="-control"]');
const controlOf = (input: HTMLInputElement) => reactSelectOf(input) ?? input.parentElement;

/** What a combobox shows as chosen: react-select's values, or (an autocomplete) the input's text. */
export function comboboxChoices(input: HTMLInputElement): string[] {
  const control = reactSelectOf(input);
  if (!control) return input.value.trim() ? [input.value.trim()] : [];
  const multi = Array.from(control.querySelectorAll('[class*="multi-value__label"], [class*="multiValue"] > div:first-child')).map((node) => node.textContent ?? "");
  if (multi.length > 0) return multi;
  const single = control.querySelector('[class*="single-value"], [class*="singleValue"]')?.textContent;
  return single ? [single] : [];
}

/** The same option: exactly, or (loose, for a written answer) one that starts with it, else contains it. */
function matches(text: string | null | undefined, label: string, loose: boolean): boolean {
  const [have, want] = [norm(text), norm(label)];
  if (have === want) return true;
  if (!loose || want === "") return false;
  // Starts-with only: a bare "includes" picked the wrong suggestion ("York" matching "New York"),
  // so a written answer must begin the option (QA M4). The word-subset below covers "Pune, India".
  if (have.startsWith(want)) return true;
  // "Pune, India" is "Pune, Maharashtra, India": it starts the same and has every word.
  const words = want.split(" ");
  const own = new Set(have.split(" "));
  return have.startsWith(`${words[0]} `) && words.every((word) => own.has(word));
}

/** Opens a react-select's menu without focus: the drop-down arrow's mousedown opens it whatever the focus. */
async function openMenu(input: HTMLInputElement): Promise<HTMLElement[]> {
  if (optionsOf(input).length > 0) return optionsOf(input);
  const control = controlOf(input);
  const arrow = control?.parentElement?.querySelector<HTMLElement>('[class*="indicator"] button, [class*="indicatorContainer"], [class*="dropdown-indicator"], [class*="indicators"] button') ?? null;
  // The arrow opens on mousedown in react-select; Greenhouse's own arrow button may want a click.
  const attempts: [HTMLElement | null, string][] = [
    [arrow, "mousedown"],
    [arrow, "click"],
    [control, "mousedown"],
  ];
  for (const [target, type] of attempts) {
    if (!target) continue;
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    const options = await until(() => (optionsOf(input).length > 0 ? optionsOf(input) : null), { timeout: 500, every: 100 });
    if (options) return options;
  }
  return [];
}

/** The options a react-select offers, read by opening its menu and closing it again. */
export async function comboboxOptions(input: HTMLInputElement): Promise<string[]> {
  const options = (await openMenu(input)).map((option) => (option.textContent ?? "").trim());
  closeMenu(input);
  return options;
}

function closeMenu(input: HTMLInputElement) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
}

function pickFrom(options: HTMLElement[], label: string, loose: boolean): HTMLElement | null {
  return options.find((option) => matches(option.textContent, label, false)) ?? (loose ? (options.find((option) => matches(option.textContent, label, true)) ?? null) : null);
}

/** Chooses `labels` in a combobox: opens its menu (or types the label to filter it) and clicks each option. */
export async function chooseInCombobox(input: HTMLInputElement, labels: string[], { loose = false } = {}): Promise<boolean> {
  const chosen = () => comboboxChoices(input);
  // An autocomplete shows what's typed as its value: only a react-select's values count before choosing.
  const already = (label: string) => reactSelectOf(input) !== null && chosen().some((value) => matches(value, label, loose));
  for (const label of labels) {
    if (already(label)) continue;
    let option = reactSelectOf(input) ? pickFrom(await openMenu(input), label, loose) : null;
    // Long lists (countries, schools, places) may only show what's typed; for a written answer,
    // its first part too ("Pune" for "Pune, India"), as suggestions only contain what's typed.
    const typings = loose ? [...new Set([label, label.split(",")[0].trim()])].filter(Boolean) : [label];
    for (const typed of typings) {
      if (option) break;
      setValue(input, typed);
      option = await until(() => pickFrom(optionsOf(input), label, loose), { timeout: 3000, every: 150 });
    }
    if (!option) {
      // Nothing fits: no stray search text left behind for the student.
      if (input.value) setValue(input, "");
      closeMenu(input);
      return false;
    }
    const picked = option.textContent ?? label;
    option.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await until(() => chosen().some((value) => matches(value, picked, false)) && optionsOf(input).length === 0, { timeout: 2000, every: 100 });
  }
  closeMenu(input);
  return labels.every((label) => chosen().some((value) => matches(value, label, loose)));
}

/** A PDF from Pathfinder, as a File to attach. */
export function fileFrom(document: { name: string; type: string; base64: string }): File {
  const binary = atob(document.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], document.name, { type: document.type });
}

/** Attaches `file` to a file input, as dropping it would. */
export function attachFile(input: HTMLInputElement, file: File): boolean {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  fire(input, "input");
  fire(input, "change");
  return (input.files?.length ?? 0) > 0;
}

/** Whether an element is on screen (not display:none, hidden or zero-sized). */
export function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(html);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  // Where nothing is laid out (tests), sizes say nothing; in Chrome, inside a hidden parent means no boxes.
  const laidOut = (element.ownerDocument.body?.getClientRects().length ?? 0) > 0;
  return !laidOut || html.getClientRects().length > 0;
}
