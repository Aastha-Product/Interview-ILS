#!/usr/bin/env node
// Local development services without Docker.
//
//   node scripts/services.mjs up      start Postgres in the background (creates it on first run)
//   node scripts/services.mjs down    stop it
//   node scripts/services.mjs status  show whether it is running
//   node scripts/services.mjs reset   stop it and delete all local data
//
// Postgres comes from the @embedded-postgres/<platform> npm packages (real PostgreSQL 17 binaries).
// Data lives in .local/pg. Connection details are read from DATABASE_URL in .env.
// File storage needs no service: without S3_ENDPOINT the app writes to .local/storage.

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "dotenv";
import pg from "pg";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), quiet: true });

const localDir = path.join(root, ".local");
const dataDir = path.join(localDir, "pg");
const logFile = path.join(localDir, "pg.log");

const dbUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://pathfinder:pathfinder@localhost:5432/pathfinder",
);
const testUrl = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL) : null;
const user = decodeURIComponent(dbUrl.username);
const password = decodeURIComponent(dbUrl.password);
const port = Number(dbUrl.port || 5432);
const databases = [dbUrl.pathname.slice(1), testUrl?.pathname.slice(1)].filter(Boolean);

if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname)) {
  console.error(`DATABASE_URL points at ${dbUrl.hostname}; this script only manages a local database.`);
  process.exit(1);
}

async function binaries() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const pkg = `@embedded-postgres/${platform}-${process.arch}`;
  try {
    return await import(pkg);
  } catch {
    console.error(`No Postgres binaries for ${process.platform}-${process.arch} (${pkg}). Run pnpm install.`);
    process.exit(1);
  }
}

async function isRunning(pgCtl) {
  if (!existsSync(dataDir)) return false;
  try {
    await run(pgCtl, ["status", "-D", dataDir]);
    return true;
  } catch {
    return false;
  }
}

async function up() {
  const { pg_ctl: pgCtl, initdb } = await binaries();
  mkdirSync(localDir, { recursive: true });

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log("Creating a local Postgres database in .local/pg ...");
    const pwFile = path.join(localDir, ".pgpass-init");
    writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      await run(initdb, [
        "-D", dataDir,
        "-U", user,
        `--pwfile=${pwFile}`,
        "--auth=scram-sha-256",
        "-E", "UTF8",
        "--locale=C",
      ]);
    } finally {
      rmSync(pwFile, { force: true });
    }
  }

  if (await isRunning(pgCtl)) {
    console.log(`Postgres is already running on port ${port}.`);
  } else {
    // pg_ctl hands its stdout/stderr to the long-running server, so capturing them (execFile)
    // would wait forever. Ignore its output and wait only for pg_ctl itself to exit.
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        pgCtl,
        ["start", "-D", dataDir, "-l", logFile, "-w", "-t", "60",
          "-o", `-p ${port} -c listen_addresses=localhost`],
        { stdio: "ignore", windowsHide: true },
      );
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`pg_ctl start failed (exit code ${code})`);
    console.log(`Postgres started on port ${port} (log: .local/pg.log).`);
  }

  const admin = new pg.Client({ host: "localhost", port, user, password, database: "postgres" });
  await admin.connect();
  try {
    for (const name of databases) {
      const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (!rowCount) {
        await admin.query(`CREATE DATABASE "${name.replaceAll('"', "")}"`);
        console.log(`Created database ${name}.`);
      }
    }
  } finally {
    await admin.end();
  }
}

async function down() {
  const { pg_ctl: pgCtl } = await binaries();
  if (!(await isRunning(pgCtl))) {
    console.log("Postgres is not running.");
    return;
  }
  await run(pgCtl, ["stop", "-D", dataDir, "-m", "fast", "-w"]);
  console.log("Postgres stopped.");
}

async function status() {
  const { pg_ctl: pgCtl } = await binaries();
  console.log((await isRunning(pgCtl)) ? `Postgres is running on port ${port}.` : "Postgres is not running.");
}

async function reset() {
  await down();
  rmSync(localDir, { recursive: true, force: true });
  console.log("Deleted .local (database and stored files).");
}

const commands = { up, down, status, reset };
const command = commands[process.argv[2]];
if (!command) {
  console.error("Usage: node scripts/services.mjs up|down|status|reset");
  process.exit(1);
}
command().catch((err) => {
  console.error(err.stderr || err.message);
  if (existsSync(logFile)) console.error(`See .local/pg.log for details.`);
  process.exit(1);
});
