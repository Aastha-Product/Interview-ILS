import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { listen } from "./bridge";
import { BRIDGE, PATHFINDER_ORIGINS } from "./protocol";

const fromPage = (data: unknown, origin = window.location.origin) => window.dispatchEvent(new MessageEvent("message", { data, origin, source: window }));

describe("the bridge on Pathfinder's page (auto-apply step 5b)", () => {
  it("says it's there, takes the token, and says when it's connected", async () => {
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const send = vi.fn(async () => ({ ok: true }));
    const stop = listen(window, send);
    expect(posted).toHaveBeenCalledWith({ type: BRIDGE.hello }, window.location.origin);
    posted.mockClear();

    fromPage({ type: BRIDGE.ping });
    expect(posted).toHaveBeenCalledWith({ type: BRIDGE.hello }, window.location.origin);

    fromPage({ type: BRIDGE.connect, token: "pfx_token" });
    expect(send).toHaveBeenCalledWith({ type: "connect", token: "pfx_token" });
    await vi.waitFor(() => expect(posted).toHaveBeenCalledWith({ type: BRIDGE.connected }, window.location.origin));
    // The token is never posted back to the page.
    expect(JSON.stringify(posted.mock.calls)).not.toContain("pfx_token");
    stop();
    posted.mockRestore();
  });

  it("ignores other windows and origins, and says nothing when the token is refused", async () => {
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const send = vi.fn(async () => ({ ok: false }));
    const stop = listen(window, send);
    posted.mockClear();
    fromPage({ type: BRIDGE.connect, token: "pfx_a" }, "https://evil.example");
    window.dispatchEvent(new MessageEvent("message", { data: { type: BRIDGE.connect, token: "pfx_b" }, origin: window.location.origin, source: null }));
    expect(send).not.toHaveBeenCalled();
    fromPage({ type: BRIDGE.connect, token: "pfx_c" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(posted).not.toHaveBeenCalledWith({ type: BRIDGE.connected }, expect.anything());
    stop();
    posted.mockRestore();
  });
});

describe("the extension and Pathfinder agree", () => {
  it("on the bridge's messages", () => {
    const page = readFileSync("src/app/(app)/auto-apply/extension/extension-screen.tsx", "utf8");
    for (const [name, value] of Object.entries(BRIDGE)) expect(page, name).toContain(`${name}: "${value}"`);
  });

  it("on where the bridge runs and where the token may go", () => {
    const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8")) as { content_scripts: { matches: string[] }[]; host_permissions: string[] };
    const sites = PATHFINDER_ORIGINS.map((origin) => `${origin}/*`);
    expect(manifest.content_scripts[0].matches).toEqual(sites);
    for (const site of sites) expect(manifest.host_permissions).toContain(site);
  });
});
