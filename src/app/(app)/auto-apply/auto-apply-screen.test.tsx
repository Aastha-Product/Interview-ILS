import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_ANSWERS } from "@/lib/apply/answers";
import type { AutoApplyScreenView } from "@/lib/apply/view";

import { markApplied, prepareApplicationAgain, saveJobSearch, skipApplication, switchAutoApply } from "./actions";
import { AutoApplyScreen } from "./auto-apply-screen";
import { listFrom, SetupScreen } from "./setup/setup-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/auto-apply" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("./actions", () => ({
  saveJobSearch: vi.fn(async () => ({ ok: true, data: null })),
  agreeToAutoApply: vi.fn(async () => ({ ok: true, data: null })),
  switchAutoApply: vi.fn(async () => ({ ok: true, data: null })),
  findMatchesNow: vi.fn(async () => ({ ok: true, data: { jobId: "run" } })),
  skipApplication: vi.fn(async () => ({ ok: true, data: null })),
  prepareApplicationAgain: vi.fn(async () => ({ ok: true, data: null })),
  markApplied: vi.fn(async () => ({ ok: true, data: null })),
}));

const preferences = { titles: ["Data Analyst"], skills: ["SQL"], countries: ["in"], cities: [], remoteOk: true, level: "entry" as const, employmentTypes: [] };
const settings = { enabled: false, consented: true, consentOutdated: false, preferences, minTier: "GOOD" as const, dailyLimit: 10, perCompanyLimit: 2, dryRun: true, answers: EMPTY_ANSWERS };
const tasks = { PREPARING: 1, READY: 2, LEASED: 0, SUBMITTING: 0, APPLIED: 3, NEEDS_STUDENT: 1, UNCERTAIN: 0, FAILED: 0, SKIPPED: 0 };
const view = (overrides: Partial<AutoApplyScreenView> = {}): AutoApplyScreenView => ({
  settings,
  preferences,
  consentText: "I allow Pathfinder to submit job applications for me.",
  summary: { matches: { STRONG: 4, GOOD: 2, PARTIAL: 5, NOT_RECOMMENDED: 9, pending: 0, failed: 0 }, tasks },
  tasks: [
    { id: "t1", state: "NEEDS_STUDENT", title: "Data Analyst", company: "Groww", location: "Bengaluru", url: "https://groww.example/1", score: 86, tier: "STRONG", reason: "Answer this question to apply: Why Groww?", applicationId: "app-1", appliedAt: null, updatedAt: "2026-11-10T08:00:00Z" },
    { id: "t2", state: "APPLIED", title: "Business Analyst", company: "Paytm", location: "Noida", url: "", score: 72, tier: "GOOD", reason: null, applicationId: "app-2", appliedAt: "2026-11-10T07:00:00Z", updatedAt: "2026-11-10T07:00:00Z" },
  ],
  matchRunId: null,
  openJobs: 1734,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the auto-apply dashboard (auto-apply step 4)", () => {
  it("shows the counts and each application, what needs the student first", () => {
    render(<AutoApplyScreen view={view()} />);
    const progress = screen.getByRole("region", { name: "Progress" });
    expect(within(progress).getByText("1734")).toBeInTheDocument();
    expect(within(progress).getByText("6")).toBeInTheDocument();
    expect(within(progress).getByText("3 on the way")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Needs you")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Answer this question to apply: Why Groww?")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/applications/app-1");
    // An application already sent can't be skipped.
    expect(within(rows[1]).queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("switches auto-apply on and skips an application", async () => {
    render(<AutoApplyScreen view={view()} />);
    await userEvent.click(screen.getByRole("switch", { name: /Apply for me/ }));
    expect(switchAutoApply).toHaveBeenCalledWith({ enabled: true });
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(skipApplication).toHaveBeenCalledWith({ taskId: "t1" });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("lets the student say they applied themselves, and skip one that's uncertain (step 5)", async () => {
    const uncertain = { ...view().tasks[1], id: "t3", state: "UNCERTAIN" as const, reason: "Check whether it went through." };
    render(<AutoApplyScreen view={view({ tasks: [...view().tasks, uncertain] })} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).queryByRole("button", { name: "Mark as applied" })).toBeNull();
    expect(within(rows[2]).getByText("Check this one")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: "Skip" })).toBeInTheDocument();
    await userEvent.click(within(rows[2]).getByRole("button", { name: "Mark as applied" }));
    expect(markApplied).toHaveBeenCalledWith({ taskId: "t3" });
    expect(screen.getByRole("link", { name: "Connect the extension" })).toHaveAttribute("href", "/auto-apply/extension");
  });

  it("offers Try again for an application waiting on the student", async () => {
    render(<AutoApplyScreen view={view()} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Try again" }));
    expect(prepareApplicationAgain).toHaveBeenCalledWith({ taskId: "t1" });
  });

  it("sends a student who hasn't agreed yet to set up first", () => {
    render(<AutoApplyScreen view={view({ settings: { ...settings, consented: false } })} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Set up job search" }).length).toBeGreaterThan(0);
  });
});

describe("set up job search (auto-apply step 4)", () => {
  it("reads lists typed with commas", () => {
    expect(listFrom(" Data Analyst, Business Analyst ,,Data Analyst")).toEqual(["Data Analyst", "Business Analyst"]);
  });

  it("saves what the student chose, and asks for a role first", async () => {
    render(<SetupScreen settings={{ ...settings, consented: false }} preferences={preferences} consentText="I allow Pathfinder to apply." countries={[{ code: "in", name: "India" }]} />);
    const roles = screen.getByLabelText("Roles");
    await userEvent.clear(roles);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Add at least one role you're looking for.")).toBeInTheDocument();
    expect(saveJobSearch).not.toHaveBeenCalled();

    await userEvent.type(roles, "Data Analyst, Business Analyst");
    await userEvent.selectOptions(screen.getByLabelText(/legally allowed to work/), "yes");
    await userEvent.click(screen.getByLabelText("I agree"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ titles: ["Data Analyst", "Business Analyst"], countries: ["in"] }),
        answers: expect.objectContaining({ workAuthorized: true }),
        dryRun: true,
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/auto-apply");
  });
});
