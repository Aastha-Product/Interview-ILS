// The few chrome.* APIs the Pathfinder extension uses (Manifest V3), typed here rather than
// pulling in @types/chrome for all of them.

declare namespace chrome {
  namespace runtime {
    const id: string;
    type MessageSender = { id?: string; origin?: string; url?: string; tab?: { id?: number; url?: string } };
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: { addListener(listener: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void): void };
    const onInstalled: { addListener(listener: () => void): void };
    const onStartup: { addListener(listener: () => void): void };
  }
  namespace storage {
    type Area = {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    const local: Area;
    const session: Area;
  }
  namespace alarms {
    function create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }): Promise<void> | void;
    const onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  }
  namespace tabs {
    type Tab = { id?: number; url?: string };
    function create(properties: { url: string; active?: boolean }): Promise<Tab>;
    function remove(tabId: number): Promise<void>;
    const onUpdated: { addListener(listener: (tabId: number, info: { status?: string; url?: string }, tab: Tab) => void): void };
    const onRemoved: { addListener(listener: (tabId: number) => void): void };
  }
  namespace scripting {
    function executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  }
  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    function setTitle(details: { title: string }): Promise<void>;
  }
}
