import { chromium, type Browser } from "playwright";

/**
 * One shared headless Chromium for PDF rendering: launched on first use, closed after 5 idle
 * minutes, and at most MAX_PAGES renders at once. Each render gets a fresh context with JavaScript
 * off, the network offline and every request aborted, so a resume can never load anything.
 */

const MAX_PAGES = 2;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_PAGES) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
  if (active === 0 && waiting.length === 0) scheduleIdleClose();
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE_MS);
  idleTimer.unref();
}

function getBrowser(): Promise<Browser> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
    browserPromise
      .then((browser) =>
        browser.on("disconnected", () => {
          browserPromise = null;
        }),
      )
      .catch(() => {
        browserPromise = null;
      });
  }
  return browserPromise;
}

export interface RenderOptions {
  timeoutMs?: number;
  /** Tests only: called for every request the page tries to make (all are aborted anyway). */
  onRequest?: (url: string) => void;
}

export async function renderPdf(html: string, options: RenderOptions = {}): Promise<Uint8Array> {
  const timeout = options.timeoutMs ?? 25_000;
  await acquire();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      await context.route("**/*", (route) => {
        options.onRequest?.(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      await page.setContent(html, { waitUntil: "load", timeout });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      });
      return new Uint8Array(pdf);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    release();
  }
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = browserPromise;
  browserPromise = null;
  if (pending) await (await pending.catch(() => null))?.close().catch(() => {});
}
