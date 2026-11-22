import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PLANS } from "@/lib/plans";

import { PlanSection } from "./student-sections";

vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("./delete-account", () => ({ DeleteAccount: () => null }));
vi.mock("./data-section", () => ({ DangerZone: () => null }));

describe("Settings → Plan (Phase 4)", () => {
  it("shows the Free plan, today's analyses, auto-apply's cap and every plan", () => {
    render(<PlanSection perDay={5} left={3} />);
    // The plan you are on, and its card.
    expect(screen.getAllByText("Free")).toHaveLength(2);
    expect(screen.getByText("5 a day · 3 left today")).toBeInTheDocument();
    expect(screen.getByText(`Up to ${PLANS.FREE.applicationsPerDay} applications a day`)).toBeInTheDocument();
    const plans = within(screen.getByRole("list", { name: "Plans" })).getAllByRole("listitem");
    expect(plans.map((plan) => plan.textContent?.split(/(Your plan|Price coming soon)/)[0])).toEqual(["Free", "Weekly", "Monthly", "3 months"]);
    expect(plans[0]).toHaveAttribute("aria-current", "true");
    // No price is shown until the owner sets one.
    expect(plans[2]).toHaveTextContent("Price coming soon");
    expect(plans[2]).toHaveTextContent(`${PLANS.MONTHLY.analysesPerDay} analyses a day · up to ${PLANS.MONTHLY.applicationsPerDay} applications a day`);
    expect(screen.getByText(/the Pathfinder team can move you to a paid plan/)).toBeInTheDocument();
  });

  it("shows a paid plan and when it ends", () => {
    render(<PlanSection perDay={25} left={25} plan="MONTHLY" until={new Date("2026-12-22T10:00:00Z")} />);
    expect(screen.getByText("Monthly · until 22 December 2026")).toBeInTheDocument();
    expect(screen.getByText(`Up to ${PLANS.MONTHLY.applicationsPerDay} applications a day`)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Plans" })).getAllByRole("listitem")[2]).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(/When your plan ends you go back to Free/)).toBeInTheDocument();
  });
});
