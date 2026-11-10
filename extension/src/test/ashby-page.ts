// Ashby's application form for tests, with the markup read from a real posting on jobs.ashbyhq.com
// (Tekion, 10 November 2026): no <form>; each question is .ashby-application-form-field-entry with
// data-field-path, its wording in .ashby-application-form-question-title (_required_… when
// required); Yes/No buttons with aria-pressed; checkbox options sharing one id; an autocomplete
// for location; education history as several inputs; Submit as .ashby-application-form-submit-button.

const entry = (path: string, label: string, required: boolean, body: string) =>
  `<div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry" data-field-path="${path}"><label class="_heading_f7cvd_52 ${required ? "_required_f7cvd_91" : ""} ashby-application-form-question-title" for="${path}">${label}</label>${body}</div>`;

export const PLACES = ["Pune, Maharashtra, India", "Punjab, India", "Mumbai, Maharashtra, India"];

export function ashbyPage(doc: Document): HTMLElement {
  doc.body.innerHTML = `<main><div class="_jobPostingForm_5yu8i_402 ashby-application-form-container">
    ${entry("_systemfield_name", "Name", true, '<div><input name="_systemfield_name" required id="_systemfield_name" type="text" value=""></div>')}
    ${entry("_systemfield_email", "Email", true, '<div><input name="_systemfield_email" required id="_systemfield_email" type="email" value=""></div>')}
    ${entry("_systemfield_resume", "Resume", true, '<div><input type="file" id="_systemfield_resume"><button>Upload File</button></div>')}
    ${entry("phone-1", "Phone Number", true, '<input type="tel" name="phone-1" id="phone-1" required><div><input type="radio" name="communicationConsent"><label>Yes, text me</label><input type="radio" name="communicationConsent"><label>No</label></div>')}
    ${entry("gender-1", "Gender", false, ["Male", "Female", "Decline to self-identify"].map((option) => `<div><input type="radio" name="gender-1_x" id="gender-1_x"><label>${option}</label></div>`).join(""))}
    ${entry("_systemfield_location", "Location", true, '<div class="_inputContainer_d7ago_28"><input class="ashby-application-form-input-autocomplete" placeholder="Start typing..." aria-autocomplete="list" role="combobox" value=""><button class="_toggleButton_d7ago_32"></button></div>')}
    ${entry("worked-1", "Have you previously worked at Acme?", true, '<div class="ashby-application-form-input-yesno"><button class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="yes">Yes</button><button class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="no">No</button><input type="checkbox" tabindex="-1" name="worked-1"></div>')}
    ${entry("comp-1", "What type of compensation do you currently receive?", false, ["Base", "Variable", "RSU"].map((option) => `<div><input type="checkbox" name="${option}" id="comp-1_x"><label>${option}</label></div>`).join(""))}
    ${entry("_systemfield_education_history", "Education History", false, '<input role="combobox" value=""><input type="text" id="_systemfield_education_history-degree"><input type="text" id="_systemfield_education_history-major"><select><option value="">Year...</option><option>2026</option></select>')}
    ${entry("notice-1", "What is your notice period?", true, '<textarea name="notice-1" id="notice-1" required></textarea>')}
    <button class="_button_zyh3g_28 ashby-application-form-submit-button"><span>Submit Application</span></button>
  </div></main>`;
  for (const button of Array.from(doc.querySelectorAll<HTMLButtonElement>(".ashby-application-form-input-yesno-option"))) {
    button.addEventListener("click", () => {
      for (const other of Array.from(button.parentElement!.querySelectorAll("button"))) other.setAttribute("aria-pressed", String(other === button));
    });
  }
  // The location autocomplete suggests places a moment after typing; choosing one fills it in.
  const location = doc.querySelector<HTMLInputElement>('[data-field-path="_systemfield_location"] input')!;
  const container = location.closest(".ashby-application-form-field-entry")!;
  location.addEventListener("input", () => {
    container.querySelector('[role="listbox"]')?.remove();
    const typed = location.value.toLowerCase();
    if (!typed) return;
    setTimeout(() => {
      const list = doc.createElement("div");
      list.setAttribute("role", "listbox");
      list.innerHTML = PLACES.filter((place) => place.toLowerCase().includes(typed))
        .map((place) => `<div role="option">${place}</div>`)
        .join("");
      container.append(list);
      for (const option of Array.from(list.children)) {
        option.addEventListener("click", () => {
          location.value = option.textContent ?? "";
          list.remove();
        });
      }
    }, 100);
  });
  return doc.querySelector(".ashby-application-form-container") as HTMLElement;
}

/** What Ashby shows in place of the form once applied. */
export function ashbyThanks(doc: Document) {
  doc.querySelector(".ashby-application-form-container")!.outerHTML = '<div class="ashby-application-form-success-container"><h2>Thank you for applying</h2><p>Your application was successfully submitted.</p></div>';
}
