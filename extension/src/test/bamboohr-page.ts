// BambooHR's application for tests, as read from a live posting (knack.bamboohr.com, 22 November
// 2026): the job page's "Apply for This Job" opens <form id="job-application-form"> with named
// controls and <label>s ending in "*" when required, <select>s for state and country, a file input
// for the resume, a bot trap (nickname_…) that people never see, and reCAPTCHA's response box.
// The form is novalidate: BambooHR checks it itself and shows errors beside the fields.

const field = (id: string, label: string, name = id) => `<div><label for="${id}">${label}</label><input type="text" id="${id}" name="${name}"></div>`;

/** The job page, before Apply: the button only. Pressing it shows the form. */
export function bambooJobPage(doc: Document, { onSubmit }: { onSubmit?: (form: HTMLFormElement) => void } = {}): void {
  doc.body.innerHTML = `<main><h1>Data Analyst</h1><button type="button" id="open">Apply for This Job</button></main>`;
  doc.getElementById("open")!.addEventListener("click", () => {
    doc.querySelector("main")!.insertAdjacentHTML(
      "beforeend",
      `<form id="job-application-form" novalidate>
        <div style="position:absolute;left:-9999px"><label for="nickname_hpcsaf">Please leave this field blank</label><input type="text" id="nickname_hpcsaf" name="nickname_hpcsaf"></div>
        ${field("firstName", "First Name *")}
        ${field("lastName", "Last Name *")}
        ${field("email", "Email *")}
        ${field("phone", "Phone *")}
        ${field("FabricTextField-62", "Address *", "streetAddress.value")}
        ${field("FabricTextField-63", "City *", "city.value")}
        <div><label for="fab-select66">Country *</label><select id="fab-select66" name="countryId.value" required><option value="">–Select–</option><option value="99">India</option><option value="1">United States</option></select></div>
        <div><span>Resume *</span><input type="file" required><input type="hidden" name="resumeFileId"></div>
        ${field("linkedinUrl", "LinkedIn URL")}
        <div><label for="customQuestionAnswers.long_73">Why do you want to work at Knack? *</label><textarea id="customQuestionAnswers.long_73" name="customQuestionAnswers.long_73"></textarea></div>
        <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
        <button type="submit">Submit Application</button>
      </form>`,
    );
    const form = doc.getElementById("job-application-form") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onSubmit?.(form);
    });
  });
}

/** What BambooHR shows once sent. */
export function bambooThanks(doc: Document): void {
  doc.body.innerHTML = "<main><h2>Application submitted!</h2><p>Thank you for applying. We'll be in touch.</p></main>";
}
