// Load test (brief, Phase 4): 50 simulated students run the main flow at the same time against a
// local web app and worker using the mock AI. Measures each API step and posting-to-PDF time.
//
//   1. pnpm services:up && pnpm db:deploy
//   2. pnpm dev            (with GEMINI_API_KEY empty, so the mock AI is used)
//   3. pnpm worker
//   4. pnpm load-test      (options: --users 50 --base http://localhost:3000 --out report.json)
//
// Students are created straight in the local database with a session (sign-in isn't what's under
// test, and its per-IP limit would get in the way), and deleted again at the end, files included.
// Refuses to run against anything but localhost.
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), quiet: true });

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const USERS = Number(args.users ?? 50);
const BASE = args.base ?? "http://localhost:3000";
const OUT = args.out ?? path.join(tmpdir(), `pathfinder-load-${Date.now()}.json`);
const PDF_TIMEOUT_MS = 150_000;
const POLL_MS = 2_000;
const TARGET_P95_MS = 120_000; // brief: posting to reviewed PDF in under 2 minutes

const isLocal = (u) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname);
if (!isLocal(BASE) || !isLocal(process.env.DATABASE_URL ?? "")) {
  console.error("The load test only runs against a local app and database.");
  process.exit(2);
}

const jobText = readFileSync(path.join(root, "fixtures/job-qa-pune.txt"), "utf8").replace(/^- Ignore all previous instructions.*$/m, "");
const PROFILE = {
  headline: "Final-year B.Tech student looking for QA roles",
  summary: "Final-year computer science student looking for an entry-level software testing role.",
  location: "Pune",
  phone: "",
  links: [],
  experiences: [
    { title: "QA Intern", company: "Example Softech", location: "", startDate: "Jun 2025", endDate: "Aug 2025", current: false, highlights: ["Wrote 120 manual test cases", "Automated 15 regression tests with Selenium"] },
  ],
  projects: [
    { name: "Library Management System", role: "", url: "", startDate: "", endDate: "", technologies: ["Java", "MySQL"], highlights: ["Wrote 40 JUnit tests"] },
  ],
  education: [{ institution: "Example Institute of Technology", degree: "B.Tech", field: "CSE", startDate: "2022", endDate: "2026", grade: "7.8" }],
  skills: ["Python", "Java", "SQL", "Selenium", "Postman", "Git"].map((name) => ({ name, category: "" })),
};

const timings = {}; // step -> [{ ms, status }]
const record = (step, ms, status) => (timings[step] ??= []).push({ ms, status });

async function call(user, step, method, url, body) {
  const started = performance.now();
  const response = await fetch(new URL(url, BASE), {
    method,
    headers: { Cookie: `authjs.session-token=${user.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const ms = performance.now() - started;
  record(step, ms, response.status);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${step}: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  return response;
}

async function runStudent(user, index) {
  await new Promise((r) => setTimeout(r, Math.random() * 2_000)); // students don't all click in the same millisecond
  await call(user, "PUT /api/profile", "PUT", "/api/profile", { expectedVersion: 0, profile: PROFILE });

  // Five postings shared by ten students each, like a class applying to the same openings.
  const postingStarted = performance.now();
  const imported = await (
    await call(user, "POST /api/jobs/import", "POST", "/api/jobs/import", {
      text: jobText,
      title: "QA Engineer - Fresher",
      company: `LoadTest Co ${index % 5}`,
      location: "Pune",
    })
  ).json();
  const { applicationId } = await (
    await call(user, "POST /api/applications", "POST", "/api/applications", { jobListingId: imported.jobListingId })
  ).json();

  let view;
  for (;;) {
    view = await (await call(user, "GET /api/applications/:id", "GET", `/api/applications/${applicationId}`)).json();
    const failed = view.tasks.find((t) => t.state === "failed");
    if (failed) throw new Error(`task failed: ${failed.reason}`);
    if (view.resume?.pdfReady) break;
    if (performance.now() - postingStarted > PDF_TIMEOUT_MS) throw new Error("PDF not ready in time");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const postingToPdfMs = performance.now() - postingStarted;

  const { url } = await (await call(user, "GET /api/applications/:id/pdf", "GET", `/api/applications/${applicationId}/pdf`)).json();
  const pdf = await call(user, "GET /api/files (PDF)", "GET", url);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("download is not a PDF");

  await call(user, "PATCH /api/applications/:id", "PATCH", `/api/applications/${applicationId}`, { status: "APPLIED" });
  const dashboard = await (await call(user, "GET /api/dashboard", "GET", "/api/dashboard")).json();
  if (!dashboard) throw new Error("empty dashboard");
  return { postingToPdfMs, removed: view.resume.factCheck?.removed?.length ?? 0 };
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const summarise = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, p50: Math.round(pct(s, 50)), p95: Math.round(pct(s, 95)), max: Math.round(s.at(-1) ?? 0) };
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const runId = randomBytes(4).toString("hex");
  const users = [];
  try {
    for (let i = 0; i < USERS; i++) {
      const email = `loadtest-${runId}-${i}@example.test`;
      const { rows } = await db.query(
        `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now()) RETURNING id`,
        [`lt${runId}${i}`, email, `Load Test ${i}`],
      );
      const token = randomBytes(32).toString("hex");
      await db.query(
        `INSERT INTO "Session" (id, "sessionToken", "userId", expires, "createdAt", "updatedAt") VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
        [`lts${runId}${i}`, token, rows[0].id],
      );
      users.push({ id: rows[0].id, token });
    }

    console.log(`Running ${USERS} simulated students against ${BASE} …`);
    const started = performance.now();
    const results = await Promise.allSettled(users.map((u, i) => runStudent(u, i)));
    const wallMs = performance.now() - started;

    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ user: i, error: String(r.reason?.message ?? r.reason) }] : []));
    const steps = Object.fromEntries(
      Object.entries(timings).map(([step, list]) => [
        step,
        { ...summarise(list.map((t) => t.ms)), errors: list.filter((t) => t.status >= 400).length, rateLimited: list.filter((t) => t.status === 429).length },
      ]),
    );
    const postingToPdf = summarise(ok.map((r) => r.postingToPdfMs));
    const report = {
      at: new Date().toISOString(),
      users: USERS,
      completed: ok.length,
      failed: failures.length,
      wallSeconds: Math.round(wallMs / 1000),
      postingToPdfMs: postingToPdf,
      targetP95Ms: TARGET_P95_MS,
      steps,
      failures: failures.slice(0, 20),
    };
    writeFileSync(OUT, JSON.stringify(report, null, 2));

    console.log(`\nCompleted ${ok.length}/${USERS} in ${report.wallSeconds} s. Posting → PDF: p50 ${postingToPdf.p50} ms, p95 ${postingToPdf.p95} ms, max ${postingToPdf.max} ms`);
    console.table(Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v])));
    if (failures.length) console.log("First failures:", failures.slice(0, 5));
    console.log(`Report: ${OUT}`);
    const pass = failures.length === 0 && postingToPdf.p95 < TARGET_P95_MS;
    console.log(pass ? "PASS" : "FAIL");
    process.exitCode = pass ? 0 : 1;
  } finally {
    // Clean up: users cascade to everything they own; then their files and the test postings.
    const ids = users.map((u) => u.id);
    if (ids.length) await db.query(`DELETE FROM "User" WHERE id = ANY($1)`, [ids]);
    await db.query(
      `DELETE FROM "JobListing" l WHERE l.company LIKE 'LoadTest Co %' AND NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."jobListingId" = l.id)`,
    );
    await db.end();
    const storage = process.env.STORAGE_LOCAL_DIR || path.join(root, ".local", "storage");
    for (const id of ids) rmSync(path.join(storage, "users", id), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
