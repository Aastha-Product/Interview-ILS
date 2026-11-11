import { expect, test as setup } from "@playwright/test";

import { PASSWORD, resetData, STORAGE_STATE, E2E_EMAIL } from "./support";

// Before the specs: the demo data, and a signed-in session they all share.
setup("sign in", async ({ page }) => {
  await resetData();
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Access code", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Students land on the resume analysis (HOME_PATH, src/lib/auth/next-path.ts).
  await expect(page).toHaveURL("/analyze");
  await page.context().storageState({ path: STORAGE_STATE });
});
