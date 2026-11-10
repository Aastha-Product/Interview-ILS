// Renders the extension's icons from Pathfinder's own (src/app/icon.svg): Chrome wants PNGs at
// 16, 32, 48 and 128 pixels. Run again only when the icon changes: node extension/icons/make-icons.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const svg = await readFile(join(here, "..", "..", "src", "app", "icon.svg"), "utf8");
const browser = await chromium.launch({ channel: "chromium" });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(here, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
