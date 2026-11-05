import { request as httpRequest } from "node:http";
import { expect, test, type Page } from "@playwright/test";

async function devSignIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Dev sign-in" }).click();
}

test("pages carry a nonce-based CSP and run without any CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) violations.push(msg.text());
  });

  const response = await page.goto("/signin");
  const csp = response!.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  // Next.js puts this request's nonce on its own scripts.
  // (Read the property: browsers blank the nonce attribute once the page has loaded.)
  const scriptNonces = await page.locator("script[nonce]").evaluateAll((els) => els.map((e) => (e as unknown as { nonce: string }).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((n) => n === nonce)).toBe(true);
  // A fresh nonce per request.
  const again = (await page.goto("/signin"))!.headers()["content-security-policy"] ?? "";
  expect(again).not.toContain(`'nonce-${nonce}'`);

  // The app still works under the policy: sign in, use the blank-profile path, visit the main pages.
  await devSignIn(page, `e2e-csp-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);
  for (const path of ["/dashboard", "/jobs", "/applications", "/settings", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test("dev sign-in refuses a request with no Origin header", async ({ request }) => {
  // Playwright's API client sends no Origin; a browser form post always does.
  const response = await request.post("/api/dev/sign-in", { form: { email: "no-origin@example.test" }, maxRedirects: 0 });
  expect(response.status()).toBe(403);
});

test("a resume upload without Content-Length is refused before it is read", async ({ page, context }) => {
  await devSignIn(page, `e2e-chunked-${Date.now()}@example.test`);
  await expect(page).toHaveURL(/\/onboarding$/);
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "localhost",
        port: 3000,
        path: "/api/resume/import",
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "multipart/form-data; boundary=x", "Transfer-Encoding": "chunked" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.write("--x\r\n");
    req.end();
  });
  expect(status).toBe(411);
});

test("the health check answers without sign-in and gives nothing away", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
