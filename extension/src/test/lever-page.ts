// Lever's application form for tests, with the markup read from a real posting on jobs.lever.co
// (Meesho, 10 November 2026): plain named controls in li.application-question, ✱ for required,
// custom questions as cards[…][fieldN], the resume (which Lever reads and fills fields from
// itself), hCaptcha's invisible check, and Submit as #btn-submit.

const required = '<span class="required">✱</span>';
const basic = (label: string, name: string, type = "text", isRequired = true) =>
  `<li class="application-question"><label><div class="application-label">${label}${isRequired ? required : ""}</div><div class="application-field"><input type="${type}" name="${name}" ${isRequired ? "required" : ""}></div></label></li>`;
const radios = (label: string, name: string, options: string[]) =>
  `<li class="application-question custom-question"><div><div class="application-label full-width text"><div class="text">${label}${required}</div></div><div class="application-field full-width required-field"><ul>${options
    .map((option) => `<li><label><input type="radio" name="${name}" value="${option}" required><span class="application-answer-alternative">${option}</span></label></li>`)
    .join("")}</ul></div></div></li>`;

export function leverPage(doc: Document, { parsedName = "NAME FROM RESUME" }: { parsedName?: string } = {}): HTMLFormElement {
  doc.body.innerHTML = `<main><form id="application-form" method="POST" enctype="multipart/form-data">
    <ul>
      <li class="application-question resume"><label><div class="application-label">Resume/CV ${required}</div><div class="application-field"><a class="postings-btn">Attach resume/CV</a><input class="application-file-input invisible-resume-upload" id="resume-upload-input" name="resume" type="file" tabindex="-1"></div></label></li>
      ${basic("Full name", "name")}
      ${basic("Email", "email", "email")}
      ${basic("Phone ", "phone")}
      ${basic("Current location", "location", "text", false)}
      ${basic("Current company ", "org")}
      ${basic("LinkedIn URL", "urls[LinkedIn]", "text", false)}
    </ul>
    <input type="hidden" name="cards[c1][baseTemplate]" value="{}">
    <ul>
      ${radios("Gender", "cards[c1][field0]", ["Male", "Female", "Other", "Prefer not to disclose"])}
      <li class="application-question custom-question"><div><div class="application-label full-width text"><div class="text">Total Years of experience${required}</div></div><div class="application-field full-width required-field"><input required class="card-field-input" type="text" name="cards[c1][field1]"></div></div></li>
      ${radios("Are you willing to relocate to Bangalore?", "cards[c1][field2]", ["Yes", "No"])}
      <li class="application-question custom-question"><div><div class="application-label full-width text"><div class="text">How did you get to know about this role?${required}</div></div><div class="application-field full-width required-field"><select required name="cards[c1][field8]"><option value="">Select...</option><option value="Linkedin">Linkedin</option><option value="Meesho Job Site">Meesho Job Site</option><option value="Naukri">Naukri</option></select></div></div></li>
    </ul>
    <input type="hidden" name="origin" value="">
    <div class="h-captcha"><iframe src="https://newassets.hcaptcha.com/captcha/v1/abc" style="visibility: hidden"></iframe></div>
    <button id="hcaptchaSubmitBtn" type="submit" style="display: none"></button>
    <button id="btn-submit" type="button" class="postings-btn template-btn-submit">Submit application</button>
  </form></main>`;
  const form = doc.getElementById("application-form") as HTMLFormElement;
  // Lever reads the resume and fills in what it finds, a moment later.
  form.querySelector('input[name="resume"]')!.addEventListener("change", () => {
    setTimeout(() => ((form.querySelector('input[name="name"]') as HTMLInputElement).value = parsedName), 50);
  });
  return form;
}

/** Lever's page after Submit (jobs.lever.co/…/thanks). */
export function leverThanks(doc: Document) {
  doc.body.innerHTML = `<div class="content"><h3>Application submitted!</h3><p>Thanks for applying. We'll be in touch.</p></div>`;
}
