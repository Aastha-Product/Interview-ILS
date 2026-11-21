import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { onboardingSteps } from "@/lib/onboarding";

import { hideOnboarding } from "./actions";
import { GetStarted } from "./get-started";

vi.mock("./actions", () => ({ hideOnboarding: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));

const halfway = onboardingSteps({ profileReady: true, searchReady: true, answersReady: false, agentOn: false, browserConnected: false });

beforeEach(() => vi.clearAllMocks());

describe("the Get started guide (Phase 1)", () => {
  it("shows the progress, ticks the steps done, and continues with the next one", () => {
    render(<GetStarted steps={halfway} />);
    const guide = screen.getByRole("region", { name: "Get started" });
    expect(within(guide).getByText(/^2 of 5 done\./)).toBeInTheDocument();
    expect(within(guide).getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute("aria-valuenow", "2");
    const steps = within(guide).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("Add your resume (done)");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).toHaveTextContent("Answer the questions most forms ask");
    expect(within(guide).getByRole("link", { name: "Continue: Answer the questions most forms ask" })).toHaveAttribute("href", "/auto-apply/setup");
    // Later steps can be done out of order.
    expect(within(steps[4]).getByRole("link", { name: "Do this now" })).toHaveAttribute("href", "/auto-apply/extension");
  });

  it("goes away for good with Hide this", async () => {
    render(<GetStarted steps={halfway} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide this" }));
    expect(hideOnboarding).toHaveBeenCalledWith({});
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });

  it("shows nothing once every step is done", () => {
    const { container } = render(<GetStarted steps={onboardingSteps({ profileReady: true, searchReady: true, answersReady: true, agentOn: true, browserConnected: true })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
