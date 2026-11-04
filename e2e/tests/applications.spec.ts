import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../../fixtures", name);
const jobText = readFileSync(fixture("job-qa-pune.txt"), "utf8");

async function studentWithProfile(page: Page, tag: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(`e2e-${tag}-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Dev sign-in" }).click();
  await page.locator("#resume-file").setInputFiles(fixture("resume-asha.pdf"));
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByLabel("Roles you want").fill("Software Tester");
  await page.getByLabel("Cities").fill("Pune");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/jobs\?welcome=1$/);
}

async function pasteJob(page: Page, title = "QA Engineer - Fresher", company = "Example Softech Pvt Ltd") {
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Paste the job description instead" }).click();
  await page.getByLabel("Job title").fill(title);
  await page.getByLabel("Company").fill(company);
  await page.getByLabel("City (optional)").fill("Pune");
  await page.getByLabel("Job description").fill(jobText);
  await page.getByRole("button", { name: "Add job" }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-z0-9]+$/);
}

test("a pasted posting becomes a reviewed, downloadable PDF in under 2 minutes, then is tracked", async ({ page }) => {
  test.setTimeout(180_000);
  await studentWithProfile(page, "apply");
  const started = Date.now();
  await pasteJob(page);

  await page.getByRole("button", { name: "Start application" }).click();
  await expect(page).toHaveURL(/\/applications\/[a-z0-9]+$/);

  // The worker drafts from the profile; the page updates by itself.
  await expect(page.getByRole("heading", { name: "Your tailored resume" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("list", { name: "Resume skills" })).toContainText("Selenium");
  await expect(page.getByRole("list", { name: "Gaps" })).toBeVisible();
  // The notice-period question can't be answered from the profile, so it asks the student.
  const joinAnswer = page.getByLabel("When can you join? (notice period or availability)");
  await expect(joinAnswer).toHaveValue("");

  // Review and edit, then save: a new version and a fresh PDF.
  await joinAnswer.fill("I can join from July 2026, after my final exams.");
  const firstPoint = page.getByRole("textbox", { name: /point 1$/ }).first();
  await firstPoint.fill(`${await firstPoint.inputValue()} (reviewed)`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved. Your PDF is being updated.")).toBeVisible();
  await expect(page.getByText(/Version 2, edited by you/)).toBeVisible();

  const download = page.getByRole("button", { name: "Download PDF" });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/_Resume\.pdf$/);
  const bytes = readFileSync((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(Date.now() - started).toBeLessThan(120_000);

  // The student applies on the job site themselves, then marks it here.
  await page.getByRole("button", { name: "I've applied" }).click();
  await expect(page.getByText(/Marked as applied/)).toBeVisible();

  // Tracker shows it under Applied; the dashboard counts it as sent.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Applications" }).click();
  await expect(page.getByRole("region", { name: /^Applied \(1\)$/ })).toContainText("QA Engineer - Fresher");
  await page.getByLabel("Status of QA Engineer - Fresher at Example Softech Pvt Ltd").selectOption("INTERVIEW");
  await expect(page.getByRole("region", { name: /^Interview \(1\)$/ })).toContainText("QA Engineer - Fresher");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("response-rate")).toHaveText("100%");
  await expect(page.getByText("1 response from 1 application sent.", { exact: false })).toBeVisible();
});

test("a second application for the same job is blocked and links to the first", async ({ page }) => {
  await studentWithProfile(page, "dup");
  await pasteJob(page);
  const jobUrl = page.url();
  await page.getByRole("button", { name: "Start application" }).click();
  await expect(page).toHaveURL(/\/applications\/[a-z0-9]+$/);
  const applicationUrl = page.url();

  await page.goto(jobUrl);
  await page.getByRole("button", { name: "Start application" }).click();
  await expect(page.getByText("You've already started an application for this job.")).toBeVisible();
  await page.getByRole("link", { name: "Open that application" }).click();
  await expect(page).toHaveURL(applicationUrl);
});
