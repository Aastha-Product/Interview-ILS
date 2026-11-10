import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REASONS, type LeasedTask } from "./protocol";

/** Chrome's APIs the worker uses, in memory. */
function fakeChrome() {
  const stores = { local: new Map<string, unknown>(), session: new Map<string, unknown>() };
  const area = (store: Map<string, unknown>) => ({
    get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((key) => store.has(key)).map((key) => [key, structuredClone(store.get(key))])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => store.delete(key)),
  });
  const on = <F,>() => {
    const listeners: F[] = [];
    return { listeners, addListener: (listener: F) => void listeners.push(listener) };
  };
  let nextTab = 7;
  const chrome = {
    runtime: { id: "pathfinder-extension", sendMessage: vi.fn(), onMessage: on<(...args: unknown[]) => unknown>(), onInstalled: on<() => void>(), onStartup: on<() => void>() },
    storage: { local: area(stores.local), session: area(stores.session) },
    alarms: { create: vi.fn(), onAlarm: on<(alarm: { name: string }) => void>() },
    tabs: { create: vi.fn(async ({ url }: { url: string }) => ({ id: nextTab++, url })), remove: vi.fn(async () => undefined), onUpdated: on<(tabId: number, info: { status?: string }) => void>(), onRemoved: on<(tabId: number) => void>() },
    scripting: { executeScript: vi.fn(async () => []) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
  };
  return { chrome, stores };
}

const BASE = "https://pathfinderedtech.com";
const leased: LeasedTask = {
  taskId: "t1",
  leaseId: "lease-1",
  leaseUntil: "2026-11-10T10:10:00Z",
  applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
  system: "GREENHOUSE",
  title: "Data Analyst",
  company: "Acme",
  dryRun: false,
  answers: null,
  documents: { resume: true, coverLetter: false },
};

/** Pathfinder's /api/ext, as the worker calls it. */
type Call = { method: string; path: string; body: unknown; auth: string | null };
function fakeServer(responses: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: pathname + search, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") });
    const custom = responses[`${method} ${pathname}`];
    if (custom) return custom();
    if (pathname === "/api/ext/status") return json({ name: "Asha Rao", enabled: true, dryRun: false, ready: 1 });
    if (pathname === "/api/ext/lease") return json(leased);
    if (pathname.endsWith("/answers")) return json({ answers: { first_name: { kind: "text", value: "Asha" } }, missing: [] });
    if (pathname.endsWith("/document")) return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''Asha%20Rao%20-%20Resume.pdf" } });
    if (pathname.endsWith("/report")) return json({ ok: true });
    return json({ error: "Not found" }, 404);
  });
  return { calls, fetch, json };
}

let fake: ReturnType<typeof fakeChrome>;
let server: ReturnType<typeof fakeServer>;
let worker: typeof import("./background");

async function setUp(responses?: Parameters<typeof fakeServer>[0]) {
  fake = fakeChrome();
  server = fakeServer(responses);
  vi.stubGlobal("chrome", fake.chrome);
  vi.stubGlobal("fetch", server.fetch);
  vi.resetModules();
  worker = await import("./background");
}
const connectNow = () => fake.stores.local.set("connection", { token: "pfx_token", base: BASE });
const fromTab = (tabId: number) => ({ id: "pathfinder-extension", tab: { id: tabId } });
const paths = () => server.calls.map((call) => `${call.method} ${call.path}`);

beforeEach(() => setUp());
afterEach(async () => {
  // Let work a test set off (a tick after connecting, say) finish before Chrome goes away.
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.unstubAllGlobals();
});

describe("connecting (auto-apply step 5b)", () => {
  it("keeps a token only from Pathfinder's own page, and only once Pathfinder accepts it", async () => {
    const connect = { type: "connect", token: "pfx_token" };
    expect(await worker.handle(connect, { id: "pathfinder-extension", origin: "https://evil.example" })).toEqual({ ok: false, error: "Only Pathfinder can connect the extension." });
    expect(await worker.handle(connect, { id: "another-extension", origin: BASE })).toMatchObject({ ok: false });
    expect(await worker.handle({ type: "connect", token: "stolen-cookie" }, { id: "pathfinder-extension", origin: BASE })).toMatchObject({ ok: false });
    expect(fake.stores.local.has("connection")).toBe(false);

    expect(await worker.handle(connect, { id: "pathfinder-extension", origin: BASE })).toEqual({ ok: true, data: { name: "Asha Rao" } });
    expect(fake.stores.local.get("connection")).toEqual({ token: "pfx_token", base: BASE });
    expect(server.calls[0]).toMatchObject({ path: "/api/ext/status", auth: "Bearer pfx_token" });
  });

  it("refuses a token Pathfinder doesn't accept", async () => {
    await setUp({ "GET /api/ext/status": () => server.json({ error: "Connect the extension again." }, 401) });
    expect(await worker.handle({ type: "connect", token: "pfx_old" }, { id: "pathfinder-extension", url: `${BASE}/auto-apply/extension` })).toEqual({ ok: false, error: "Connect the extension again." });
    expect(fake.stores.local.has("connection")).toBe(false);
  });

  it("stops when Pathfinder no longer accepts the token, and says so on its icon", async () => {
    await setUp({ "POST /api/ext/lease": () => server.json({ error: "Connect the extension again." }, 401) });
    connectNow();
    await worker.tick();
    expect(fake.stores.local.has("connection")).toBe(false);
    expect(fake.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
    expect(fake.chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe("taking applications one at a time", () => {
  it("does nothing until connected", async () => {
    await worker.tick();
    expect(server.calls).toEqual([]);
  });

  it("leases one, opens the job in a background tab, and puts the apply script in each page that loads there", async () => {
    connectNow();
    await Promise.all([worker.tick(1000), worker.tick(1000)]);
    expect(paths()).toEqual(["POST /api/ext/lease"]);
    expect(fake.chrome.tabs.create).toHaveBeenCalledWith({ url: leased.applyUrl, active: false });
    expect(await worker.current()).toEqual({ task: leased, tabId: 7, startedAt: 1000, submitting: false });

    await worker.pageLoaded(8);
    expect(fake.chrome.scripting.executeScript).not.toHaveBeenCalled();
    await worker.pageLoaded(7);
    expect(fake.chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["apply.js"] });

    // Busy: the next minute asks for nothing.
    await worker.tick(61_000);
    expect(paths()).toEqual(["POST /api/ext/lease"]);
  });

  it("hands the student a job that moved to a page the extension may not touch, instead of leasing it again and again", async () => {
    connectNow();
    await worker.tick();
    fake.chrome.scripting.executeScript.mockRejectedValueOnce(new Error("Cannot access contents of the page."));
    await worker.pageLoaded(7);
    expect(server.calls.at(-1)?.body).toEqual({ leaseId: "lease-1", outcome: "needs-student", reason: REASONS.noForm });
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(await worker.current()).toBeNull();
  });

  it("waits when there's nothing to apply for", async () => {
    await setUp({ "POST /api/ext/lease": () => new Response(null, { status: 204 }) });
    connectNow();
    await worker.tick();
    expect(fake.chrome.tabs.create).not.toHaveBeenCalled();
    expect(await worker.current()).toBeNull();
  });

  it("gives back an application whose tab never reported, unless Submit was pressed", async () => {
    connectNow();
    await worker.tick(0);
    await worker.tick(worker.HOLD_MS);
    expect(server.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/ext/tasks/t1/report", body: { leaseId: "lease-1", outcome: "release" } });
    expect(fake.chrome.tabs.remove).toHaveBeenCalledWith(7);
    expect(await worker.current()).toBeNull();

    await worker.tick(worker.HOLD_MS + 1);
    await worker.handle({ type: "report", report: { outcome: "submitting" } }, fromTab(8), worker.HOLD_MS + 1);
    const before = server.calls.length;
    await worker.tick(worker.HOLD_MS * 3);
    // After Submit nothing is said: the server's own wait makes it "check this one", never a resubmission.
    expect(server.calls.length).toBe(before);
    expect(fake.chrome.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it("gives it back when the student closes the tab before Submit", async () => {
    connectNow();
    await worker.tick();
    await worker.tabClosed(7);
    expect(server.calls.at(-1)?.body).toEqual({ leaseId: "lease-1", outcome: "release" });
    expect(await worker.current()).toBeNull();
  });
});

describe("what the job's tab asks for", () => {
  beforeEach(async () => {
    connectNow();
    await worker.tick(0);
  });

  it("answers only the tab it opened", async () => {
    expect(await worker.handle({ type: "task" }, fromTab(8))).toEqual({ ok: false, error: "This tab isn't applying for anything." });
    expect(await worker.handle({ type: "task" }, { tab: { id: 7 } })).toMatchObject({ ok: false });
    expect(await worker.handle({ type: "task" }, fromTab(7))).toEqual({ ok: true, data: { task: leased, submitted: false } });
  });

  it("gets answers and documents with the lease", async () => {
    const fields = [{ key: "first_name", label: "First Name", required: true, type: "text", options: [] }];
    expect(await worker.handle({ type: "answers", fields }, fromTab(7))).toEqual({ ok: true, data: { answers: { first_name: { kind: "text", value: "Asha" } }, missing: [] } });
    expect(server.calls.at(-1)).toMatchObject({ path: "/api/ext/tasks/t1/answers", body: { leaseId: "lease-1", fields } });
    expect(await worker.handle({ type: "document", kind: "resume" }, fromTab(7))).toEqual({ ok: true, data: { name: "Asha Rao - Resume.pdf", type: "application/pdf", base64: btoa("%PDF") } });
    expect(server.calls.at(-1)?.path).toBe("/api/ext/tasks/t1/document?kind=resume&lease=lease-1");
  });

  it("records Submit, then the outcome, closing the tab unless the student needs it", async () => {
    expect(await worker.handle({ type: "report", report: { outcome: "submitting" } }, fromTab(7), 5000)).toEqual({ ok: true, data: null });
    expect(await worker.current()).toMatchObject({ submitting: true, startedAt: 5000 });
    // The page after Submit asks again, and learns it's past Submit.
    expect(await worker.handle({ type: "task" }, fromTab(7))).toEqual({ ok: true, data: { task: leased, submitted: true } });
    await worker.handle({ type: "report", report: { outcome: "applied", evidence: { url: "u", text: "Thank you" } } }, fromTab(7));
    expect(server.calls.at(-1)?.body).toEqual({ leaseId: "lease-1", outcome: "applied", evidence: { url: "u", text: "Thank you" } });
    expect(fake.chrome.tabs.remove).toHaveBeenCalledWith(7);
    expect(await worker.current()).toBeNull();
  });

  it("leaves the tab open for the student", async () => {
    await worker.handle({ type: "report", report: { outcome: "needs-student", reason: "Answer this" }, keepTab: true }, fromTab(7));
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(await worker.current()).toBeNull();
  });

  it("passes Pathfinder's refusal on, so the tab never presses Submit", async () => {
    await setUp({ "POST /api/ext/tasks/t1/report": () => server.json({ error: "This application isn't held by this browser any more." }, 409) });
    connectNow();
    await worker.tick(0);
    expect(await worker.handle({ type: "report", report: { outcome: "submitting" } }, fromTab(7))).toEqual({ ok: false, error: "This application isn't held by this browser any more." });
    expect(await worker.current()).toMatchObject({ submitting: false });
    await worker.handle({ type: "report", report: { outcome: "failed", reason: "x" } }, fromTab(7));
    expect(await worker.current()).toBeNull();
  });

  it("refuses what it doesn't know", async () => {
    expect(await worker.handle({ type: "delete-everything" }, fromTab(7))).toEqual({ ok: false, error: "Unknown request." });
  });
});

describe("wiring", () => {
  it("ticks every minute, injects on page loads, and answers messages", async () => {
    worker.start();
    expect(fake.chrome.alarms.create).toHaveBeenCalledWith(worker.TICK, { periodInMinutes: 1 });
    connectNow();
    fake.chrome.alarms.onAlarm.listeners[0]({ name: worker.TICK });
    await vi.waitFor(() => expect(fake.chrome.tabs.create).toHaveBeenCalled());
    await vi.waitFor(async () => expect(await worker.current()).not.toBeNull());
    fake.chrome.tabs.onUpdated.listeners[0](7, { status: "complete" });
    await vi.waitFor(() => expect(fake.chrome.scripting.executeScript).toHaveBeenCalled());
    const sendResponse = vi.fn();
    expect(fake.chrome.runtime.onMessage.listeners[0]({ type: "task" }, fromTab(7), sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { task: leased, submitted: false } }));
    fake.chrome.tabs.onRemoved.listeners[0](7);
    await vi.waitFor(() => expect(server.calls.at(-1)?.body).toEqual({ leaseId: "lease-1", outcome: "release" }));
    expect(await worker.current()).toBeNull();
  });

  it("reads the PDF's name from Pathfinder's download header", () => {
    expect(worker.fileName('attachment; filename="Resume.pdf"', "x.pdf")).toBe("Resume.pdf");
    expect(worker.fileName("attachment; filename*=UTF-8''Asha%20Rao.pdf; filename=\"Asha Rao.pdf\"", "x.pdf")).toBe("Asha Rao.pdf");
    expect(worker.fileName(null, "x.pdf")).toBe("x.pdf");
  });
});
