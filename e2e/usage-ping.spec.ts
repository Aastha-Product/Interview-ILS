import { expect, test, type Page } from "@playwright/test";

import { answerUsagePing, fakePings, resetData, sql } from "./support";

// The usage ping in Pathfinder: off unless the server sets DOSSIER_TELEMETRY=on (src/lib/env.ts),
// so a student is never asked and nothing is sent, whatever was stored before. (Upstream Dossier
// asks once after sign-in; Pathfinder's servers have many students, and the v1 plan keeps the
// ping off.) A ping would reach the fake receiver (DOSSIER_USAGE_PING_TEST_URL), never the project's.
test.beforeAll(resetData);
test.afterAll(() => answerUsagePing("off"));

const OLD_ID = "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c";
const question = (page: Page) => page.getByRole("dialog", { name: "Send a daily usage ping?" });
const OFF_BY_SERVER = "Set with DOSSIER_TELEMETRY=off on the server, which decides while it's set. Change it there.";

/** An install that pinged before 1.8 and hasn't answered: it has an ID and no answer. */
async function upgradedInstall() {
  await answerUsagePing(null);
  await sql(`DELETE FROM "Setting" WHERE key IN ('usagePingId', 'usagePingDay')`);
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('usagePingId', $1, now())`, [OLD_ID]);
}

test("never asks a student, and sends nothing, even with an ID from before", async ({ page }) => {
  await upgradedInstall();
  const before = (await fakePings()).length;
  for (const path of ["/", "/applications", "/settings?section=about"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(question(page)).toHaveCount(0);
  }
  expect((await fakePings()).length).toBe(before);
});

test("sends nothing even after a yes stored before, and Settings → About says the server decides", async ({ page }) => {
  await answerUsagePing("on");
  const before = (await fakePings()).length;
  await page.goto("/");
  await page.goto("/applications");
  await page.goto("/settings?section=about");
  const toggle = page.getByRole("switch", { name: "Send the daily usage ping" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAccessibleDescription(OFF_BY_SERVER);
  // Give a page load's ping time to go out, if one were sent.
  await page.waitForTimeout(1000);
  expect((await fakePings()).length).toBe(before);
});
