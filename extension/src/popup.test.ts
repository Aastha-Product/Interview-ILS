import { afterEach, describe, expect, it, vi } from "vitest";

import { render, readState, type PopupState } from "./popup";

const act = () => ({ open: vi.fn(), pause: vi.fn() });
const root = () => {
  document.body.innerHTML = '<main id="popup"></main>';
  return document.getElementById("popup")!;
};
const connected = (overrides: Partial<PopupState> = {}): PopupState => ({ connected: { name: "Asha Rao", base: "https://pathfinderedtech.com" }, paused: false, applying: null, ...overrides });
const buttons = (node: HTMLElement) => Array.from(node.querySelectorAll("button")).map((button) => button.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("the extension's popup (auto-apply)", () => {
  it("asks to connect when this browser isn't, from Pathfinder's own page", () => {
    const node = root();
    const actions = act();
    render(node, { connected: null, paused: false, applying: null }, actions);
    expect(node.textContent).toContain("Not connected to your Pathfinder account");
    node.querySelector("button")!.click();
    expect(actions.open).toHaveBeenCalledWith("https://pathfinderedtech.com/auto-apply/extension");
  });

  it("says whose account it applies for and what it's doing, and pauses or opens Auto-apply", () => {
    const node = root();
    const actions = act();
    render(node, connected({ applying: { title: "Data Analyst", company: "Acme", submitting: false } }), actions);
    expect(node.textContent).toContain("Connected to Asha Rao's account.");
    expect(node.textContent).toContain("Applying now: Data Analyst at Acme");
    expect(buttons(node)).toEqual(["Pause in this browser", "Open Auto-apply"]);
    node.querySelectorAll("button")[0].click();
    expect(actions.pause).toHaveBeenCalledWith(true);
    node.querySelectorAll("button")[1].click();
    expect(actions.open).toHaveBeenCalledWith("https://pathfinderedtech.com/auto-apply");
  });

  it("when paused, says so and offers Resume; an application under way still finishes", () => {
    const node = root();
    const actions = act();
    render(node, connected({ paused: true }), actions);
    expect(node.textContent).toContain("Paused in this browser: nothing new is started.");
    expect(buttons(node)[0]).toBe("Resume");
    node.querySelector("button")!.click();
    expect(actions.pause).toHaveBeenCalledWith(false);
    render(node, connected({ paused: true, applying: { title: "Analyst", company: "", submitting: true } }), act());
    expect(node.textContent).toContain("Submitting: Analyst");
    expect(node.textContent).toContain("this one finishes");
  });

  it("shows a job's title as text, whatever it contains", () => {
    const node = root();
    render(node, connected({ applying: { title: '<img src=x onerror="alert(1)">', company: "<b>Acme</b>", submitting: false } }), act());
    expect(node.querySelector("img, b")).toBeNull();
    expect(node.textContent).toContain('<img src=x onerror="alert(1)"> at <b>Acme</b>');
  });

  it("reads its state from the extension's storage", async () => {
    const stores: Record<string, Record<string, unknown>> = {
      local: { connection: { token: "pfx_t", base: "https://pathfinderedtech.com", name: "Asha Rao" }, paused: true },
      session: { current: { task: { title: "Data Analyst", company: "Acme" }, tabId: 7, startedAt: 0, submitting: false } },
    };
    const area = (name: string) => ({ get: async (key: string) => (key in stores[name] ? { [key]: stores[name][key] } : {}) });
    vi.stubGlobal("chrome", { storage: { local: area("local"), session: area("session") } });
    expect(await readState()).toEqual({ connected: { name: "Asha Rao", base: "https://pathfinderedtech.com" }, paused: true, applying: { title: "Data Analyst", company: "Acme", submitting: false } });
    stores.local = {};
    stores.session = {};
    expect(await readState()).toEqual({ connected: null, paused: false, applying: null });
  });
});
