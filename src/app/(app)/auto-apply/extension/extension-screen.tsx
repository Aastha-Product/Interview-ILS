"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExtensionTokenView } from "@/lib/extension/tokens";

import { connectExtension, disconnectExtension } from "../actions";

/** The messages the page and the extension's bridge on Pathfinder's pages exchange (extension/src/bridge.ts). */
export const BRIDGE = {
  /** The page asks whether the extension is installed… */
  ping: "pathfinder-is-extension-there",
  /** …and its bridge answers. */
  hello: "pathfinder-extension-here",
  connect: "pathfinder-connect-extension",
  connected: "pathfinder-extension-connected",
} as const;

/** "Chrome on Windows", from the browser's own description. */
export function browserLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : "Browser";
  const system = /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /Linux/.test(userAgent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

/** Connect the extension (auto-apply step 5): hands this browser's Pathfinder extension a token, and lists the connected ones. */
export function ExtensionScreen({ tokens }: { tokens: ExtensionTokenView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [installed, setInstalled] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type === BRIDGE.hello) setInstalled(true);
      if (event.data?.type === BRIDGE.connected) setConnected(true);
    };
    window.addEventListener("message", listen);
    // Asks the extension's bridge whether it's there; it answers with BRIDGE.hello.
    window.postMessage({ type: BRIDGE.ping }, window.location.origin);
    return () => window.removeEventListener("message", listen);
  }, []);

  const connect = () =>
    startTransition(async () => {
      const result = toastResult(await connectExtension({ label: browserLabel(navigator.userAgent) }));
      if (!result.ok) return;
      // Only to this page's own window, where the extension's bridge listens.
      window.postMessage({ type: BRIDGE.connect, token: result.data.token }, window.location.origin);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Connect the extension"
        description="The Pathfinder extension fills and submits applications in this browser, signed in as you. It never sees your passwords, and stops for anything only you can do."
      />
      <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
        {connected ? (
          <p className="font-medium">This browser&apos;s extension is connected. Keep Chrome open while auto-apply runs.</p>
        ) : installed ? (
          <>
            <p>The Pathfinder extension is installed in this browser.</p>
            <div>
              <Button aria-disabled={pending || undefined} onClick={() => !pending && connect()}>
                {pending ? "Connecting…" : "Connect it to my account"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-meta text-muted">Install the Pathfinder extension in Chrome first, then open this page again. It will be in the Chrome Web Store once it&apos;s published.</p>
        )}
      </Card>

      <Card padding="none" className="px-7 py-[22px]">
        <h2 className="text-field font-medium">Connected browsers</h2>
        {tokens.length === 0 ? (
          <p className="pt-3 text-meta text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-t-0">
                <div className="flex flex-col">
                  <span className="font-medium">{token.label || "A browser"}</span>
                  <span className="text-meta text-muted">
                    Connected {when(token.createdAt)} · last used {when(token.lastUsedAt)}
                  </span>
                </div>
                <Button
                  variant="text"
                  size="sm"
                  aria-disabled={pending || undefined}
                  onClick={() => !pending && startTransition(async () => void (toastResult(await disconnectExtension({ id: token.id })).ok && router.refresh()))}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
