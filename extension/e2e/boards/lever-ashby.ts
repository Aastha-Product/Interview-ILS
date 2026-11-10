// Mock Lever and Ashby forms for the Chrome tests: the same markup and behaviour as the unit tests'
// copies (extension/src/test), read from real postings. What's submitted is posted to /__submitted.

import { ashbyPage, ashbyThanks } from "../../src/test/ashby-page";
import { leverPage, leverThanks } from "../../src/test/lever-page";

const post = (entries: [string, string][]) => fetch("/__submitted", { method: "POST", body: JSON.stringify(entries) });

function valuesOf(root: ParentNode): [string, string][] {
  const entries: [string, string][] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"))) {
    const name = element.name || element.id || element.closest<HTMLElement>("[data-field-path]")?.dataset.fieldPath || "";
    if (element instanceof HTMLInputElement && element.type === "file") {
      const file = element.files?.[0];
      if (file) entries.push([name, `file:${file.name}:${file.size}`]);
    } else if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      if (element.checked) entries.push([name, element.closest("label")?.textContent?.trim() || element.nextElementSibling?.textContent?.trim() || element.value]);
    } else if (element.value) entries.push([name, element.value]);
  }
  for (const button of Array.from(root.querySelectorAll<HTMLElement>('button[aria-pressed="true"]'))) entries.push([button.closest<HTMLElement>("[data-field-path]")?.dataset.fieldPath ?? "", button.textContent ?? ""]);
  return entries;
}

if (location.hostname === "jobs.lever.co") {
  if (location.pathname.endsWith("/thanks")) leverThanks(document);
  else {
    const form = leverPage(document);
    document.getElementById("btn-submit")!.addEventListener("click", async () => {
      await post(valuesOf(form));
      location.assign(location.pathname.replace(/\/apply$/, "/thanks"));
    });
  }
} else if (location.hostname === "jobs.ashbyhq.com") {
  const form = ashbyPage(document);
  document.querySelector(".ashby-application-form-submit-button")!.addEventListener("click", async () => {
    await post(valuesOf(form));
    ashbyThanks(document);
  });
}
