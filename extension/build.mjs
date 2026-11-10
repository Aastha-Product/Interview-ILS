// Builds the extension into extension/dist, ready for chrome://extensions → Load unpacked.
// Usage: node extension/build.mjs [--watch] [--test] [--store]
//
// --test builds extension/dist-test for the Chrome tests (extension/e2e): the same extension, also
// allowed to talk to a fake Pathfinder at TEST_ORIGIN. The real build never includes it.
//
// --store builds extension/dist-store and zips it into extension/release/ for the Chrome Web Store:
// only Pathfinder's live sites, without the local development address (localhost:3000), so no
// program on a student's computer can hand it a token.
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { zipSync } from "fflate";

export const TEST_ORIGIN = "http://localhost:4319";
export const DEV_ORIGIN = "http://localhost:3000";

const root = dirname(fileURLToPath(import.meta.url));

async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** Builds into dist (dist-test, dist-store); returns the folder, and for the store the zip too. */
export async function build({ test = false, store = false, watch = false } = {}) {
  const out = join(root, test ? "dist-test" : store ? "dist-store" : "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (test) {
    manifest.host_permissions.push(`${TEST_ORIGIN}/*`);
    manifest.content_scripts[0].matches.push(`${TEST_ORIGIN}/*`);
  }
  if (store) {
    const live = (pattern) => !pattern.startsWith(`${DEV_ORIGIN}/`);
    manifest.host_permissions = manifest.host_permissions.filter(live);
    manifest.content_scripts[0].matches = manifest.content_scripts[0].matches.filter(live);
  }
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(join(root, "popup.html"), join(out, "popup.html"));
  await cp(join(root, "icons"), join(out, "icons"), { recursive: true, filter: (source) => !source.endsWith(".mjs") });

  const options = {
    entryPoints: { worker: join(root, "src/worker.ts"), apply: join(root, "src/apply.ts"), bridge: join(root, "src/bridge.ts"), popup: join(root, "src/popup.ts") },
    outdir: out,
    bundle: true,
    format: "iife",
    target: "chrome116",
    legalComments: "none",
    logLevel: test || store ? "warning" : "info",
    define: { __PATHFINDER_TEST_ORIGIN__: test ? JSON.stringify(TEST_ORIGIN) : "undefined", __PATHFINDER_STORE__: store ? "true" : "false" },
    minify: store,
  };
  if (watch) {
    await (await esbuild.context(options)).watch();
    return { out };
  }
  await esbuild.build(options);
  if (!store) return { out };

  // The zip the Web Store takes: the folder's contents at its top level.
  const files = {};
  for (const file of await filesIn(out)) files[relative(out, file).replaceAll("\\", "/")] = new Uint8Array(await readFile(file));
  const release = join(root, "release");
  await mkdir(release, { recursive: true });
  const zip = join(release, `pathfinder-extension-${manifest.version}.zip`);
  await writeFile(zip, zipSync(files, { level: 9 }));
  return { out, zip };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { zip } = await build({ test: process.argv.includes("--test"), store: process.argv.includes("--store"), watch: process.argv.includes("--watch") });
  if (zip) console.log(`Store package: ${relative(process.cwd(), zip)}`);
}
