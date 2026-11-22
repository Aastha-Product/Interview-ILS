import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RunLogView } from "@/lib/run-log-data";

import { pauseEverything, resumeEverything } from "./actions";
import { RunsScreen } from "./runs-screen";

vi.mock("./actions", () => ({
  pauseEverything: vi.fn(async () => ({ ok: true, data: null, toast: "Paused." })),
  resumeEverything: vi.fn(async () => ({ ok: true, data: null, toast: "Resumed." })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/runs" }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result, toast: vi.fn() }));

const view = (overrides: Partial<RunLogView> = {}): RunLogView => ({
  agent: {
    enabled: true,
    nextRun: "Sun 22 Nov, 07:00",
    runs: [
      { at: "Sat 21 Nov, 09:10", manual: true, message: "2 new postings are waiting for a look." },
      { at: "Sat 21 Nov, 07:00", manual: false, message: null },
    ],
  },
  autoApply: {
    enabled: true,
    lastMatch: "Sat 21 Nov, 08:00",
    nextMatch: "Sun 22 Nov, 08:00",
    days: [
      { day: "2026-11-21", label: "Today", summary: "3 prepared · 2 applied" },
      { day: "2026-11-20", label: "Fri 20 Nov", summary: null },
    ],
  },
  ...overrides,
});

describe("Runs & schedule (Phase 3)", () => {
  it("shows auto-apply's last and next look, and its last days", () => {
    render(<RunsScreen view={view()} timeZone="Asia/Kolkata" />);
    expect(screen.getByText(/Times are in Asia\/Kolkata/)).toBeInTheDocument();
    expect(screen.getByText("Sat 21 Nov, 08:00")).toBeInTheDocument();
    expect(screen.getByText("Sun 22 Nov, 08:00")).toBeInTheDocument();
    const days = within(screen.getByRole("list", { name: "Auto-apply by day" })).getAllByRole("listitem");
    expect(days[0]).toHaveTextContent("Today3 prepared · 2 applied");
    expect(days[1]).toHaveTextContent("Fri 20 NovNothing new");
  });

  it("lists the job agent's runs, how each started and what it found", () => {
    render(<RunsScreen view={view()} timeZone="Asia/Kolkata" />);
    expect(screen.getByText("Sun 22 Nov, 07:00")).toBeInTheDocument();
    const runs = within(screen.getByRole("list", { name: "Job agent runs" })).getAllByRole("listitem");
    expect(runs[0]).toHaveTextContent("Run now");
    expect(runs[0]).toHaveTextContent("2 new postings are waiting for a look.");
    expect(runs[1]).toHaveTextContent("Scheduled");
    expect(runs[1]).toHaveTextContent("Still running, or stopped before it finished.");
    expect(screen.getByRole("link", { name: "Agent" })).toHaveAttribute("href", "/agent");
  });

  it("says when each is off, and where to switch it on", () => {
    render(
      <RunsScreen
        view={view({ agent: { enabled: false, nextRun: null, runs: [] }, autoApply: { ...view().autoApply, enabled: false, nextMatch: null } })}
        timeZone="Asia/Kolkata"
      />,
    );
    expect(screen.getByText(/^Off\. Nothing is matched, prepared or submitted/)).toBeInTheDocument();
    expect(screen.getByText(/^Off\. Nothing is searched or scored/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → Job agent" })).toHaveAttribute("href", "/settings?section=agent");
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Job agent runs" })).toBeNull();
  });

  it("leaves the agent out where the job-search tools are off", () => {
    render(<RunsScreen view={view({ agent: null })} timeZone="Asia/Kolkata" />);
    expect(screen.queryByRole("heading", { name: "Job agent" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Auto-apply" })).toBeInTheDocument();
  });

  it("pauses everything that runs, and resumes it (Phase 3)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RunsScreen view={view()} timeZone="Asia/Kolkata" pause={{ paused: null, running: { autoApply: true, agent: false } }} />);
    const card = within(screen.getByRole("region", { name: "Pause everything" }));
    expect(card.getByText(/stops auto-apply and the job agent at once/)).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Pause everything" }));
    expect(pauseEverything).toHaveBeenCalledWith({});

    rerender(<RunsScreen view={view()} timeZone="Asia/Kolkata" pause={{ paused: { since: new Date("2026-11-22T04:30:00Z") }, running: { autoApply: false, agent: false } }} />);
    expect(screen.getByText("Everything is paused").closest("p")).toHaveTextContent(/since 22 Nov, 10:00.?am/i);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(resumeEverything).toHaveBeenCalledWith({});
  });

  it("offers no pause while nothing runs", () => {
    render(<RunsScreen view={view()} timeZone="Asia/Kolkata" pause={{ paused: null, running: { autoApply: false, agent: false } }} />);
    expect(screen.queryByRole("region", { name: "Pause everything" })).toBeNull();
  });
});
