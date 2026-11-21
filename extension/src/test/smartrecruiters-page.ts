// SmartRecruiters' application for tests, built the way the real one is (jobs.smartrecruiters.com/
// oneclick-ui, a Bosch posting read on 21 November 2026): Angular's oc-* components are ordinary
// elements, and inside them spl-* web components keep every control in a shadow root with its own
// <label for>. Page 1 asks the person's details; footer-next leads to the screening page, where
// each question is a [data-test="question-container"]; footer-submit sends it, and the page moves
// to /success. No real page is ever submitted to test this.

/** A web component: an element with an open shadow root holding `html`. */
function component(doc: Document, tag: string, html: string, attributes: Record<string, string> = {}): HTMLElement {
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.attachShadow({ mode: "open" }).innerHTML = html;
  return element;
}

const splInput = (doc: Document, id: string, label: string, { required = false, type = "text" } = {}) =>
  component(doc, "spl-input", `<div><label for="${id}">${label}${required ? "*" : ""}</label><input id="${id}" type="${type}" aria-required="${required}"${required ? " required" : ""}></div>`);

const footerButton = (doc: Document, test: string, text: string) => {
  const host = doc.createElement("oc-button");
  host.setAttribute("data-test", test);
  host.append(component(doc, "spl-button", `<button type="button">${text}</button>`));
  return host;
};

/** The native button inside a footer button. */
export const footerNative = (doc: Document, test: string) => doc.querySelector(`oc-button[data-test="${test}"] spl-button`)!.shadowRoot!.querySelector("button")!;

/** A control inside a component's shadow root, by its id. */
export function inShadow<T extends Element = HTMLInputElement>(doc: Document, id: string): T {
  const walk = (root: ParentNode): T | null => {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.id === id) return element as T;
      if (element.shadowRoot) {
        const found = walk(element.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(doc)!;
}

/** Page 1: the person's details, the resume, and Next. Next goes on only when the required fields are filled. */
export function smartRecruitersPage(doc: Document, { onNext }: { onNext?: () => void } = {}): HTMLElement {
  doc.body.innerHTML = "<oc-app-root><oc-oneclick-form></oc-oneclick-form></oc-app-root>";
  const form = doc.querySelector<HTMLElement>("oc-oneclick-form")!;

  const prefill = doc.createElement("oc-apply-with-resume");
  prefill.append(component(doc, "spl-dropzone", '<label for="spl-dropzone-file-input-2">Choose a file or drop it here</label><input type="file" id="spl-dropzone-file-input-2">'));

  const personal = doc.createElement("oc-personal-information");
  for (const [id, label, type] of [
    ["first-name-input", "First name", "text"],
    ["last-name-input", "Last name", "text"],
    ["email-input", "Email", "email"],
    ["confirm-email-input", "Confirm your email", "email"],
  ] as const) {
    const wrapper = doc.createElement("oc-input");
    wrapper.append(splInput(doc, id, label, { required: true, type }));
    personal.append(wrapper);
  }
  // The city: an autocomplete, optional on this posting.
  const city = component(doc, "spl-autocomplete", "<div></div>");
  city.shadowRoot!.append(splInput(doc, "spl-form-element_10", "City"));
  personal.append(city);
  // The phone: a country search beside the number, which is the question.
  const phone = component(doc, "spl-phone-field", "<div></div>", { label: "Phone number" });
  phone.shadowRoot!.append(component(doc, "spl-dropdown-search", '<input type="text" aria-label="Search by country/region or code">'));
  phone.shadowRoot!.append(component(doc, "spl-input", '<input id="spl-form-element_5" type="tel" aria-label="Phone number" aria-required="true" required>'));
  personal.append(phone);

  const web = doc.createElement("oc-web");
  web.append(splInput(doc, "linkedin-input", "LinkedIn"));

  const resume = doc.createElement("oc-resume-upload");
  resume.append(component(doc, "spl-dropzone", '<label for="spl-dropzone-file-input-1">Choose a file or drop it here</label><input type="file" id="spl-dropzone-file-input-1">'));

  const message = doc.createElement("oc-hiring-manager-message");
  message.append(component(doc, "spl-textarea", '<label for="hiring-manager-message-input">Let the company know about your interest working there</label><textarea id="hiring-manager-message-input"></textarea>'));

  form.append(prefill, personal, web, resume, message, footerButton(doc, "footer-next", "Next"));

  footerNative(doc, "footer-next").addEventListener("click", () => {
    const required = ["first-name-input", "last-name-input", "email-input", "confirm-email-input", "spl-form-element_5"];
    const empty = required.filter((id) => !inShadow(doc, id).value.trim());
    if (empty.length > 0) {
      if (!doc.querySelector("oc-validation-summary")) form.append(component(doc, "oc-validation-summary", "<p>Please fill in the required fields.</p>"));
      return;
    }
    (onNext ?? (() => screeningPage(doc)))();
  });
  return form;
}

/** The screening page: the company's questions, each in a container, and Submit. */
export function screeningPage(doc: Document, { onSubmit }: { onSubmit?: () => void } = {}): HTMLElement {
  const form = doc.querySelector<HTMLElement>("oc-oneclick-form")!;
  form.innerHTML = "";
  const relocate = doc.createElement("div");
  relocate.setAttribute("data-test", "question-container");
  relocate.append(
    component(
      doc,
      "spl-radio-group",
      `<legend>Are you willing to relocate to Bengaluru?*</legend>
       <input type="radio" name="relocate" id="relocate-yes" value="yes" required><label for="relocate-yes">Yes</label>
       <input type="radio" name="relocate" id="relocate-no" value="no"><label for="relocate-no">No</label>`,
    ),
  );
  const salary = doc.createElement("div");
  salary.setAttribute("data-test", "question-container");
  salary.append(splInput(doc, "question-salary", "What is your expected salary?", { required: true }));
  form.append(relocate, salary, footerButton(doc, "footer-submit", "Submit"));
  if (onSubmit) footerNative(doc, "footer-submit").addEventListener("click", onSubmit);
  return form;
}

/** The page once sent: /success, its words in a shadow root. */
export function smartRecruitersThanks(doc: Document): void {
  doc.body.innerHTML = "<oc-app-root></oc-app-root>";
  doc.querySelector("oc-app-root")!.append(component(doc, "oc-success", "<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>"));
}
