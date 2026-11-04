// Installs Playwright's Chromium inside node_modules (PLAYWRIGHT_BROWSERS_PATH=0) instead of the
// user's home folder, so it lives on the same drive as the project. Pass --with-deps in CI (Linux)
// to also install the system libraries Chromium needs.
import { execSync } from "node:child_process";

const withDeps = process.argv.includes("--with-deps") ? " --with-deps" : "";
execSync(`playwright install${withDeps} chromium`, {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
});
