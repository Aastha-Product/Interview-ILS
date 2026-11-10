// A Greenhouse application form for tests, with the markup read from real postings on
// job-boards.greenhouse.io (10 November 2026), and a small stand-in for react-select that behaves
// the way its menu does: the arrow's mousedown opens it, typing filters it, clicking an option
// chooses it. Step 6 runs the extension against real react-select in Chrome.

export type ComboSpec = { id: string; label: string; required?: boolean; options: string[]; multi?: boolean; typeToShow?: boolean };

const star = (required?: boolean) => (required ? '<span aria-hidden="true">*</span>' : "");

function comboHtml(spec: ComboSpec): string {
  return `<div class="select__container">
    <label id="${spec.id}-label" for="${spec.id}" class="label select__label">${spec.label}${star(spec.required)}</label>
    <div class="select-shell"><div>
      <div class="select__control">
        <div class="select__value-container"><div class="select__placeholder">Select...</div>
          <div class="select__input-container"><input class="select__input" id="${spec.id}" role="combobox" type="text" aria-required="${spec.required ? "true" : "false"}" value=""></div>
        </div>
        <div class="select__indicators"><button class="icon-button icon-button--sm" type="button" aria-label="Toggle flyout"></button></div>
      </div>
      <input class="requiredInput" tabindex="-1" ${spec.required ? "required" : ""} value="">
    </div></div>
  </div>`;
}

/** Makes the markup behave like react-select. */
function wireCombo(doc: Document, spec: ComboSpec) {
  const input = doc.getElementById(spec.id) as HTMLInputElement;
  const control = input.closest(".select__control") as HTMLElement;
  const values = control.querySelector(".select__value-container") as HTMLElement;
  const close = () => control.parentElement?.querySelector(".select__menu")?.remove();
  const open = (filter: string) => {
    close();
    const shown = spec.options.filter((option) => option.toLowerCase().includes(filter.toLowerCase()));
    if (spec.typeToShow && !filter) return;
    const menu = doc.createElement("div");
    menu.className = "select__menu";
    menu.innerHTML = `<div class="select__menu-list" role="listbox" id="react-select-${spec.id}-listbox">${shown.map((option, index) => `<div class="select__option" role="option" id="react-select-${spec.id}-option-${index}">${option}</div>`).join("")}</div>`;
    control.after(menu);
    for (const node of Array.from(menu.querySelectorAll<HTMLElement>('[role="option"]'))) {
      node.addEventListener("click", () => {
        values.querySelector(".select__placeholder")?.remove();
        if (spec.multi) {
          values.insertAdjacentHTML("afterbegin", `<div class="select__multi-value"><div class="select__multi-value__label">${node.textContent}</div></div>`);
        } else {
          values.querySelector(".select__single-value")?.remove();
          values.insertAdjacentHTML("afterbegin", `<div class="select__single-value">${node.textContent}</div>`);
        }
        input.value = "";
        // react-select's stand-in for the browser's required check gets a value once something's chosen.
        const proxy = control.parentElement?.querySelector<HTMLInputElement>(".requiredInput");
        if (proxy) proxy.value = "chosen";
        close();
      });
    }
  };
  control.querySelector("button")!.addEventListener("mousedown", () => (control.parentElement?.querySelector(".select__menu") ? close() : open("")));
  input.addEventListener("input", () => open(input.value));
  input.addEventListener("keydown", (event) => event.key === "Escape" && close());
}

export const COUNTRIES = ["Afghanistan", "Australia", "India", "Indonesia", "United Kingdom", "United States"];

export const COMBOS: ComboSpec[] = [
  { id: "country", label: "Country", required: true, options: COUNTRIES, typeToShow: true },
  { id: "question_1", label: "Are you legally authorized to work in India?", required: true, options: ["Yes", "No"] },
  { id: "question_2[]", label: "How did you hear about us?", required: true, options: ["LinkedIn", "Friend", "Other"], multi: true },
  { id: "4014225007", label: "Sex", required: true, options: ["Male", "Female", "Decline To Self Identify"] },
];

/** The whole form; `extra` adds markup inside it. */
export function greenhousePage(doc: Document, { combos = COMBOS, extra = "" }: { combos?: ComboSpec[]; extra?: string } = {}): HTMLFormElement {
  doc.body.innerHTML = `<main><form id="application-form" class="application--form">
    <div class="text-input-wrapper"><label for="first_name" id="first_name-label">First Name${star(true)}</label><input id="first_name" class="input input__single-line" type="text" aria-required="true"></div>
    <div class="text-input-wrapper"><label for="last_name" id="last_name-label">Last Name${star(true)}</label><input id="last_name" type="text" aria-required="true"></div>
    <div class="text-input-wrapper"><label for="email" id="email-label">Email${star(true)}</label><input id="email" type="text" aria-required="true"></div>
    <div class="text-input-wrapper"><label for="phone" id="phone-label">Phone</label><input id="phone" type="tel"></div>
    <div class="file-upload" role="group"><div class="label upload-label" id="upload-label-resume">Resume/CV${star(true)}</div>
      <div class="file-upload__wrapper"><button type="button" class="btn btn--pill">Attach</button><label for="resume" class="visually-hidden">Attach</label><input id="resume" type="file" class="visually-hidden"></div></div>
    <div class="file-upload" role="group"><div class="label upload-label" id="upload-label-cover_letter">Cover Letter</div>
      <div class="file-upload__wrapper"><label for="cover_letter" class="visually-hidden">Attach</label><input id="cover_letter" type="file" class="visually-hidden"></div></div>
    ${combos.map(comboHtml).join("\n")}
    <div class="text-input-wrapper"><label for="question_3" id="question_3-label">Why this company?</label><textarea id="question_3" class="input input__multi-line"></textarea></div>
    <fieldset><legend>I agree to the privacy notice${star(true)}</legend>
      <label><input type="checkbox" name="question_4[]" id="question_4[]_77" value="77" required>I Agree</label></fieldset>
    ${extra}
    <button type="submit" class="btn btn--pill">Submit application</button>
  </form></main>`;
  for (const spec of combos) wireCombo(doc, spec);
  return doc.getElementById("application-form") as HTMLFormElement;
}

/** What Greenhouse shows after a successful submission. */
export function confirmationPage(doc: Document) {
  doc.body.innerHTML = `<main><div class="confirmation"><h1>Thank you for applying.</h1><p>Your application has been received. We will review it shortly.</p></div></main>`;
}
