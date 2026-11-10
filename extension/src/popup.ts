// Pathfinder extension: the popup behind its icon. Says whether this browser is connected and to
// whom, what it's doing, and lets the student pause it here or open Auto-apply.

import { current, isPaused, PAUSED_BADGE } from "./background";
import { PATHFINDER_ORIGINS } from "./protocol";

export type PopupState = {
  connected: { name: string; base: string } | null;
  paused: boolean;
  applying: { title: string; company: string; submitting: boolean } | null;
};

export type PopupActions = { open(url: string): void; pause(paused: boolean): void };

export async function readState(): Promise<PopupState> {
  const { connection } = await chrome.storage.local.get("connection");
  const link = connection as { token?: string; base?: string; name?: string } | undefined;
  const held = await current();
  return {
    connected: link?.token && link.base ? { name: link.name ?? "", base: link.base } : null,
    paused: await isPaused(),
    applying: held ? { title: held.task.title, company: held.task.company, submitting: held.submitting } : null,
  };
}

/** The popup's contents. Text only (job titles come from job boards): nothing here is HTML. */
export function render(root: HTMLElement, state: PopupState, act: PopupActions): void {
  const doc = root.ownerDocument;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = "") => {
    const node = doc.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text: string, onClick: () => void, primary = false) => {
    const node = element("button", text, primary ? "primary" : "");
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };

  root.replaceChildren(element("h1", "Pathfinder"));
  if (!state.connected) {
    root.append(
      element("p", "Not connected to your Pathfinder account, so nothing is applied for from this browser."),
      button("Connect", () => act.open(`${PATHFINDER_ORIGINS[0]}/auto-apply/extension`), true),
    );
    return;
  }
  const { name, base } = state.connected;
  root.append(element("p", name ? `Connected to ${name}'s account.` : "Connected to your Pathfinder account.", "muted"));
  const status = state.applying
    ? `${state.applying.submitting ? "Submitting" : "Applying now"}: ${state.applying.title}${state.applying.company ? ` at ${state.applying.company}` : ""}`
    : state.paused
      ? "Paused in this browser: nothing new is started."
      : "Waiting for the next application. Pathfinder checks every minute while Chrome is open.";
  root.append(element("p", status, "status"));
  if (state.applying && state.paused) root.append(element("p", "Paused: this one finishes, then nothing new is started.", "muted"));
  const actions = element("div", "", "actions");
  actions.append(
    button(state.paused ? "Resume" : "Pause in this browser", () => act.pause(!state.paused), state.paused),
    button("Open Auto-apply", () => act.open(`${base}/auto-apply`)),
  );
  root.append(actions);
}

async function show(root: HTMLElement): Promise<void> {
  render(root, await readState(), {
    open: (url) => void chrome.tabs.create({ url }).then(() => window.close()),
    pause: (paused) =>
      void (async () => {
        await chrome.storage.local.set({ paused });
        await chrome.action.setBadgeText({ text: paused ? PAUSED_BADGE : "" });
        await show(root);
      })(),
  });
}

const root = typeof document !== "undefined" ? document.getElementById("popup") : null;
if (root && typeof chrome !== "undefined" && chrome.runtime?.id) void show(root);
