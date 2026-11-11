import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAssistant, runAssistantTool } from "@/app/(app)/assistant/actions";

import { AssistantPanel } from "./assistant-panel";

vi.mock("@/app/(app)/assistant/actions", () => ({ askAssistant: vi.fn(), runAssistantTool: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/resume" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<AssistantPanel />);
  await user.click(screen.getByRole("button", { name: "Open the assistant" }));
};

beforeEach(() => {
  vi.mocked(askAssistant).mockReset();
  vi.mocked(runAssistantTool).mockReset();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe("AssistantPanel (Pathfinder)", () => {
  it("opens, answers a question, and offers a link to the screen", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({ ok: true, data: { text: "Open your base resume and turn on Fit to one page.", navigate: "/resume", proposal: null } });
    await open(user);

    await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "how do I make my resume one page?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Open your base resume and turn on Fit to one page.")).toBeInTheDocument();
    // The whole thread, with the current screen, is sent to the server.
    expect(askAssistant).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "how do I make my resume one page?" }],
      path: "/resume",
    });
    expect(screen.getByRole("link", { name: /Open Base resume/ })).toHaveAttribute("href", "/resume");
  });

  it("sends on Enter and shows a failure in the thread", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({ ok: false, error: "The AI is busy. Try again in a moment." });
    await open(user);

    await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "hi{Enter}");
    expect(await screen.findByText("The AI is busy. Try again in a moment.")).toBeInTheDocument();
    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(1));
  });

  it("confirms a proposed change before running it, then shows it's done", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({
      ok: true,
      data: { text: "I'll set your title.", navigate: null, proposal: { tool: "update_profile", args: { headline: "Product Manager" }, summary: "Update your title to “Product Manager”." } },
    });
    vi.mocked(runAssistantTool).mockResolvedValue({ ok: true, data: { done: "Updated your title." } });
    await open(user);

    await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "change my title to Product Manager{Enter}");
    expect(await screen.findByText("Update your title to “Product Manager”.")).toBeInTheDocument();
    // Nothing runs until the student confirms.
    expect(runAssistantTool).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(runAssistantTool).toHaveBeenCalledWith({ tool: "update_profile", args: { headline: "Product Manager" } });
    expect(await screen.findByText(/Updated your title\./)).toBeInTheDocument();
  });

  it("lets the student cancel a proposed change, which runs nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({
      ok: true,
      data: { text: "I'll do that.", navigate: null, proposal: { tool: "update_profile", args: { city: "Delhi" }, summary: "Update your city to “Delhi”." } },
    });
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "set my city{Enter}");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(runAssistantTool).not.toHaveBeenCalled();
    expect(screen.getByText(/didn.t change anything/)).toBeInTheDocument();
  });

  it("remembers the conversation after it's reopened, and 'New chat' clears it", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({ ok: true, data: { text: "Your applications are under Applications.", navigate: null, proposal: null } });

    const first = render(<AssistantPanel />);
    await user.click(screen.getByRole("button", { name: "Open the assistant" }));
    await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "where are my applications?{Enter}");
    expect(await screen.findByText("Your applications are under Applications.")).toBeInTheDocument();
    first.unmount();

    // A fresh mount (like a reload) loads the remembered chat.
    render(<AssistantPanel />);
    await user.click(screen.getByRole("button", { name: "Open the assistant" }));
    expect(await screen.findByText("where are my applications?")).toBeInTheDocument();
    expect(screen.getByText("Your applications are under Applications.")).toBeInTheDocument();

    // New chat wipes it back to just the greeting.
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("where are my applications?")).toBeNull();
    expect(screen.getByText(/I'm the Pathfinder assistant/)).toBeInTheDocument();
  });

  it("closes from the header", async () => {
    const user = userEvent.setup();
    await open(user);
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the assistant" }));
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();
  });
});
