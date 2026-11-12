// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { build, DEV_ORIGIN } from "./build.mjs";

describe("the extension's builds", () => {
  it("packages the Web Store's without the local development address, anywhere", async () => {
    const { zip } = (await build({ store: true })) as { zip: string };
    const files = unzipSync(new Uint8Array(await readFile(zip)));
    expect(Object.keys(files).sort()).toEqual(["apply.js", "bridge.js", "icons/icon-128.png", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "manifest.json", "popup.html", "popup.js", "worker.js"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as { version: string; host_permissions: string[]; content_scripts: { matches: string[] }[] };
    expect(zip).toContain(`pathfinder-extension-${manifest.version}.zip`);
    expect(manifest.host_permissions).toContain("https://pathfinderedtech.com/*");
    for (const name of Object.keys(files).filter((file) => !file.endsWith(".png"))) expect(strFromU8(files[name]), name).not.toContain("localhost");
    // Minified (QA M6): a dropped `minify` flag would ship readable source and still pass the checks
    // above. esbuild's minified output has no source-style indentation.
    for (const name of ["worker.js", "apply.js", "popup.js", "bridge.js"]) expect(strFromU8(files[name]), name).not.toMatch(/\n {2,}/);
  }, 60_000);

  it("keeps it in the build for working on Pathfinder locally", async () => {
    const { out } = (await build()) as { out: string };
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as { host_permissions: string[] };
    expect(manifest.host_permissions).toContain(`${DEV_ORIGIN}/*`);
    expect(await readFile(join(out, "worker.js"), "utf8")).toContain(DEV_ORIGIN);
  }, 60_000);
});
