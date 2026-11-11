import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_ANSWERS, missingAnswers } from "@/lib/apply/answers";
import type { AutoApplyScreenView } from "@/lib/apply/view";

import { markApplied, prepareApplicationAgain, saveJobSearch, skipApplication, switchAutoApply } from "./actions";
import { AutoApplyScreen } from "./auto-apply-screen";
import { listFrom, SetupScreen } from "./setup/setup-screen";

import { COMPLETE_ANSWERS } from "@/test/answers";

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

const preferences = { titles: ["Data Analyst"], skills: ["SQL"], countries: ["in"], cities: ["Pune"], remoteOk: true, level: "entry" as const, employmentTypes: [] };
const settings = { enabled: false, consented: true, consentOutdated: false, preferences, minTier: "GOOD" as const, dailyLimit: 10, perCompanyLimit: 2, dryRun: true, answers: COMPLETE_ANSWERS, missing: [] };
/** A student who has set nothing up yet. */
const blank = { ...settings, answers: EMPTY_ANSWERS, missing: missingAnswers(EMPTY_ANSWERS, { cities: [], level: "entry" }) };
const tasks = { PREPARING: 1, READY: 2, LEASED: 0, SUBMITTING: 0, APPLIED: 3, NEEDS_STUDENT: 1, UNCERTAIN: 0, FAILED: 0, SKIPPED: 0 };
const view = (overrides: Partial<AutoApplyScreenView> = {}): AutoApplyScreenView => ({
  settings,
  preferences,
  consentText: "I allow Pathfinder to submit job applications for me.",
  summary: { matches: { STRONG: 4, GOOD: 2, PARTIAL: 5, NOT_RECOMMENDED: 9, pending: 0, failed: 0 }, tasks },
  tasks: [
    { id: "t1", state: "NEEDS_STUDENT", title: "Data Analyst", company: "Groww", location: "Bengaluru", url: "https://groww.example/1", score: 86, tier: "STRONG", reason: "Answer this question to apply: Why Groww?", applicationId: "app-1", appliedAt: null, confirmation: null, updatedAt: "2026-11-10T08:00:00Z" },
    { id: "t2", state: "APPLIED", title: "Business Analyst", company: "Paytm", location: "Noida", url: "", score: 72, tier: "GOOD", reason: null, applicationId: "app-2", appliedAt: "2026-11-10T07:00:00Z", confirmation: { by: "board", text: "Thank you for applying to Paytm." }, updatedAt: "2026-11-10T07:00:00Z" },
  ],
  matchRunId: null,
  openJobs: 1734,
  browsers: { connected: 0, lastSeen: null, quiet: false },
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

  it("shows how each application was confirmed (step 5)", () => {
    render(<AutoApplyScreen view={view({ tasks: [view().tasks[1], { ...view().tasks[1], id: "t4", confirmation: { by: "student" } }] })} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Confirmed by the job site: “Thank you for applying to Paytm.”")).toBeInTheDocument();
    expect(within(rows[1]).getByText("You marked it as applied.")).toBeInTheDocument();
  });

  it("warns when no browser would submit: none connected, or none seen for a day", () => {
    const on = { ...settings, enabled: true };
    const { unmount } = render(<AutoApplyScreen view={view({ settings: on })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No browser is connected, so nothing can be submitted.");
    unmount();
    const quiet = render(<AutoApplyScreen view={view({ settings: on, browsers: { connected: 1, lastSeen: "2026-11-08T09:00:00Z", quiet: true } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/hasn't been open with the extension since .*8.*, and 2 applications are waiting/);
    quiet.unmount();
    render(<AutoApplyScreen view={view({ settings: on, browsers: { connected: 2, lastSeen: "2026-11-10T09:00:00Z", quiet: false } })} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/2 browsers connected, last seen/)).toBeInTheDocument();
  });

  it("offers Try again for an application waiting on the student", async () => {
    render(<AutoApplyScreen view={view()} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Try again" }));
    expect(prepareApplicationAgain).toHaveBeenCalledWith({ taskId: "t1" });
  });

  it("has no switch while a required answer is missing, and says which (the owner's rule)", () => {
    render(<AutoApplyScreen view={view({ settings: { ...settings, missing: ["cities", "expectedSalary"] } })} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Auto-apply is waiting for 2 required answers (Cities, Expected salary). Nothing is prepared or submitted until you give them in Set up job search.");
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
    const roles = screen.getByRole("textbox", { name: "Roles" });
    await userEvent.clear(roles);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Add at least one role you're looking for.")).toBeInTheDocument();
    expect(saveJobSearch).not.toHaveBeenCalled();

    await userEvent.type(roles, "Data Analyst, Business Analyst");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /legally allowed to work/ }), "yes");
    await userEvent.click(screen.getByLabelText("I agree"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ titles: ["Data Analyst", "Business Analyst"], countries: ["in"], cities: ["Pune"] }),
        answers: expect.objectContaining({ workAuthorized: true, expectedSalary: "6 LPA" }),
        dryRun: true,
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/auto-apply");
  });

  it("stars every required answer, and won't save until they're all given (the owner's rule)", async () => {
    render(<SetupScreen settings={blank} preferences={{ ...preferences, cities: [] }} consentText="I allow Pathfinder to apply." countries={[{ code: "in", name: "India" }]} />);
    // Starred and marked required: the cities, each yes/no question, the notice period, salaries and graduation year.
    for (const name of ["Roles", "Cities", "Current salary", "Expected salary", "Graduation year"]) expect(screen.getByRole("textbox", { name })).toBeRequired();
    for (const name of [/legally allowed to work/, /visa sponsorship/, /willing to relocate/, /work from the office every working day/, "Notice period"]) expect(screen.getByRole("combobox", { name })).toBeRequired();
    expect(screen.getAllByText("*").length).toBeGreaterThanOrEqual(19);
    // A first job needs no reason for change.
    expect(screen.getByRole("textbox", { name: /Why are you looking for a change\? \(optional\)/ })).not.toBeRequired();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/^Fill in the 18 starred answers still empty to save: Cities, Allowed to work, /)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Cities" })).toBeInvalid();
    expect(screen.getByRole("textbox", { name: "Expected salary" })).toBeInvalid();

    // Filling them in, one kind at a time.
    await userEvent.type(screen.getByRole("textbox", { name: "Cities" }), "Pune, Bengaluru");
    for (const select of screen.getAllByRole("combobox").filter((element) => (element as HTMLSelectElement).value === "" && element.hasAttribute("required"))) {
      const options = Array.from((select as HTMLSelectElement).options).map((option) => option.value);
      await userEvent.selectOptions(select, options.includes("no") ? "no" : "immediate");
    }
    await userEvent.click(screen.getByRole("checkbox", { name: /I don't have a salary now/ }));
    expect(screen.getByRole("textbox", { name: "Current salary" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Expected salary" }), "6 LPA");
    await userEvent.type(screen.getByRole("textbox", { name: "Graduation year" }), "2026");
    expect(screen.getByText(/All required answers are given\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ cities: ["Pune", "Bengaluru"] }),
        answers: expect.objectContaining({ noCurrentSalary: true, expectedSalary: "6 LPA", graduationYear: "2026", noticePeriod: "immediate", onsiteOk: false, willingToRelocate: false }),
      }),
    );
  });

  it("asks an experienced student why they're looking for a change", async () => {
    render(<SetupScreen settings={settings} preferences={{ ...preferences, level: "experienced" }} consentText="I allow Pathfinder to apply." countries={[{ code: "in", name: "India" }]} />);
    const reason = screen.getByRole("textbox", { name: "Why are you looking for a change?" });
    expect(reason).toBeRequired();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).not.toHaveBeenCalled();
    expect(reason).toBeInvalid();
    await userEvent.type(reason, "A larger product scope.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveJobSearch).toHaveBeenCalledWith(expect.objectContaining({ answers: expect.objectContaining({ reasonForChange: "A larger product scope." }) }));
  });
});
