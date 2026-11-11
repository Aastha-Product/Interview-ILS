import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAssistant } from "@/app/(app)/assistant/actions";

import { AssistantPanel } from "./assistant-panel";

vi.mock("@/app/(app)/assistant/actions", () => ({ askAssistant: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/resume" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<AssistantPanel />);
  await user.click(screen.getByRole("button", { name: "Open the assistant" }));
};

beforeEach(() => vi.mocked(askAssistant).mockReset());

describe("AssistantPanel (Pathfinder)", () => {
  it("opens, answers a question, and offers a link to the screen", async () => {
    const user = userEvent.setup();
    vi.mocked(askAssistant).mockResolvedValue({ ok: true, data: { text: "Open your base resume and turn on Fit to one page.", navigate: "/resume" } });
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

  it("closes from the header", async () => {
    const user = userEvent.setup();
    await open(user);
    expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the assistant" }));
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();
  });
});
