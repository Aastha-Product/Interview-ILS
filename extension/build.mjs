// Builds the extension into extension/dist, ready for chrome://extensions → Load unpacked.
// Usage: node extension/build.mjs [--watch]
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
await mkdir(out, { recursive: true });
await copyFile(join(root, "manifest.json"), join(out, "manifest.json"));

const options = {
  entryPoints: { worker: join(root, "src/worker.ts"), apply: join(root, "src/apply.ts"), bridge: join(root, "src/bridge.ts") },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome116",
  legalComments: "none",
  logLevel: "info",
};
if (process.argv.includes("--watch")) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
