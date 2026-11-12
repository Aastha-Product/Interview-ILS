import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// Auto-apply as a student meets it the first time (Pathfinder): nothing is on and there's no
// switch until Set up job search is complete; every starred answer is required; then it's on
// as a dry run, and says no browser is connected. Nothing is ever submitted here: there's no
// extension in this browser, and no job boards are read.

test.beforeAll(resetData);
// Other specs run with auto-apply as it was: never set up.
test.afterAll(() => sql(`DELETE FROM "AutoApplySettings"`));

/** No serious axe findings, in the light scheme and then the dark one. */
async function expectAccessible(page: Page) {
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((chosen) => (document.documentElement.dataset.theme = chosen), scheme);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious.map((violation) => `${scheme}: ${violation.id}: ${violation.nodes.map((node) => `${node.target.join(" ")} ${node.failureSummary ?? ""}`).join("; ")}`)).toEqual([]);
  }
  await page.evaluate(() => delete document.documentElement.dataset.theme);
}

const settings = () => sql<{ enabled: boolean; dryRun: boolean; consentAt: Date | null; answers: Record<string, unknown>; preferences: { cities: string[] } }>(`SELECT enabled, "dryRun", "consentAt", answers, preferences FROM "AutoApplySettings"`);

test("sets up auto-apply from nothing: the starred answers, consent, then on as a dry run", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/auto-apply");
  await expect(page.getByRole("heading", { level: 1, name: "Auto-apply" })).toBeVisible();
  // Before set-up there's no switch, only where to start.
  await expect(page.getByRole("switch", { name: "Apply for me" })).toHaveCount(0);
  await expect(page.getByText(/^To start, set up your job search and agree to how auto-apply works in/)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Set up job search" }).first().click();
  await expect(page).toHaveURL("/auto-apply/setup");
  // What they're looking for starts from the profile.
  await expect(page.getByRole("textbox", { name: "Roles" })).not.toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Cities" })).toHaveAttribute("required", "");

  // Saving with the starred answers empty is refused, says which, and keeps nothing.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Fill in the \d+ starred answers still empty to save: /)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Expected salary" })).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL("/auto-apply/setup");
  expect(await settings()).toHaveLength(0);
  await expectAccessible(page);

  // The starred answers, one kind at a time.
  await page.getByRole("textbox", { name: "Cities" }).fill("Pune, Bengaluru");
  const required = page.locator("select[required]");
  for (let index = 0; index < (await required.count()); index++) {
    const select = required.nth(index);
    if ((await select.inputValue()) !== "") continue;
    const values = await select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    await select.selectOption(values.includes("no") ? "no" : "immediate");
  }
  await page.getByRole("combobox", { name: /legally allowed to work/ }).selectOption("yes");
  await page.getByRole("checkbox", { name: /I don't have a salary now/ }).check();
  await expect(page.getByRole("textbox", { name: "Current salary" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Expected salary" }).fill("6 LPA");
  await page.getByRole("textbox", { name: "Graduation year" }).fill("2020");
  // Asked of people with experience, as the demo profile has.
  await page.getByRole("textbox", { name: /^Why are you looking for a change\?/ }).fill("A larger scope.");
  await expect(page.getByText(/All required answers are given\./)).toBeVisible();

  await page.getByRole("checkbox", { name: "I agree" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL("/auto-apply");

  // Set up and agreed to, but off until switched on; a dry run by default.
  const toggle = page.getByRole("switch", { name: "Apply for me" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await settings()).toMatchObject([{ enabled: false, dryRun: true, answers: { workAuthorized: true, noCurrentSalary: true, expectedSalary: "6 LPA", noticePeriod: "immediate" }, preferences: { cities: ["Pune", "Bengaluru"] } }]);
  expect((await settings())[0].consentAt).not.toBeNull();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAccessibleDescription(/^On, as a dry run: forms are filled but not submitted\./);
  // Nothing can be submitted without the extension, and the page says so.
  await expect(page.getByRole("alert").filter({ hasText: "No browser is connected, so nothing can be submitted." })).toBeVisible();
  await expect.poll(async () => (await settings())[0].enabled).toBe(true);
  await expectAccessible(page);

  // This browser has no extension: the page to connect one says to install it first.
  await page.getByRole("link", { name: "Connect the extension" }).click();
  await expect(page).toHaveURL("/auto-apply/extension");
  await expect(page.getByText(/^Install the Pathfinder extension in Chrome first/)).toBeVisible();
  await expect(page.getByText("None yet.")).toBeVisible();

  // Off again at any time.
  await page.goto("/auto-apply");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await settings())[0].enabled).toBe(false);
});

test("pauses auto-apply when a required answer goes missing, and says which", async ({ page }) => {
  // On, then an answer is taken away (as for a student who set it up before the answers were required).
  await sql(`UPDATE "AutoApplySettings" SET enabled = true, answers = answers - 'expectedSalary'`);
  await page.goto("/auto-apply");
  await expect(page.getByRole("switch", { name: "Apply for me" })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Auto-apply is waiting for one required answer (Expected salary)." })).toBeVisible();
});
