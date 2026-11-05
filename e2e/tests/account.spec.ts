import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../../fixtures", name);

async function devSignIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Dev sign-in" }).click();
}

test("a student downloads their data, then deletes the account and can't get back in", async ({ page }) => {
  const email = `e2e-account-${Date.now()}@example.test`;
  await devSignIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);

  // Something worth exporting and deleting: an imported resume (a stored file) and a profile.
  await page.locator("#resume-file").setInputFiles(fixture("resume-asha.pdf"));
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/preferences$/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // Export: a JSON download with this student's profile in it.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pathfinder-export-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.account.email).toBe(email);
  expect(exported.profile.headline).toBe("Final-year B.Tech Computer Science student");
  expect(exported.resumeUploads).toHaveLength(1);
  expect(exported.auditLog.map((a: { action: string }) => a.action)).toContain("EXPORT");

  // Delete: the button stays disabled until the email is typed exactly.
  const remove = page.getByRole("button", { name: "Delete my account permanently" });
  await expect(remove).toBeDisabled();
  await page.getByLabel(`Type ${email} to confirm`).fill("someone-else@example.test");
  await expect(remove).toBeDisabled();
  await page.getByLabel(`Type ${email} to confirm`).fill(email.toUpperCase());
  await remove.click();

  await expect(page).toHaveURL(/\/signin\?deleted=1$/);
  await expect(page.getByText("Your account and all its data have been deleted.")).toBeVisible();

  // Signed out everywhere: the app sends them to sign-in and the API refuses them.
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/signin$/);
  expect((await page.request.get("/api/profile")).status()).toBe(401);
});

test("the delete API refuses a wrong confirmation and keeps the account", async ({ page }) => {
  await devSignIn(page, `e2e-keep-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);
  const response = await page.request.delete("/api/account", { data: { confirmEmail: "not-me@example.test" } });
  expect(response.status()).toBe(400);
  expect((await response.json()).error.code).toBe("CONFIRMATION_MISMATCH");
  expect((await page.request.get("/api/profile")).status()).toBe(200);
});
