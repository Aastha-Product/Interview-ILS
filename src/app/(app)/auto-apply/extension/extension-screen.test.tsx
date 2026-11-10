import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectExtension, disconnectExtension } from "../actions";
import { BRIDGE, browserLabel, ExtensionScreen } from "./extension-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/auto-apply/extension" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("../actions", () => ({
  connectExtension: vi.fn(async () => ({ ok: true, data: { token: "pfx_secret" } })),
  disconnectExtension: vi.fn(async () => ({ ok: true, data: null })),
}));

const tokens = [{ id: "tok-1", label: "Chrome on Windows", createdAt: "2026-11-01T08:00:00Z", lastUsedAt: null, expiresAt: "2027-01-30T08:00:00Z" }];

/** What the extension's bridge does: answers from this window, on this origin. */
const fromBridge = (type: string) => act(() => window.dispatchEvent(new MessageEvent("message", { data: { type }, origin: window.location.origin, source: window })));

beforeEach(() => vi.clearAllMocks());

describe("connecting the extension (auto-apply step 5)", () => {
  it("asks the extension whether it's installed, and says to install it until it answers", () => {
    const posted = vi.spyOn(window, "postMessage");
    render(<ExtensionScreen tokens={[]} />);
    expect(posted).toHaveBeenCalledWith({ type: BRIDGE.ping }, window.location.origin);
    expect(screen.getByText(/Install the Pathfinder extension in Chrome first/)).toBeInTheDocument();
    expect(screen.getByText("None yet.")).toBeInTheDocument();
    posted.mockRestore();
  });

  it("ignores messages from other windows or origins", () => {
    render(<ExtensionScreen tokens={[]} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: BRIDGE.hello }, origin: "https://evil.example", source: window })));
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: BRIDGE.hello }, origin: window.location.origin, source: null })));
    expect(screen.queryByRole("button", { name: "Connect it to my account" })).toBeNull();
  });

  it("hands the token only to this page's window, and shows when the extension took it", async () => {
    render(<ExtensionScreen tokens={[]} />);
    fromBridge(BRIDGE.hello);
    const posted = vi.spyOn(window, "postMessage");
    await userEvent.click(screen.getByRole("button", { name: "Connect it to my account" }));
    expect(connectExtension).toHaveBeenCalledWith({ label: expect.any(String) });
    expect(posted).toHaveBeenCalledWith({ type: BRIDGE.connect, token: "pfx_secret" }, window.location.origin);
    expect(router.refresh).toHaveBeenCalled();
    fromBridge(BRIDGE.connected);
    expect(screen.getByText(/extension is connected/)).toBeInTheDocument();
    posted.mockRestore();
  });

  it("lists connected browsers and disconnects one", async () => {
    render(<ExtensionScreen tokens={tokens} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(within(row).getByText(/last used never/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
    expect(disconnectExtension).toHaveBeenCalledWith({ id: "tok-1" });
  });

  it("names the browser from its own description", () => {
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge on macOS");
    expect(browserLabel("Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0")).toBe("Chrome on Linux");
    expect(browserLabel("Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile")).toBe("Chrome on Android");
    expect(browserLabel("curl/8")).toBe("Browser");
  });
});
