// Pathfinder extension: the background worker. Once a minute, if this browser is connected and
// isn't applying already, it asks Pathfinder for the next application, opens the job in a tab in
// the background, and puts the apply script in it. It's the only part that talks to Pathfinder:
// the tab asks it for answers and documents, and reports through it.

import { isPathfinderOrigin, REASONS, type BridgeRequest, type DocumentFile, type LeasedTask, type Reply, type Report, type TabRequest } from "./protocol";

export const TICK = "pathfinder-tick";
/** Less than the server's 10-minute lease: a tab that never reports is given up first. */
export const HOLD_MS = 9 * 60_000;

export type Connection = { token: string; base: string };
export type Current = { task: LeasedTask; tabId: number; startedAt: number; submitting: boolean };

const ok = <T>(data: T): Reply<T> => ({ ok: true, data });
const fail = (error: string): Reply<never> => ({ ok: false, error });

export async function connection(): Promise<Connection | null> {
  const { connection } = await chrome.storage.local.get("connection");
  const value = connection as Partial<Connection> | undefined;
  return value?.token && value.base && isPathfinderOrigin(value.base) ? { token: value.token, base: value.base } : null;
}

export const PAUSED_BADGE = "Off";

/** Paused in this browser, from the popup. */
export async function isPaused(): Promise<boolean> {
  return (await chrome.storage.local.get("paused")).paused === true;
}

// What's in progress lives in session storage: the worker is stopped when idle and started again.
export async function current(): Promise<Current | null> {
  return ((await chrome.storage.session.get("current")).current as Current | undefined) ?? null;
}
const setCurrent = (value: Current | null) => (value ? chrome.storage.session.set({ current: value }) : chrome.storage.session.remove("current"));

async function badge(text: string, title: string) {
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setTitle({ title });
}

async function call(link: Connection, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${link.base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${link.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    credentials: "omit",
    cache: "no-store",
  });
  if (response.status === 401) {
    // Disconnected from Pathfinder (or the token ran out): stop until it's connected again.
    await chrome.storage.local.remove("connection");
    await badge("!", "Pathfinder: connect the extension again from Auto-apply → Connect the extension.");
  }
  return response;
}

async function sendReport(link: Connection, held: Current, report: Report): Promise<Response> {
  return call(link, `/api/ext/tasks/${encodeURIComponent(held.task.taskId)}/report`, { method: "POST", body: JSON.stringify({ leaseId: held.task.leaseId, ...report }) });
}

/** Done with the current application: report (when there's something to say), close its tab unless the student needs it. */
async function finish(link: Connection, held: Current, report: Report | null, keepTab: boolean): Promise<void> {
  await setCurrent(null);
  if (report) await sendReport(link, held, report).catch(() => undefined);
  if (!keepTab) await chrome.tabs.remove(held.tabId).catch(() => undefined);
}

let ticking: Promise<void> | null = null;

/** One minute's work; never two at once. */
export function tick(now = Date.now()): Promise<void> {
  ticking ??= runTick(now).finally(() => (ticking = null));
  return ticking;
}

async function runTick(now: number): Promise<void> {
  try {
    await runTickOnce(now);
  } catch (error) {
    // Offline, a DNS failure, an aborted request or a tab that won't open: give up this run and try
    // again on the next alarm. Never let it become an unhandled rejection (QA M7).
    console.warn("Pathfinder: this run didn't finish", error);
  }
}

async function runTickOnce(now: number): Promise<void> {
  const link = await connection();
  if (!link) return;
  const held = await current();
  if (held) {
    if (now - held.startedAt < HOLD_MS) return;
    // The tab never reported. Before Submit, the application goes back to Pathfinder; after, the
    // server's own wait makes it "check this one", never a second submission.
    await finish(link, held, held.submitting ? null : { outcome: "release" }, held.submitting);
    return;
  }
  // Paused from the popup: nothing new (what was under way above still finishes).
  if (await isPaused()) return;
  const response = await call(link, "/api/ext/lease", { method: "POST" });
  if (response.status !== 200) return;
  await badge("", "Pathfinder: connected");
  const task = (await response.json()) as LeasedTask;
  const tab = await chrome.tabs.create({ url: task.applyUrl, active: false });
  if (tab.id === undefined) {
    await sendReport(link, { task, tabId: -1, startedAt: now, submitting: false }, { outcome: "release" });
    return;
  }
  await setCurrent({ task, tabId: tab.id, startedAt: now, submitting: false });
}

/** Puts the apply script in the job's tab each time a page finishes loading there. */
export async function pageLoaded(tabId: number): Promise<void> {
  const held = await current();
  if (held?.tabId !== tabId) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["apply.js"] });
  } catch (error) {
    // A page the extension may not touch: the job moved to the company's own site (or didn't
    // load). Before Submit, it's the student's; otherwise it would be leased again and again.
    console.warn("Pathfinder: can't fill this page", error);
    const link = await connection();
    if (link && !held.submitting) await finish(link, held, { outcome: "needs-student", reason: REASONS.noForm }, true);
  }
}

/** The student closed the job's tab. */
export async function tabClosed(tabId: number): Promise<void> {
  const held = await current();
  const link = await connection();
  if (held?.tabId !== tabId || !link) return;
  await finish(link, held, held.submitting ? null : { outcome: "release" }, true);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function fileName(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Pathfinder answered ${response.status}.`;
}

/** The bridge on Pathfinder's page hands over a token: kept only if Pathfinder accepts it. */
async function connect(request: BridgeRequest, sender: chrome.runtime.MessageSender): Promise<Reply<{ name: string }>> {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (sender.id !== chrome.runtime.id || !isPathfinderOrigin(origin)) return fail("Only Pathfinder can connect the extension.");
  if (typeof request.token !== "string" || !request.token.startsWith("pfx_")) return fail("That isn't a Pathfinder token.");
  const link = { token: request.token, base: origin };
  const response = await fetch(`${origin}/api/ext/status`, { headers: { authorization: `Bearer ${link.token}` }, credentials: "omit", cache: "no-store" });
  if (!response.ok) return fail(await errorOf(response));
  const { name } = (await response.json()) as { name: string };
  // The name only for the popup to say whose account this browser applies for.
  await chrome.storage.local.set({ connection: { ...link, name } });
  await badge((await isPaused()) ? PAUSED_BADGE : "", "Pathfinder: connected");
  void tick();
  return ok({ name });
}

/** Everything the bridge and the job's tab ask for. */
export async function handle(message: unknown, sender: chrome.runtime.MessageSender, now = Date.now()): Promise<Reply<unknown>> {
  const request = message as (TabRequest | BridgeRequest) | null;
  if (request?.type === "connect") return connect(request, sender);
  const [held, link] = await Promise.all([current(), connection()]);
  // Only the tab opened for the application gets anything.
  if (!held || !link || sender.id !== chrome.runtime.id || sender.tab?.id !== held.tabId) return fail("This tab isn't applying for anything.");
  const task = held.task;
  const path = `/api/ext/tasks/${encodeURIComponent(task.taskId)}`;
  switch (request?.type) {
    case "task":
      return ok({ task, submitted: held.submitting });
    case "answers": {
      const response = await call(link, `${path}/answers`, { method: "POST", body: JSON.stringify({ leaseId: task.leaseId, fields: request.fields }) });
      return response.ok ? ok(await response.json()) : fail(await errorOf(response));
    }
    case "document": {
      const response = await call(link, `${path}/document?kind=${request.kind}&lease=${encodeURIComponent(task.leaseId)}`);
      if (!response.ok) return fail(await errorOf(response));
      const file: DocumentFile = {
        name: fileName(response.headers.get("content-disposition"), request.kind === "resume" ? "Resume.pdf" : "Cover letter.pdf"),
        type: "application/pdf",
        base64: base64(new Uint8Array(await response.arrayBuffer())),
      };
      return ok(file);
    }
    case "report": {
      const response = await sendReport(link, held, request.report);
      if (!response.ok) {
        if (request.report.outcome !== "submitting") await setCurrent(null);
        return fail(await errorOf(response));
      }
      if (request.report.outcome === "submitting") await setCurrent({ ...held, submitting: true, startedAt: now });
      else await finish(link, held, null, request.keepTab === true);
      return ok(null);
    }
    default:
      return fail("Unknown request.");
  }
}

/** Wires the worker to Chrome; called once when it starts. */
export function start(): void {
  const schedule = () => void chrome.alarms.create(TICK, { periodInMinutes: 1 });
  chrome.runtime.onInstalled.addListener(schedule);
  chrome.runtime.onStartup.addListener(schedule);
  schedule();
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TICK) void tick();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete") void pageLoaded(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => void tabClosed(tabId));
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message, sender).then(sendResponse, (error: unknown) => sendResponse(fail(error instanceof Error ? error.message : String(error))));
    return true; // Answers after the await.
  });
}
