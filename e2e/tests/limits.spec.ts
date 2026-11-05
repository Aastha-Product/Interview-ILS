import { expect, test, type Page } from "@playwright/test";

async function devSignIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Dev sign-in" }).click();
}

test("a student who sends too many API requests gets a friendly 429 with Retry-After", async ({ page }) => {
  await devSignIn(page, `e2e-limits-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);

  // 125 requests: even if they straddle two one-minute windows (2 × 60 allowed), some are refused.
  const statuses: number[] = [];
  let refused: { retryAfter: string | null; body: { error: { code: string; message: string } } } | null = null;
  for (let i = 0; i < 125; i++) {
    const response = await page.request.get("/api/dashboard");
    statuses.push(response.status());
    if (response.status() === 429 && !refused) {
      refused = { retryAfter: response.headers()["retry-after"] ?? null, body: await response.json() };
    }
  }
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(60);
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
  expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
  expect(Number(refused!.retryAfter)).toBeGreaterThanOrEqual(1);
  expect(Number(refused!.retryAfter)).toBeLessThanOrEqual(60);
  expect(refused!.body.error.code).toBe("RATE_LIMITED");
  expect(refused!.body.error.message).toMatch(/wait a few seconds/);
});
