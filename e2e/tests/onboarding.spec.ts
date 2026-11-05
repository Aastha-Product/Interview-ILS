import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD } from "../playwright.config";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../../fixtures", name);

async function devSignIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  // Demo sites (E2E_DEMO=1) also ask for the shared demo password.
  if (process.env.E2E_DEMO) await page.getByLabel("Demo password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /^(Dev|Demo) sign-in$/ }).click();
}

test("a new student signs in, imports a resume, confirms it, sets preferences and edits the profile", async ({
  page,
}) => {
  await devSignIn(page, `e2e-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Let's set up your profile" })).toBeVisible();

  // Import: the draft is shown for review, nothing is saved yet.
  await page.locator("#resume-file").setInputFiles(fixture("resume-asha.pdf"));
  await expect(
    page.getByRole("heading", { name: "Check what we read from your resume" }),
  ).toBeVisible();
  await expect(page.getByLabel("Headline")).toHaveValue(
    "Final-year B.Tech Computer Science student",
  );
  await expect(page.getByLabel("College or school")).toHaveValue(
    "Shri Example Institute of Technology, Indore",
  );
  await expect(page.getByRole("list", { name: "Your skills" })).toContainText("Selenium");
  await expect(page.getByLabel("Project name").first()).toHaveValue("Library Management System");

  // The student corrects the draft before saving.
  await page.getByLabel("Add a skill").fill("JIRA");
  await page.getByLabel("Add a skill").press("Enter");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Preferences: validation first, then a valid submission.
  await expect(page).toHaveURL(/\/onboarding\/preferences$/);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Add at least one role")).toBeVisible();
  await page.getByLabel("Roles you want").fill("Software Tester, Data Analyst");
  await page.getByLabel("Cities").fill("Indore, Pune");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/jobs\?welcome=1$/);
  await expect(page.getByText("You're all set")).toBeVisible();

  // Edit and save; the change survives a reload.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click();
  await page.getByLabel("Headline").fill("Final-year B.Tech CSE student aiming for QA roles");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Headline")).toHaveValue(
    "Final-year B.Tech CSE student aiming for QA roles",
  );
  await expect(page.getByRole("list", { name: "Your skills" })).toContainText("JIRA");
  await expect(page.getByLabel("City")).toHaveValue("Indore, Madhya Pradesh");

  // Preferences were stored.
  await page.getByRole("link", { name: "Job preferences" }).click();
  await expect(page.getByLabel("Roles you want")).toHaveValue("Software Tester, Data Analyst");
});

test("a file that isn't a resume gets a friendly message", async ({ page }) => {
  await devSignIn(page, `e2e-badfile-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.locator("#resume-file").setInputFiles(fixture("not-a-resume.png"));
  // Next.js also renders an (empty) role="alert" route announcer, so match by text too.
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Upload your resume as a PDF or a Word (.docx) file." }),
  ).toBeVisible();
});

test("a student can start with a blank profile, and required fields are checked", async ({
  page,
}) => {
  await devSignIn(page, `e2e-blank-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Start with a blank profile" }).click();
  await expect(page.getByRole("heading", { name: "Build your profile" })).toBeVisible();
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Project name is required")).toBeVisible();
  await page.getByLabel("Project name").fill("Weather app");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/preferences$/);
});

test("signed-out visitors are sent to sign-in and the API refuses them", async ({
  page,
  request,
}) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/signin$/);
  const response = await request.get("/api/profile");
  expect(response.status()).toBe(401);
});
