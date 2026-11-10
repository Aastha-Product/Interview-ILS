// Builds the extension into extension/dist, ready for chrome://extensions → Load unpacked.
// Usage: node extension/build.mjs [--watch] [--test]
//
// --test builds extension/dist-test for the Chrome tests (extension/e2e): the same extension, also
// allowed to talk to a fake Pathfinder at TEST_ORIGIN. The real build never includes it.
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

export const TEST_ORIGIN = "http://localhost:4319";

const root = dirname(fileURLToPath(import.meta.url));

/** Builds into dist (or dist-test); returns the folder. */
export async function build({ test = false, watch = false } = {}) {
  const out = join(root, test ? "dist-test" : "dist");
  await mkdir(out, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (test) {
    manifest.host_permissions.push(`${TEST_ORIGIN}/*`);
    manifest.content_scripts[0].matches.push(`${TEST_ORIGIN}/*`);
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
    logLevel: test ? "warning" : "info",
    define: { __PATHFINDER_TEST_ORIGIN__: test ? JSON.stringify(TEST_ORIGIN) : "undefined" },
  };
  if (watch) await (await esbuild.context(options)).watch();
  else await esbuild.build(options);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build({ test: process.argv.includes("--test"), watch: process.argv.includes("--watch") });
}
