// Imported first by index.ts: these must be set before Playwright or the logger load.
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

// Chromium is installed inside node_modules (see e2e/scripts/install-browsers.mjs).
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";
process.env.PATHFINDER_SERVICE ??= "worker";
// Same default as the web app (apps/web/next.config.ts), so both see the same local files.
process.env.STORAGE_LOCAL_DIR ||= path.join(repoRoot, ".local", "storage");
