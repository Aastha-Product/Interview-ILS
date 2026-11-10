import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import * as esbuild from "esbuild";

import { REASONS } from "../src/protocol";
import { FakePathfinder, ORIGIN, TOKEN, type Task } from "./fake-pathfinder";

// Auto-apply step 6: the real extension in Chromium, against mock Greenhouse (with the real
// react-select), Lever and Ashby boards, and a fake Pathfinder.
//
// The boards' own hostnames resolve to a local HTTPS server, and every other hostname to nothing:
// these tests can't reach a real job board, or anything else on the internet. (Playwright's
// page.route() isn't enough: it doesn't catch the first load of a tab the extension opens.)

const root = join(__dirname, "..");
const BOARDS_PORT = 4320;
const HOSTS = { "job-boards.greenhouse.io": "greenhouse", "jobs.lever.co": "lever", "jobs.ashbyhq.com": "ashby", "careers.example.com": "company" } as const;
const pathfinder = new FakePathfinder();
const submitted: Record<string, [string, string][][]> = { greenhouse: [], lever: [], ashby: [] };
let context: BrowserContext;
let connectPage: Page;
let boards: Server;
let scratch: string;
let mocks: Record<string, string>;

const shell = (script: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Job application</title></head><body><main id="root"></main><script src="/__mock/${script}"></script></body></html>`;

/** The mock boards, each at its own hostname; keeps what they submit. */
function serveBoards(request: IncomingMessage, response: ServerResponse) {
  const host = (request.headers.host ?? "").split(":")[0] as keyof typeof HOSTS;
  const name = HOSTS[host];
  const url = new URL(request.url ?? "/", `https://${host}`);
  const send = (status: number, type: string, body: string) => response.writeHead(status, { "content-type": type }).end(body);
  if (name === "company") return send(200, "text/html", "<h1>Apply on our site</h1><form><input name=name></form>");
  if (!name) return send(404, "text/plain", "not a mock board");
  const script = name === "greenhouse" ? "greenhouse.js" : "lever-ashby.js";
  if (url.pathname === "/__submitted") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      submitted[name].push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]"));
      send(200, "text/plain", "ok");
    });
    return;
  }
  if (url.pathname.startsWith("/__mock/")) return send(200, "text/javascript", mocks[script]);
  if (url.pathname === "/favicon.ico") return send(404, "text/plain", "");
  return send(200, "text/html; charset=utf-8", shell(script));
}

/** A throwaway certificate for the mock boards (Chrome is told to accept it). */
function certificate(dir: string) {
  const [key, cert] = [join(dir, "key.pem"), join(dir, "cert.pem")];
  // On PATH (Linux, CI), or the one Git for Windows ships.
  const candidates = ["openssl", String.raw`C:\Program Files\Git\mingw64\bin\openssl.exe`, String.raw`C:\Program Files\Git\usr\bin\openssl.exe`];
  for (const openssl of candidates) {
    if (openssl !== "openssl" && !existsSync(openssl)) continue;
    try {
      execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=pathfinder-mock-boards"], { stdio: "ignore" });
      return { key: readFileSync(key), cert: readFileSync(cert) };
    } catch {
      // Try the next one.
    }
  }
  throw new Error("The extension's Chrome tests need openssl, to make a certificate for the mock job boards.");
}

const task = (id: string, overrides: Partial<Task>): Task => ({
  taskId: id,
  applyUrl: "",
  system: "GREENHOUSE",
  title: "Data Analyst",
  company: "Acme",
  dryRun: false,
  answers: null,
  documents: { resume: true, coverLetter: false },
  ...overrides,
});

/** Asks the worker to look for the next application now, as connecting does, instead of waiting a minute. */
const nextTick = () => connectPage.evaluate((token) => (window as unknown as { connectExtension: (token: string) => void }).connectExtension(token), TOKEN);

const finished = async (id: string) => {
  await expect.poll(() => pathfinder.outcomes(id).filter((outcome) => outcome !== "submitting"), { timeout: 60_000 }).not.toEqual([]);
  // What was reported, in the test's output when something's off.
  console.log(id, JSON.stringify(pathfinder.reports.filter((report) => report.taskId === id)));
};
const tabFor = (host: string) => context.pages().find((page) => page.url().includes(host));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(root, "build.mjs"), "--test"], { stdio: "inherit" });
  const manifest = JSON.parse(readFileSync(join(root, "dist-test", "manifest.json"), "utf8")) as { host_permissions: string[] };
  expect(manifest.host_permissions).toContain(`${ORIGIN}/*`);

  const bundle = async (entry: string) =>
    (await esbuild.build({ entryPoints: [join(__dirname, "boards", entry)], bundle: true, write: false, format: "iife", target: "chrome116", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" })).outputFiles[0].text;
  mocks = { "greenhouse.js": await bundle("greenhouse.tsx"), "lever-ashby.js": await bundle("lever-ashby.ts") };

  scratch = mkdtempSync(join(tmpdir(), "pathfinder-extension-"));
  boards = createServer(certificate(scratch), serveBoards);
  await new Promise<void>((resolve) => boards.listen(BOARDS_PORT, "127.0.0.1", resolve));
  await pathfinder.start();

  const extension = join(root, "dist-test");
  const rules = ["EXCLUDE localhost", "EXCLUDE 127.0.0.1", ...Object.keys(HOSTS).map((host) => `MAP ${host} 127.0.0.1:${BOARDS_PORT}`), "MAP * ~NOTFOUND"].join(", ");
  context = await chromium.launchPersistentContext(join(scratch, "profile"), {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--host-resolver-rules=${rules}`, "--ignore-certificate-errors"],
  });
  if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
  // Chrome's console (the worker's and the tabs'), in the test's output.
  context.on("console", (message) => console.log(`[chrome ${message.type()}] ${message.text()}`));
  context.on("weberror", (error) => console.log(`[chrome error] ${error.error().message}`));
});

test.afterAll(async () => {
  await context?.close();
  await pathfinder.stop();
  await new Promise<void>((resolve) => (boards ? boards.close(() => resolve()) : resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

test("connects from Pathfinder's page, then applies on Greenhouse with the real react-select", async () => {
  pathfinder.add(
    task("gh-1", {
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      // What the server prepares from Greenhouse's API.
      answers: {
        first_name: { kind: "text", value: "Asha" },
        last_name: { kind: "text", value: "Rao" },
        email: { kind: "text", value: "asha.rao@example.test" },
        country: { kind: "text", value: "India" },
        question_1: { kind: "option", value: "1", label: "Yes" },
        "question_2[]": { kind: "options", values: ["9"], labels: ["LinkedIn"] },
        resume: { kind: "file", file: "resume" },
      },
    }),
  );
  connectPage = await context.newPage();
  await connectPage.goto(`${ORIGIN}/auto-apply/extension`);
  await expect(connectPage.locator("#state")).toHaveText("installed");
  await nextTick();
  await expect(connectPage.locator("#state")).toHaveText("connected");

  await finished("gh-1");
  expect(pathfinder.outcomes("gh-1")).toEqual(["submitting", "applied"]);
  expect(pathfinder.reports.at(-1)?.evidence?.text).toContain("Thank you for applying.");
  // The page's questions the server's copy lacked were asked about: the demographic one and the consent.
  expect(pathfinder.asked.find((entry) => entry.taskId === "gh-1")?.fields.map((field) => field.label)).toEqual(["Sex", "I agree to the privacy notice"]);
  expect(submitted.greenhouse).toHaveLength(1);
  expect(submitted.greenhouse[0]).toEqual(
    expect.arrayContaining([
      ["first_name", "Asha"],
      ["country", "India"],
      ["question_1", "Yes"],
      ["question_2[]", "LinkedIn"],
      ["4014225007", "Decline To Self Identify"],
      ["question_4[]", "77"],
      ["resume", expect.stringMatching(/^file:Asha Rao - Resume\.pdf:\d+$/)],
    ]),
  );
  // Applied: its tab is closed.
  await expect.poll(() => tabFor("greenhouse.io")).toBeUndefined();
});

test("in a dry run, fills the form and leaves it open, unsubmitted", async () => {
  pathfinder.add(task("gh-2", { applyUrl: "https://job-boards.greenhouse.io/acme/jobs/2", dryRun: true, answers: { first_name: { kind: "text", value: "Asha" }, question_1: { kind: "option", value: "1", label: "Yes" } } }));
  await nextTick();
  await finished("gh-2");
  expect(pathfinder.outcomes("gh-2")).toEqual(["dry-run"]);
  expect(submitted.greenhouse).toHaveLength(1);
  const tab = tabFor("greenhouse.io/acme/jobs/2");
  expect(tab).toBeDefined();
  await expect(tab!.locator("#first_name")).toHaveValue("Asha");
  await expect(tab!.locator(".select__single-value").first()).toBeVisible();
  await tab!.close();
});

test("applies on Lever: reads the form, has the server answer it, and confirms on the page it moves to", async () => {
  pathfinder.add(task("lv-1", { system: "LEVER", company: "Meesho", applyUrl: "https://jobs.lever.co/meesho/1/apply" }));
  await nextTick();
  await finished("lv-1");
  expect(pathfinder.outcomes("lv-1")).toEqual(["submitting", "applied"]);
  expect(pathfinder.asked.find((entry) => entry.taskId === "lv-1")?.fields.length).toBe(11);
  expect(submitted.lever[0]).toEqual(
    expect.arrayContaining([
      // Ours, not what Lever read from the resume.
      ["name", "Asha Rao"],
      ["email", "asha.rao@example.test"],
      ["resume", expect.stringMatching(/^file:Asha Rao - Resume\.pdf/)],
    ]),
  );
});

test("applies on Ashby: Yes/No buttons, the place autocomplete, and its own Submit", async () => {
  pathfinder.add(task("ab-1", { system: "ASHBY", company: "Acme", applyUrl: "https://jobs.ashbyhq.com/Acme/1/application" }));
  await nextTick();
  await finished("ab-1");
  expect(pathfinder.outcomes("ab-1")).toEqual(["submitting", "applied"]);
  expect(submitted.ashby[0]).toEqual(expect.arrayContaining([["_systemfield_name", "Asha Rao"], ["_systemfield_location", "Pune, Maharashtra, India"], ["worked-1", "No"]]));
});

test("hands the student a job on the company's own site, without touching it", async () => {
  pathfinder.add(task("cs-1", { system: "GREENHOUSE", applyUrl: "https://careers.example.com/jobs/1" }));
  await nextTick();
  await finished("cs-1");
  expect(pathfinder.reports.find((report) => report.taskId === "cs-1")).toMatchObject({ outcome: "needs-student", reason: REASONS.noForm });
  // Left open for the student.
  expect(tabFor("careers.example.com")).toBeDefined();
});

test("never submits anything twice", () => {
  for (const id of ["gh-1", "lv-1", "ab-1"]) expect(pathfinder.outcomes(id).filter((outcome) => outcome === "submitting")).toHaveLength(1);
  expect(submitted.greenhouse.length + submitted.lever.length + submitted.ashby.length).toBe(3);
});
