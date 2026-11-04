// Imported first by worker tests: keep test files out of the real .local/storage folder.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(os.tmpdir(), "pathfinder-worker-test-"));
