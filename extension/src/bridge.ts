// The bridge, on Pathfinder's own pages (manifest.json "content_scripts"): tells the Connect the
// extension page it's installed, and takes the token the page hands over. It never gives the
// token back to the page.
import { BRIDGE } from "./protocol";

/** Listens on the page; returns how to stop. */
export function listen(win: Window, send: (message: unknown) => Promise<{ ok: boolean } | undefined>): () => void {
  const origin = win.location.origin;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win || event.origin !== origin) return;
    const data = event.data as { type?: string; token?: unknown } | null;
    if (data?.type === BRIDGE.ping) win.postMessage({ type: BRIDGE.hello }, origin);
    if (data?.type === BRIDGE.connect && typeof data.token === "string") {
      void send({ type: "connect", token: data.token }).then((reply) => {
        if (reply?.ok) win.postMessage({ type: BRIDGE.connected }, origin);
      });
    }
  };
  win.addEventListener("message", onMessage);
  // In case the page asked before this script was there.
  win.postMessage({ type: BRIDGE.hello }, origin);
  return () => win.removeEventListener("message", onMessage);
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) listen(window, (message) => chrome.runtime.sendMessage(message));
