import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { addJobBoardsFromLinks, switchJobBoard } from "./actions";
import { AddJobBoards, BoardSwitch, outcomeText } from "./job-boards";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({
  addJobBoardsFromLinks: vi.fn(),
  switchJobBoard: vi.fn(async () => ({ ok: true, data: null, toast: "Paused: it won't be crawled until you resume it." })),
}));

const okta = { system: "GREENHOUSE" as const, boardToken: "okta", name: "Okta" };
const acme = { system: "LEVER" as const, boardToken: "acme", name: "Acme" };

beforeEach(() => vi.clearAllMocks());

describe("Admin → Job boards (Phase 2)", () => {
  it("says what happened to each pasted board", () => {
    expect(outcomeText({ kind: "added", board: okta, relevantJobs: 12 })).toBe("Added Okta (Greenhouse): 12 open jobs in your countries. It's crawled at the next look.");
    expect(outcomeText({ kind: "exists", board: okta })).toBe("Okta (Greenhouse) is already on the list.");
    expect(outcomeText({ kind: "not-found", board: acme })).toBe("Acme (Lever): no such board. Check the link.");
    expect(outcomeText({ kind: "no-jobs", board: acme, openJobs: 40 })).toBe("Acme (Lever) wasn't added: its 40 open jobs are all elsewhere.");
    expect(outcomeText({ kind: "no-jobs", board: acme, openJobs: 0 })).toBe("Acme (Lever) wasn't added: it has no open jobs.");
    expect(outcomeText({ kind: "unavailable", board: acme })).toBe("Acme (Lever) couldn't be checked just now. Try it again later.");
  });

  it("checks and adds pasted links, keeps the ones that weren't added, and lists what it couldn't read", async () => {
    vi.mocked(addJobBoardsFromLinks).mockResolvedValueOnce({
      ok: true,
      data: { results: [{ kind: "added", board: okta, relevantJobs: 12 }, { kind: "not-found", board: acme }], unread: ["https://naukri.com/x"], overLimit: 0 },
    });
    const user = userEvent.setup();
    render(<AddJobBoards />);
    const links = screen.getByLabelText("Careers links");
    await user.type(links, "https://job-boards.greenhouse.io/okta\nhttps://jobs.lever.co/acme\nhttps://naukri.com/x");
    await user.clear(screen.getByLabelText("Countries"));
    await user.type(screen.getByLabelText("Countries"), "in, sg");
    await user.click(screen.getByRole("button", { name: "Check and add" }));
    expect(addJobBoardsFromLinks).toHaveBeenCalledWith({ links: "https://job-boards.greenhouse.io/okta\nhttps://jobs.lever.co/acme\nhttps://naukri.com/x", countries: "in, sg" });
    expect(await screen.findByText(/^Added Okta \(Greenhouse\)/)).toBeInTheDocument();
    expect(screen.getByText("Acme (Lever): no such board. Check the link.")).toBeInTheDocument();
    expect(screen.getByText("Not a board this can read: https://naukri.com/x")).toBeInTheDocument();
    // The added board's link is taken out; the rest stay to fix.
    expect(links).toHaveValue("https://jobs.lever.co/acme\nhttps://naukri.com/x");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("says why when nothing could be added", async () => {
    vi.mocked(addJobBoardsFromLinks).mockResolvedValueOnce({ ok: false, error: "Only an admin can add job boards." });
    const user = userEvent.setup();
    render(<AddJobBoards />);
    await user.type(screen.getByLabelText("Careers links"), "https://jobs.lever.co/acme");
    await user.click(screen.getByRole("button", { name: "Check and add" }));
    expect(toast).toHaveBeenCalledWith("Only an admin can add job boards.");
  });

  it("pauses and resumes a board", async () => {
    const user = userEvent.setup();
    render(<BoardSwitch id="b1" name="Okta" active />);
    await user.click(screen.getByRole("button", { name: "Pause Okta" }));
    expect(switchJobBoard).toHaveBeenCalledWith({ id: "b1", active: false });
    expect(toast).toHaveBeenCalledWith("Paused: it won't be crawled until you resume it.");
  });
});
